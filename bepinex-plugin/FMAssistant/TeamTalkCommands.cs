using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Uses the original recipient setters and SpeakTo business event. Never calls the
// managed SpeakToActionEvent handler, which also operates panels and match UI.
public static class TeamTalkCommands
{
    private const int ChildBase = 10000;
    private const int ChildStride = 100;
    private static readonly string[] Names = { "TeamTalkGroupType", "SelectedPlayers", "Players", "TalkingTo", "IsCompleted", "IsTeamTalkFinished", "IsSubsTalk", "IsPreMatchTalk", "IsPostMatchTalk" };
    private sealed record Context(InteropReference Target, Dictionary<string, LiveTools.Snapshot> Values, Dictionary<string, string> Handles, bool Grouped)
    {
        internal bool Flag(string name) => bool.TryParse(Values[name].Value?.AsString(), out var value) ? value : throw new InvalidOperationException("Team-talk state unavailable: " + name);
        internal int Group => int.TryParse(Values["TeamTalkGroupType"].Value?.AsString(), out var value) && value >= 0 && value <= 4 ? value : throw new InvalidOperationException("Unknown team-talk recipient group.");
    }
    private static Context Resolve(string tactic, string talk, string channels, string config)
    {
        var current = MatchCommands.RequireCurrentTactic(tactic, true);
        var origin = Channel(talk, tactic, "TeamTalk");
        if (origin.Identity != current.GetPersistentIdentity()) throw new InvalidOperationException("Team-talk tactic source changed.");
        var target = LiveTools.GetReference(talk);
        if (target.GetIl2CppType().FullName != "FM.UI.TeamTalkReference") throw new ArgumentException("Resolve the current match tactic's original TeamTalk reference.");
        var handles = JsonSerializer.Deserialize<Dictionary<string, string>>(channels) ?? throw new ArgumentException("Team-talk channels are required.");
        if (handles.Keys.Any(name => !Names.Contains(name)) || Names.Any(name => name != "TalkingTo" && !handles.ContainsKey(name)))
            throw new ArgumentException("Supply the complete recovered team-talk state channels.");
        var values = new Dictionary<string, LiveTools.Snapshot>();
        foreach (var name in Names)
        {
            if (!handles.ContainsKey(name)) continue;
            var snapshot = Channel(handles[name], talk, name);
            if (snapshot.Identity != target.GetPersistentIdentity()) throw new InvalidOperationException("Team-talk identity changed during subscription.");
            values[name] = snapshot;
        }
        var flags = LiveTools.GetSnapshot(config);
        if (!flags.Ready || flags.Source != "singleton:ConfigReference" || !string.IsNullOrEmpty(flags.SourcePath) ||
            flags.Property != InternalCommands.PropertyId("AllowGroupedTeamTalks") || !bool.TryParse(flags.Value?.AsString(), out var grouped))
            throw new ArgumentException("Use the real ConfigReference.AllowGroupedTeamTalks channel.");
        return new Context(target, values, handles, grouped);
    }
    private static TypedValue Raw(SI.Core.Record row, uint key) => row != null && row.TryGetValue(key, out var value) ? value : throw new ArgumentException("Native team-talk record is missing a required field.");
    private static Il2CppSystem.Collections.Generic.List<TypedValue> List(TypedValue value) =>
        (value?.DataType?.FullName ?? "").StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal)
            ? value.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() ?? throw new InvalidOperationException("Native team-talk list unavailable.")
            : throw new ArgumentException("Expected an original native team-talk list.");
    private static string Fingerprint(Context context) => DispatchJournal.Fingerprint(LiveTools.JsonText(new {
        session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, match = MatchCommands.CurrentReference().GetPersistentIdentity(),
        human = LiveTools.GetReference("human").GetPersistentIdentity(), phase = MatchCommands.ManagerController(false).StateMachine?.CurrentState?.GUID.ToString(),
        side = MatchCommands.CapturePlayerContext(false).IsHomeTeam, target = context.Target.GetPersistentIdentity(), context.Grouped,
        revision = Revision(context.Target.GetPersistentIdentity()), fields = context.Values.ToDictionary(pair => pair.Key, pair => NativeValueFingerprint.Compute(pair.Value.Value))
    }));
    private static void Writable(Context context)
    {
        var controller = MatchCommands.ManagerController(false);
        if (context.Flag("IsTeamTalkFinished") || controller.PeriodTransition?.IsPreparing == true)
            throw new InvalidOperationException("Team talk finished or match period is transitioning.");
        if (context.Flag("IsSubsTalk"))
        {
            if (controller.IsFinished || !controller.MatchKickedOff || MatchCommands.IsPlaying(controller))
                throw new InvalidOperationException("Substitute talk requires a paused, kicked-off, unfinished managed match.");
            return;
        }
        var machine = controller.StateMachine; var state = machine?.CurrentState;
        if (state?.Scripts == null || state.CurrentStateMachine?.Pointer != machine.Pointer || controller.PeriodTransition?.IsPreparing == true)
            throw new InvalidOperationException("Match stage is unavailable or already transitioning.");
        var talks = new List<FM.Match.TeamTalkState>();
        foreach (var script in state.Scripts) { var talk = script.TryCast<FM.Match.TeamTalkState>(); if (talk != null) talks.Add(talk); }
        if (talks.Count != 1 || talks[0].Controller?.Pointer != controller.Pointer || talks[0].State?.Pointer != state.Pointer)
            throw new InvalidOperationException("Current match stage is not an active team-talk stage.");
        var status = typeof(FM.Match.MatchPlaybackFSMState).GetProperty("m_status", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Native team-talk continuation status is unavailable.");
        if (Convert.ToInt32(status.GetValue(talks[0]), CultureInfo.InvariantCulture) != 0 || context.Flag("IsTeamTalkFinished"))
            throw new InvalidOperationException("Team talk already finished or is continuing; do not alter that decision.");
    }
    private sealed record Player(TypedValue Original, int Index, string Identity, bool Disabled)
    {
        internal string Key => Index.ToString(CultureInfo.InvariantCulture) + ":" + Identity;
    }
    private static List<Player> Players(TypedValue value)
    {
        var rows = List(value); var result = new List<Player>();
        foreach (var original in rows)
        {
            var row = Record(original) ?? throw new ArgumentException("Team-talk player must be an original row record.");
            if (!int.TryParse(Raw(row, 0x70496479).AsString(), out var index) || index < 0 || index > 255 ||
                !bool.TryParse(Raw(row, 0x3732366a).AsString(), out var disabled)) throw new ArgumentException("Invalid native player row index/disabled state.");
            var reference = Raw(row, 0x706c7972).Get()?.TryCast<FM.UI.MatchPlayerReference>() ?? throw new ArgumentException("Team-talk player row has no original MatchPlayerReference.");
            Raw(row, 0x4f555151); // Preserve the position mask consumed by the normal setter.
            result.Add(new Player(original, index, reference.GetPersistentIdentity(), disabled));
        }
        if (result.Select(player => player.Index).Distinct().Count() != result.Count || result.Select(player => player.Identity).Distinct().Count() != result.Count)
            throw new InvalidOperationException("Duplicate native team-talk player rows.");
        return result;
    }
    private static string RecipientState(Context context) => TeamTalkConfiguration.State(context.Group, Players(context.Values["SelectedPlayers"].Value).Select(player => player.Key));
    public static object Read(string tactic, string talk, string channels, string config, string operationId)
    {
        var context = Resolve(tactic, talk, channels, config);
        var recipients = new List<object>(); var rowIndex = 0;
        foreach (var original in context.Values.TryGetValue("TalkingTo", out var choices) ? List(choices.Value) : new Il2CppSystem.Collections.Generic.List<TypedValue>())
        {
            var row = Record(original) ?? throw new ArgumentException("Invalid native TalkingTo row.");
            var native = int.Parse(Raw(row, 0x6b39384c).AsString(), CultureInfo.InvariantCulture); var ui = TeamTalkConfiguration.UiGroup(native);
            recipients.Add(new { optionIndex = rowIndex++, nativeGroup = native, uiGroup = ui, label = Raw(row, 0x7377696d).AsString(),
                enabled = TeamTalkConfiguration.CanSelectGroup(ui, context.Flag("IsCompleted"), context.Flag("IsTeamTalkFinished"), context.Grouped) });
        }
        object operation = null;
        if (!string.IsNullOrEmpty(operationId))
        {
            var receipt = ActionCommands.Status(operationId) as DispatchJournal.Receipt ?? throw new ArgumentException("Unknown talk operation.");
            if (receipt.targetIdentity != context.Target.GetPersistentIdentity()) throw new ArgumentException("Operation belongs to another team talk.");
            operation = receipt.verificationScope == "team_talk_recipients" ? ActionCommands.ObserveDomain(operationId, receipt.targetIdentity, receipt.verificationScope, RecipientState(context)) :
                receipt.verificationScope == "team_talk_group_only" ? ActionCommands.ObserveDomain(operationId, receipt.targetIdentity, receipt.verificationScope, context.Group.ToString(CultureInfo.InvariantCulture)) : receipt;
        }
        return new { ok = true, targetIdentity = context.Target.GetPersistentIdentity(), sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            fields = context.Values.ToDictionary(pair => pair.Key, pair => LiveTools.DescribeValue(pair.Value.Value)), allowGroupedTeamTalks = context.Grouped,
            recipientGroups = recipients, playerCandidates = Players(context.Values["Players"].Value).Select((player, index) => new {
                path = index.ToString(CultureInfo.InvariantCulture), nativeIndex = player.Index, playerReference = player.Identity, disabled = player.Disabled }).ToArray(),
            observationScope = "native_team_talk_state", exclusiveCausalityVerified = false, liveVerified = false,
            operation };
    }
    private static (Context Context, TypedValue Payload, string Handle, string Before, string Requested, string Scope, string Token) Selection(
        string tactic, string talk, string channels, string config, string kind, int option, string paths)
    {
        var context = Resolve(tactic, talk, channels, config); Writable(context);
        TypedValue payload; string handle, before, requested, scope;
        if (kind == "group")
        {
            if (!context.Values.TryGetValue("TalkingTo", out var available)) throw new InvalidOperationException("This talk has no native recipient menu.");
            var choices = List(available.Value);
            if (option < 0 || option >= choices.Count) throw new ArgumentException("Select a current native TalkingTo row.");
            var row = Record(choices[option]) ?? throw new ArgumentException("TalkingTo row must be a native record.");
            if (!int.TryParse(Raw(row, 0x6b39384c).AsString(), out var native)) throw new ArgumentException("Invalid native recipient group.");
            var ui = TeamTalkConfiguration.UiGroup(native);
            if (!TeamTalkConfiguration.CanSelectGroup(ui, context.Flag("IsCompleted"), context.Flag("IsTeamTalkFinished"), context.Grouped))
                throw new InvalidOperationException("Game's team-talk recipient controls are disabled for this group.");
            payload = TypedValue.Create(ui); handle = context.Handles["TeamTalkGroupType"];
            // The group setter also chooses native legal members. Do not fabricate that set
            // from positional labels or report its membership verified by a scalar match.
            before = context.Group.ToString(CultureInfo.InvariantCulture); requested = ui.ToString(CultureInfo.InvariantCulture); scope = "team_talk_group_only";
        }
        else if (kind == "players")
        {
            if (context.Group != 4 || !(context.Flag("IsCompleted") || context.Flag("IsSubsTalk"))) throw new InvalidOperationException("Choose the native Individuals group before selecting specific players.");
            var candidates = Players(context.Values["Players"].Value); var selected = new List<Player>();
            using var document = JsonDocument.Parse(paths);
            if (document.RootElement.ValueKind != JsonValueKind.Array) throw new ArgumentException("Select original player row indices.");
            foreach (var path in document.RootElement.EnumerateArray())
            {
                if (path.ValueKind != JsonValueKind.String || !int.TryParse(path.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out var index) ||
                    index < 0 || index >= candidates.Count || path.GetString() != index.ToString(CultureInfo.InvariantCulture)) throw new ArgumentException("Use current player row paths.");
                if (candidates[index].Disabled) throw new InvalidOperationException("Game disabled this player for the talk.");
                selected.Add(candidates[index]);
            }
            if (selected.Select(player => player.Key).Distinct().Count() != selected.Count) throw new ArgumentException("Do not select duplicate players.");
            var list = new Il2CppSystem.Collections.Generic.List<TypedValue>();
            foreach (var player in selected) list.Add(TypedValue.CreateCopyFrom(player.Original));
            payload = GameTools.MakeObjectTypedValue(list); handle = context.Handles["SelectedPlayers"];
            before = RecipientState(context); requested = TeamTalkConfiguration.State(4, selected.Select(player => player.Key)); scope = "team_talk_recipients";
        }
        else throw new ArgumentException("Use group or players recipient selection.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { state = Fingerprint(context), kind, option, requested, scope, payload = NativeValueFingerprint.Compute(payload) }));
        return (context, payload, handle, before, requested, scope, token);
    }
    public static object PreviewSelection(string tactic, string talk, string channels, string config, string kind, int option, string paths)
    {
        var selected = Selection(tactic, talk, channels, config, kind, option, paths);
        return new { ok = true, choiceToken = selected.Token, before = selected.Before, requested = selected.Requested, verificationScope = selected.Scope,
            recipientSetVerified = false, liveVerified = false };
    }
    public static object Select(string id, string tactic, string talk, string channels, string config, string kind, int option, string paths, string token)
    {
        var selected = Selection(tactic, talk, channels, config, kind, option, paths);
        if (selected.Token != token) throw new InvalidOperationException("Talk, recipients or candidates changed since preview.");
        LiveTools.RequireUnusedDraft(selected.Context.Target); LiveTools.RequireNoExternalSpeakTo();
        return ActionCommands.DispatchDomain(id, "team_talk_selection", selected.Context.Target.GetPersistentIdentity(), token, () => {
            Touch(selected.Context.Target.GetPersistentIdentity()); LiveTools.UpdateProperty(selected.Handle, selected.Payload);
        }, selected.Before, selected.Requested, selected.Scope);
    }
    private static (Context Context, TypedValue Npc, Il2CppSystem.Collections.Generic.List<TypedValue> Rows) Offered(
        string tactic, string talk, string channels, string config, string speakto, string actions, string primary, string groups, string options, string bucket)
    {
        var context = Resolve(tactic, talk, channels, config);
        var source = Channel(speakto, talk, "SpeakTo");
        if (source.Identity != context.Target.GetPersistentIdentity() || LiveTools.GetReference(speakto).GetIl2CppType().FullName != "FM.UI.SpeakToReference")
            throw new ArgumentException("Use this team's original SpeakTo reference.");
        Channel(actions, speakto, "Actions"); Channel(primary, actions, "PrimaryNpcWithActions"); Channel(groups, primary, "Actions");
        if (!new[] { "RequiredActions", "OptionalActions", "AdviceActions", "ExitActions" }.Contains(bucket)) throw new ArgumentException("Unknown native talk action bucket.");
        var npc = Field(Record(LiveTools.GetSnapshot(primary).Value), "NPC");
        return (context, npc, List(Channel(options, groups, bucket).Value));
    }
    private static (uint Event, TypedValue Payload, string Token, string Label, bool Confirmation) Action(
        Context context, TypedValue npc, TypedValue original, string speakto, string bucket, int index)
    {
        var row = Record(original) ?? throw new ArgumentException("Native team-talk action is not a record.");
        Writable(context);
        if (Flag(row, "IsDisabled") || !Flag(row, "IsSimpleButton") || Flag(row, "IsPopupButton") ||
            Flag(row, "IsExitButton", false) || Flag(row, "IsOpenPanelAction", false) || Flag(row, "IsContinueMatchFlowButton", false))
            throw new InvalidOperationException("This choice is disabled or requires a separate popup/navigation/continuation workflow.");
        foreach (var name in new[] { "NewsAction", "DynamicCardId" })
        {
            var value = Field(row, name, false);
            if (value != null && !value.IsNull && (!int.TryParse(value.AsString(), out var code) || code >= 0)) throw new InvalidOperationException("Talk action requires an additional card/news workflow.");
        }
        if (!uint.TryParse(Field(row, "Event").AsString(), out var eventId) || eventId != 154 && eventId != 155)
            throw new InvalidOperationException("This talk action's silent native event is not recovered yet.");
        // Original ResponseValue has different shapes for native speak(155) and hand-over(154).
        var response = Record(Field(row, "ActionResponseValue")) ?? throw new ArgumentException("Native talk response record is required.");
        if (eventId == 155) { Raw(response, 0x54546369); Raw(response, 0x54736872); }
        else Raw(response, 0x69642020);
        var payload = new SI.Core.Record();
        payload[0x204a3168] = TypedValue.CreateCopyFrom(npc);
        foreach (var field in new[] { (0x7a637056U, "ActionResponseId"), (0x73663370U, "ActionResponseValue"), (0x42755170U, "ActionID"), (0x42755176U, "ActionProps"), (0x61636474U, "ActionData") })
            payload[field.Item1] = TypedValue.CreateCopyFrom(Field(row, field.Item2));
        var valuePayload = GameTools.MakeObjectTypedValue(payload);
        var confirmation = Field(row, "ConfirmationDialogData", false); var ok = Field(row, "OKDialogData", false);
        var requires = confirmation != null && !confirmation.IsNull || ok != null && !ok.IsNull;
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { context = Fingerprint(context), speakto = LiveTools.GetReference(speakto).GetPersistentIdentity(),
            bucket, index, eventId, original = NativeValueFingerprint.Compute(original), payload = NativeValueFingerprint.Compute(valuePayload),
            confirmation = NativeValueFingerprint.Compute(confirmation), ok = NativeValueFingerprint.Compute(ok) }));
        return (eventId, valuePayload, token, Field(row, "ActionTitle").AsString(), requires);
    }
    public static object Describe(string tactic, string talk, string channels, string config, string speakto, string actions, string primary, string groups, string options, string bucket)
    {
        var offered = Offered(tactic, talk, channels, config, speakto, actions, primary, groups, options, bucket);
        var choices = new List<object>();
        void DescribeChoice(int index, TypedValue original)
        {
            var row = Record(original);
            try
            {
                var action = Action(offered.Context, offered.Npc, original, speakto, bucket, index);
                choices.Add(new { index, label = action.Label, choiceToken = action.Token, eventId = action.Event, silentExecutionImplemented = true,
                    requiresConfirmation = action.Confirmation, confirmation = LiveTools.DescribeValue(Field(row, "ConfirmationDialogData", false)), okDialog = LiveTools.DescribeValue(Field(row, "OKDialogData", false)) });
            }
            catch (Exception error) { choices.Add(new { index, label = Field(row, "ActionTitle", false)?.AsString(), silentExecutionImplemented = false, reason = error.GetBaseException().Message }); }
        }
        for (var index = 0; index < offered.Rows.Count; index++)
        {
            var original = offered.Rows[index];
            DescribeChoice(index, original);
            var children = TalkChildren(original);
            if (children == null) continue;
            for (var child = 0; child < Math.Min(children.Count, ChildStride); child++)
                DescribeChoice(ChildBase + index * ChildStride + child, children[child]);
        }
        return new { ok = true, targetIdentity = offered.Context.Target.GetPersistentIdentity(), bucket, actions = choices, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, liveVerified = false };
    }
    private static Il2CppSystem.Collections.Generic.List<TypedValue> TalkChildren(TypedValue original)
    {
        var row = Record(original);
        if (row == null || Flag(row, "IsDisabled") || Field(row, "Event", false)?.AsString() != "155" ||
            !row.TryGetValue(0x3543446cu, out var children)) return null;
        return children?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
    }
    public static object Execute(string id, string tactic, string talk, string channels, string config, string speakto, string actions, string primary, string groups, string options, string bucket, int index, string token, bool acceptConfirmation)
    {
        var offered = Offered(tactic, talk, channels, config, speakto, actions, primary, groups, options, bucket);
        var parentIndex = index >= ChildBase ? (index - ChildBase) / ChildStride : index;
        if (parentIndex < 0 || parentIndex >= offered.Rows.Count) throw new ArgumentException("Select an existing native talk action.");
        var original = offered.Rows[parentIndex];
        if (index >= ChildBase)
        {
            var childIndex = (index - ChildBase) % ChildStride;
            var children = TalkChildren(original);
            if (children == null || childIndex >= children.Count || Field(Record(children[childIndex]), "Event", false)?.AsString() != "155")
                throw new ArgumentException("Select an existing native speech in the original group.");
            original = children[childIndex];
        }
        var action = Action(offered.Context, offered.Npc, original, speakto, bucket, index);
        if (action.Token != token) throw new InvalidOperationException("Talk, recipients or action changed since preview.");
        if (action.Confirmation && !acceptConfirmation) throw new InvalidOperationException("Read native confirmation and explicitly set acceptConfirmation.");
        LiveTools.RequireUnusedDraft(offered.Context.Target); LiveTools.RequireNoExternalSpeakTo();
        var target = LiveTools.GetReference(speakto);
        return ActionCommands.DispatchDomain(id, "team_talk_action", offered.Context.Target.GetPersistentIdentity(), token, () => {
            Touch(offered.Context.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(action.Event, target, action.Payload);
        }, null, null, "team_talk_action_dispatch");
    }
}
