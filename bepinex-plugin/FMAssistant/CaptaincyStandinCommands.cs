using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Captaincy stand-in index. IPlayerReference registers CaptainsStandinIndex / CaptainsStandinDropdownOptions /
// CanEditCaptainsStandinIndex; the current build's CaptaincyStandinCell fires SetCaptaincyStandinIndex (1315005289)
// with data selectedvalue.PropertyValue (evidence/v79-captaincy-standin.json). Not live-verified.
public static class CaptaincyStandinCommands
{
    private static InteropReference Resolve(string player)
    {
        var target = LiveTools.GetReference(player);
        var name = target.GetIl2CppType().FullName ?? "";
        if (!name.EndsWith("PlayerReference", StringComparison.Ordinal) && name != "FM.UI.PersonReference")
            throw new ArgumentException("Resolve an actual player/person reference.");
        return target;
    }
    private static LiveTools.Snapshot Channel(string handle, string player, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != player || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong captaincy subscription: " + property);
        return snapshot;
    }
    private static SI.Core.Record Record(TypedValue value)
    {
        var name = value?.DataType?.FullName ?? "";
        if (name == "SI.Core.DynamicNumber" || name == "FM.GamePlugin.GameDate" || name.StartsWith("System.")) return null;
        return value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    private static TypedValue Option(string handle, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select a concrete stand-in candidate path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++)
        {
            var row = Record(LiveTools.GetValue(handle, string.Join('/', parts.Take(i))));
            if (row != null && row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() != "False")
                throw new InvalidOperationException("Game disabled this stand-in option or its parent group.");
        }
        var option = LiveTools.GetValue(handle, path);
        var row2 = Record(option) ?? throw new ArgumentException("Selected stand-in candidate is not a native record.");
        if (row2.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) { option = nested; row2 = Record(option); }
        if (row2 == null || !row2.TryGetValue(InternalCommands.PropertyId("PropertyValue"), out var value))
            throw new ArgumentException("Selected stand-in candidate has no PropertyValue.");
        return TypedValue.CreateCopyFrom(value);
    }
    public static object Read(string player, string index, string options, string canEdit)
    {
        var target = Resolve(player);
        var editable = Channel(canEdit, player, "CanEditCaptainsStandinIndex");
        bool allowed = bool.TryParse(editable.Value?.AsString(), out var flag) && flag;
        return new { ok = true, playerIdentity = target.GetPersistentIdentity(), canEdit = allowed,
            currentIndex = LiveTools.DescribeValue(Channel(index, player, "CaptainsStandinIndex").Value),
            candidates = LiveTools.DescribeValue(Channel(options, player, "CaptainsStandinDropdownOptions").Value, 6),
            draftOnly = true, liveVerified = false };
    }
    private static (InteropReference Target, TypedValue Payload, string Token) Prepare(string player, string options, string canEdit, string optionPath)
    {
        var target = Resolve(player);
        var editable = Channel(canEdit, player, "CanEditCaptainsStandinIndex");
        if (!bool.TryParse(editable.Value?.AsString(), out var allowed) || !allowed)
            throw new InvalidOperationException("Game does not allow editing this player's stand-in captain.");
        var payload = Option(options, optionPath);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "set-captaincy-standin", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, token);
    }
    public static object Preview(string player, string options, string canEdit, string optionPath)
    {
        var p = Prepare(player, options, canEdit, optionPath);
        return new { ok = true, nativeEvent = 1315005289u, choiceToken = p.Token, payload = LiveTools.DescribeValue(p.Payload),
            draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string player, string options, string canEdit, string optionPath, string token)
    {
        var p = Prepare(player, options, canEdit, optionPath);
        if (token != p.Token) throw new InvalidOperationException("Captaincy stand-in selection changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "captaincy_standin", p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1315005289u, p.Target, p.Payload);
        }, null, null, "captaincy_standin_selection");
    }
}
