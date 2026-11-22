using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Club vision meeting draft. Event ids come from InteropEventIDs and the current build's
// ClubVisionMeetingBlock asset (evidence/v78-club-vision-meeting.json):
// 1264808054 AddClubVisionObjective (dropdown selection value),
// 118 Undo, 120 Revert, 20 SuggestTerms, 41 ConfirmTerms — all targeting the edit session.
// ClubVisionMeetingEditSessionReference registers CanEdit/CanUndo/CanRevert/CanConfirmTerms/
// CanSuggestTerms and ClubVisionMeetingPossibleObjectivesToAdd. Nothing here is live-verified.
public static class ClubVisionCommands
{
    private static readonly string[] Flags = { "CanEdit", "CanUndo", "CanRevert", "CanConfirmTerms", "CanSuggestTerms" };
    private static InteropReference Resolve(string session)
    {
        var target = LiveTools.GetReference(session);
        var snapshot = LiveTools.GetSnapshot(session);
        if (target.GetIl2CppType().FullName != "FM.UI.ClubVisionMeetingEditSessionReference" || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("ClubVisionMeetingEditSession"))
            throw new ArgumentException("Resolve the actual ClubVisionMeetingEditSession reference.");
        return target;
    }
    private static LiveTools.Snapshot Channel(string handle, string session, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != session || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong club vision subscription: " + property);
        return snapshot;
    }
    private static SI.Core.Record Record(TypedValue value)
    {
        var name = value?.DataType?.FullName ?? "";
        if (name == "SI.Core.DynamicNumber" || name == "FM.GamePlugin.GameDate" || name.StartsWith("System.")) return null;
        return value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    private static bool Flag(LiveTools.Snapshot snapshot) => bool.TryParse(snapshot.Value?.AsString(), out var flag)
        ? flag : throw new ArgumentException("Native club vision flag is not ready: " + snapshot.Property);
    private static TypedValue Option(string handle, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select a concrete possible objective path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++)
        {
            var row = Record(LiveTools.GetValue(handle, string.Join('/', parts.Take(i))));
            if (row != null && row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() != "False")
                throw new InvalidOperationException("Game disabled this club vision objective or its parent group.");
        }
        var option = LiveTools.GetValue(handle, path);
        if (Record(option) == null) throw new ArgumentException("Selected club vision objective is not a native record.");
        return option;
    }
    public static object Read(string session, string canEdit, string canUndo, string canRevert, string canConfirm, string canSuggest, string possible)
    {
        var target = Resolve(session);
        return new { ok = true, sessionIdentity = target.GetPersistentIdentity(),
            canEdit = Flag(Channel(canEdit, session, "CanEdit")), canUndo = Flag(Channel(canUndo, session, "CanUndo")),
            canRevert = Flag(Channel(canRevert, session, "CanRevert")), canConfirmTerms = Flag(Channel(canConfirm, session, "CanConfirmTerms")),
            canSuggestTerms = Flag(Channel(canSuggest, session, "CanSuggestTerms")),
            possibleObjectivesToAdd = LiveTools.DescribeValue(Channel(possible, session, "ClubVisionMeetingPossibleObjectivesToAdd").Value, 6),
            draftOnly = true, liveVerified = false };
    }
    private static TypedValue Objective(string objectives, string session, string objectivePath)
    {
        if (string.IsNullOrWhiteSpace(objectivePath)) throw new ArgumentException("Select an actual vision objective row path.");
        var list = LiveTools.GetSnapshot(objectives);
        if (!list.Ready || list.Source != session || !string.IsNullOrEmpty(list.SourcePath) ||
            (list.Property != InternalCommands.PropertyId("ClubVisionMeetingActionableObjectives") &&
             list.Property != InternalCommands.PropertyId("ClubVisionMeetingObjectivesForYear")))
            throw new ArgumentException("Use one of the session's actual vision objective lists.");
        var option = LiveTools.GetValue(objectives, objectivePath);
        var row = Record(option) ?? throw new ArgumentException("Selected vision objective is not a native record.");
        if (row.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) { option = nested; row = Record(option); }
        if (row == null || !row.TryGetValue(InternalCommands.PropertyId("ClubVisionMeetingObjectiveIdentifier"), out var value))
            throw new ArgumentException("Selected vision objective has no ClubVisionMeetingObjectiveIdentifier.");
        return TypedValue.CreateCopyFrom(value);
    }
    private static (InteropReference Target, TypedValue Payload, uint Event, string Scope, string Token) Prepare(
        string action, string session, string canEdit, string canUndo, string canRevert, string canConfirm, string canSuggest, string possible, string optionPath,
        string objectives = null, string objectivePath = null)
    {
        var target = Resolve(session);
        TypedValue payload = null;
        uint eventId;
        string scope;
        switch (action)
        {
            case "add-objective":
                if (!Flag(Channel(canEdit, session, "CanEdit"))) throw new InvalidOperationException("Game does not allow editing club vision.");
                payload = Option(possible, optionPath); eventId = 1264808054u; scope = "club_vision_add_objective"; break;
            case "undo":
                if (!Flag(Channel(canUndo, session, "CanUndo"))) throw new InvalidOperationException("Game does not allow undo in club vision.");
                eventId = 118u; scope = "club_vision_undo"; break;
            case "revert":
                if (!Flag(Channel(canRevert, session, "CanRevert"))) throw new InvalidOperationException("Game does not allow revert in club vision.");
                eventId = 120u; scope = "club_vision_revert"; break;
            case "suggest":
                if (!Flag(Channel(canSuggest, session, "CanSuggestTerms"))) throw new InvalidOperationException("Game does not allow suggesting club vision terms.");
                eventId = 20u; scope = "club_vision_suggest_terms"; break;
            case "confirm":
                if (!Flag(Channel(canConfirm, session, "CanConfirmTerms"))) throw new InvalidOperationException("Game does not allow confirming club vision terms.");
                eventId = 41u; scope = "club_vision_confirm_terms"; break;
            case "remove-objective":
                if (!Flag(Channel(canEdit, session, "CanEdit"))) throw new InvalidOperationException("Game does not allow editing club vision.");
                payload = Objective(objectives, session, objectivePath); eventId = 1949840696u; scope = "club_vision_remove_objective"; break;
            default: throw new ArgumentException("Use add-objective, remove-objective, undo, revert, suggest or confirm.");
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action, identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, eventId, scope, token);
    }
    public static object Preview(string action, string session, string canEdit, string canUndo, string canRevert, string canConfirm, string canSuggest, string possible, string optionPath,
        string objectives = null, string objectivePath = null)
    {
        var p = Prepare(action, session, canEdit, canUndo, canRevert, canConfirm, canSuggest, possible, optionPath, objectives, objectivePath);
        return new { ok = true, action, nativeEvent = p.Event, choiceToken = p.Token, scope = p.Scope,
            payload = p.Payload == null ? null : LiveTools.DescribeValue(p.Payload), draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string action, string session, string canEdit, string canUndo, string canRevert, string canConfirm, string canSuggest, string possible, string optionPath, string token,
        string objectives = null, string objectivePath = null)
    {
        var p = Prepare(action, session, canEdit, canUndo, canRevert, canConfirm, canSuggest, possible, optionPath, objectives, objectivePath);
        if (token != p.Token) throw new InvalidOperationException("Club vision draft changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "club_vision_" + action, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, p.Scope);
    }
}
