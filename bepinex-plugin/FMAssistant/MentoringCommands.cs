using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using SI.Core;
using SI.Interop;
using FM.GamePlugin;

namespace FMAssistant;

// Original SetMentoringGroupContent business bindings/events. Selection is a
// native group draft; confirmation is a separate operation, as in the game.
public static class MentoringCommands
{
    private static readonly string[] Names = { "Team", "UniqueId", "Name", "IsValid", "Count", "MaxValue", "Players", "SelectedPlayers", "PlayersAvailableForMentoring", "CanAutoSelectMentoringGroup", "PendingUpdate" };
    private sealed record Context(InteropReference Training, InteropReference Group, Dictionary<string, LiveTools.Snapshot> Values, Dictionary<string, string> Handles, string Team);
    private static InteropReference Training(string team, string training)
    {
        var actor = NegotiationActions.Channel(team, "human", "Team");
        if (actor.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the current manager's actual team.");
        NegotiationActions.Channel(training, team, "TeamTraining");
        var target = LiveTools.GetReference(training);
        if (target.GetIl2CppType().FullName != "FM.UI.TeamTrainingReference") throw new ArgumentException("Use actual team training.");
        return target;
    }
    private static Context Resolve(string team, string training, string groups, string groupPath, string mode, string channels)
    {
        var root = Training(team, training); InteropReference group;
        if (mode == "new")
        {
            NegotiationActions.Channel(groups, training, "NewlyCreatedMentoringGroup");
            if (!string.IsNullOrEmpty(groupPath)) throw new ArgumentException("New group is the actual NewlyCreatedMentoringGroup reference, not an arbitrary path.");
            group = LiveTools.GetReference(groups);
        }
        else if (mode == "existing")
        {
            NegotiationActions.Channel(groups, team, "MentoringGroups");
            if (!int.TryParse(groupPath, out var index) || index < 0 || groupPath != index.ToString(System.Globalization.CultureInfo.InvariantCulture))
                throw new ArgumentException("Choose an actual mentoring-group list index.");
            group = LiveTools.GetReference(groups, groupPath);
        }
        else throw new ArgumentException("Use new or existing mentoring group mode.");
        if (group.GetIl2CppType().FullName != "FM.UI.MentoringGroupReference") throw new ArgumentException("Use an actual mentoring group.");
        var handles = JsonSerializer.Deserialize<Dictionary<string, string>>(channels) ?? throw new ArgumentException("Original group channels required.");
        if (handles.Count != Names.Length || Names.Any(n => !handles.ContainsKey(n))) throw new ArgumentException("Supply all group state channels.");
        var values = new Dictionary<string, LiveTools.Snapshot>();
        foreach (var name in Names)
        {
            var snapshot = NegotiationActions.Channel(handles[name], groups, name, groupPath);
            if (snapshot.Identity != group.GetPersistentIdentity()) throw new InvalidOperationException("Group list changed; refresh the selection.");
            values.Add(name, snapshot);
        }
        var teamId = LiveTools.GetReference(team).GetPersistentIdentity();
        if (LiveTools.GetReference(handles["Team"]).GetPersistentIdentity() != teamId) throw new InvalidOperationException("Mentoring group belongs to another team.");
        return new(root, group, values, handles, teamId);
    }
    private static bool Flag(Context c, string name) => bool.TryParse(c.Values[name].Value?.AsString(), out var result) ? result
        : throw new InvalidOperationException("Native mentoring state unavailable: " + name);
    private static int Number(Context c, string name) => int.TryParse(c.Values[name].Value?.AsString(), out var result) && result >= 0 ? result
        : throw new InvalidOperationException("Native mentoring count unavailable: " + name);
    private sealed record Prepared(Context Context, InteropReference Target, uint Event, TypedValue Payload, string Update, string Token);
    private static Prepared Prepare(string team, string training, string groups, string groupPath, string mode, string channels, string action, string indices, string name)
    {
        var c = Resolve(team, training, groups, groupPath, mode, channels);
        var target = c.Group; uint nativeEvent = 0; TypedValue payload = null; string update = null;
        switch (action)
        {
            case "initialize": nativeEvent = 1886810230; break;
            case "delete":
                if (!Flag(c, "IsValid")) throw new InvalidOperationException("Only an actual valid group can be deleted.");
                nativeEvent = 62; target = c.Training; payload = TypedValue.CreateCopyFrom(c.Values["UniqueId"].Value); break;
            case "clear":
                if (Number(c, "Count") == 0) throw new InvalidOperationException("Selection is already empty.");
                nativeEvent = 910314842; break;
            case "revert": nativeEvent = 1848784993; break;
            case "auto-select":
                if (!Flag(c, "CanAutoSelectMentoringGroup")) throw new InvalidOperationException("Game does not permit automatic mentoring selection.");
                nativeEvent = 877883960; break;
            case "select-players":
                var selected = JsonSerializer.Deserialize<int[]>(indices) ?? throw new ArgumentException("Supply candidate indices.");
                if (selected.Length > Number(c, "MaxValue") || selected.Distinct().Count() != selected.Length) throw new ArgumentException("Selection exceeds the game's group limit or repeats a candidate.");
                var candidates = c.Values["PlayersAvailableForMentoring"].Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
                    ?? throw new InvalidOperationException("Actual mentoring candidates are not ready.");
                var rows = new Il2CppSystem.Collections.Generic.List<TypedValue>();
                foreach (var index in selected)
                {
                    if (index < 0 || index >= candidates.Count) throw new ArgumentException("Choose an actual mentoring player candidate.");
                    rows.Add(TypedValue.CreateCopyFrom(candidates[index]));
                }
                payload = GameTools.MakeObjectTypedValue(rows); update = c.Handles["SelectedPlayers"]; break;
            case "confirm":
                // Original confirm_button: ComparisonOperator.Equal(2), Int32(3), group.Count.
                if (Number(c, "Count") != 3) throw new InvalidOperationException("Original mentoring confirmation requires exactly three selected players.");
                payload = TypedValue.CreateCopyFrom(c.Values["SelectedPlayers"].Value); nativeEvent = 64; break;
            case "rename":
                if (string.IsNullOrWhiteSpace(name) || name.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0) throw new ArgumentException("Provide a nonempty single-line group name.");
                payload = TypedValue.Create(name); nativeEvent = 74; break;
            default: throw new ArgumentException("Unknown mentoring operation.");
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), team = c.Team, training = c.Training.GetPersistentIdentity(),
            group = c.Group.GetPersistentIdentity(), action, nativeEvent, payload = NativeValueFingerprint.Compute(payload),
            state = c.Values.ToDictionary(p => p.Key, p => NativeValueFingerprint.Compute(p.Value.Value)) }));
        return new(c, target, nativeEvent, payload, update, token);
    }
    public static object Read(string team, string training, string groups, string groupPath, string mode, string channels)
    {
        var c = Resolve(team, training, groups, groupPath, mode, channels);
        return new { ok = true, groupIdentity = c.Group.GetPersistentIdentity(), fields = c.Values.ToDictionary(p => p.Key, p => LiveTools.DescribeValue(p.Value.Value, 8)),
            scope = "mentoring_group_live_draft_and_members", liveVerified = false };
    }
    public static object Preview(string team, string training, string groups, string groupPath, string mode, string channels, string action, string indices, string name)
    {
        var p = Prepare(team, training, groups, groupPath, mode, channels, action, indices, name);
        return new { ok = true, choiceToken = p.Token, action, nativeEvent = p.Event, payload = LiveTools.DescribeValue(p.Payload),
            draftOnly = action == "select-players" || action == "clear" || action == "revert" || action == "auto-select", liveVerified = false };
    }
    public static object Execute(string id, string team, string training, string groups, string groupPath, string mode, string channels, string action, string indices, string name, string token)
    {
        var p = Prepare(team, training, groups, groupPath, mode, channels, action, indices, name);
        if (p.Token != token) throw new InvalidOperationException("Mentoring draft, members or choices changed; refresh preview.");
        LiveTools.RequireUnusedDraft(p.Context.Training); LiveTools.RequireUnusedDraft(p.Context.Group);
        return ActionCommands.DispatchDomain(id, "mentoring_" + action, p.Context.Group.GetPersistentIdentity(), token, () => {
            if (p.Update != null) LiveTools.UpdateProperty(p.Update, p.Payload);
            else SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, "mentoring_business_dispatch");
    }
    public static object Create(string team, string training, string groups, string id, string token)
    {
        var root = Training(team, training); var list = NegotiationActions.Channel(groups, team, "MentoringGroups");
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), training = root.GetPersistentIdentity(), revision = NegotiationActions.Revision(root.GetPersistentIdentity()),
            groups = NativeValueFingerprint.Compute(list.Value) }));
        if (string.IsNullOrEmpty(id)) return new { ok = true, choiceToken = expected, nativeEvent = 63, liveVerified = false };
        LiveTools.RequireUnusedDraft(root);
        return ActionCommands.DispatchOnce(id, "mentoring_create", root.GetPersistentIdentity(), token, "mentoring_create_dispatch",
            () => new ContinueRequestGuard.Preflight(expected, false, true, null),
            () =>
            {
                NegotiationActions.Touch(root.GetPersistentIdentity());
                SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(63, root, null);
            });
    }
}
