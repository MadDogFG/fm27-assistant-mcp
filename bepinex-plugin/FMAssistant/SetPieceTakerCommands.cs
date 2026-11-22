using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

public static class SetPieceTakerCommands
{
    private static InteropReference Resolve(string team, string tactic, string setpiece)
    {
        var human = LiveTools.GetReference("human");
        if (NegotiationActions.Channel(team, "human", "Team").Identity != human.GetPersistentIdentity()) throw new ArgumentException("Use the active manager's actual team.");
        var target = LiveTools.GetReference(tactic);
        if (target.GetIl2CppType().FullName == "FM.UI.MatchTacticReference") MatchCommands.RequireCurrentTactic(tactic);
        else if (target.GetIl2CppType().FullName == "FM.UI.TeamTacticReference")
        {
            var source = NegotiationActions.Channel(tactic, team, "Tactic");
            if (source.Identity != LiveTools.GetReference(team).GetPersistentIdentity()) throw new ArgumentException("Tactic belongs to another team.");
        }
        else throw new ArgumentException("Use an original team/match tactic.");
        if (NegotiationActions.Channel(setpiece, tactic, "SetPiece").Identity != target.GetPersistentIdentity()) throw new ArgumentException("Set-piece reference belongs to another tactic.");
        var root = LiveTools.GetReference(setpiece);
        if (root.GetIl2CppType().FullName != "FM.UI.SetPieceReference") throw new ArgumentException("Use the original SetPieceReference.");
        return root;
    }
    private static LiveTools.Snapshot Channel(string handle, string root, string property)
    {
        var value = NegotiationActions.Channel(handle, root, property);
        if (value.Identity != LiveTools.GetReference(root).GetPersistentIdentity()) throw new ArgumentException("Set-piece channel belongs to another configuration.");
        return value;
    }
    private static void Can(string handle, string root, string property)
    { if (!bool.TryParse(Channel(handle, root, property).Value?.AsString(), out var allowed) || !allowed) throw new InvalidOperationException("Game does not permit " + property); }
    // All taker-list mutations send the game's own list rows (never fabricated ids); the
    // action decides which live list they are selected from.
    private static TypedValue Rows(string list, string paths, string prefix = "")
    {
        var selected = JsonSerializer.Deserialize<string[]>(paths) ?? throw new ArgumentException("Select original list row paths.");
        if (selected.Length == 0 || selected.Length > 100 || selected.Distinct().Count() != selected.Length || selected.Any(string.IsNullOrWhiteSpace))
            throw new ArgumentException("Choose a nonempty, distinct original selection.");
        // Current-build metadata declares GetSelectedItems as List<TypedValue>.
        var values = new Il2CppSystem.Collections.Generic.List<TypedValue>();
        foreach (var path in selected)
        {
            if (!int.TryParse(path, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var index) ||
                index < 0 || path != index.ToString(System.Globalization.CultureInfo.InvariantCulture))
                throw new ArgumentException("Choose a full original list row by its list index, not an arbitrary nested record.");
            var row = LiveTools.GetValue(list, prefix + path);
            // 点球候选列表直接返回 FM.UI.PersonReference (InteropReference)，需兼容 Record 与 InteropReference 两种原生行
            var record = NegotiationActions.Record(row);
            var isPersonRef = record == null && row?.Get()?.TryCast<InteropReference>() != null;
            if (record == null && !isPersonRef) throw new ArgumentException("Select a full original player row, not an ID or name.");
            if (record != null && (NegotiationActions.Flag(record, "Disabled", false) || NegotiationActions.Flag(record, "IsDisabled", false))) throw new InvalidOperationException("Game disabled a selected player.");
            // 若为UI绑定包装记录，优先提取内嵌的真实球员引用(0x706c7972/plyr)，以便底层游戏引擎准确解析目标球员
            if (record != null)
            {
                var person = NegotiationActions.Field(record, "Person", false)
                          ?? NegotiationActions.Field(record, "Player", false)
                          ?? NegotiationActions.Field(record, "0x706c7972", false);
                if (person != null && !person.IsNull && person.Get()?.TryCast<InteropReference>() != null)
                {
                    values.Add(TypedValue.CreateCopyFrom(person));
                    continue;
                }
            }
            values.Add(TypedValue.CreateCopyFrom(row));
        }
        return GameTools.MakeObjectTypedValue(values);
    }
    // The original table binds TakerDataForSide.SetPieceTakerList.
    private const string SideTakerPath = "0x38435761";
    private static TypedValue SideTakers(string handle, string setpiece)
    {
        Channel(handle, setpiece, "SetPieceTakerDataForSide");
        return LiveTools.GetValue(handle, SideTakerPath);
    }

    private static (InteropReference Root, TypedValue Data, uint Event, string Token) Prepare(string action, string team, string tactic, string setpiece,
        string candidates, string left, string right, string penalties, string takerList, string penaltyCandidates, string paths, int destination)
    {
        var root = Resolve(team, tactic, setpiece);
        TypedValue data; uint eventId; string offered;
        switch (action)
        {
            case "penalty-quick-pick":
                offered = NativeValueFingerprint.Compute(Channel(penalties, setpiece, "SetPiecePenaltyTakersList").Value);
                data = TypedValue.Create(true); eventId = (uint)InteropEventIDs.EventFmxPenaltyTakerQuickPick;
                break;
            case "add-left":
            case "add-right":
            case "add-both":
                if (action == "add-left" || action == "add-both") Can(left, setpiece, "CanAddToLeftFootTakers");
                if (action == "add-right" || action == "add-both") Can(right, setpiece, "CanAddToRightFootTakers");
                offered = NativeValueFingerprint.Compute(Channel(candidates, setpiece, "SetPieceTakerAddPlayerList").Value);
                data = Rows(candidates, paths);
                eventId = action == "add-left" ? (uint)InteropEventIDs.EventFmxAddSetPieceLeftFooter : action == "add-right" ?
                    (uint)InteropEventIDs.EventFmxAddSetPieceRightFooter : (uint)InteropEventIDs.EventFmxAddSetPieceBothFeet;
                break;
            case "remove":
                offered = NativeValueFingerprint.Compute(SideTakers(takerList, setpiece));
                data = Rows(takerList, paths, SideTakerPath + "/");
                eventId = (uint)InteropEventIDs.EventFmxSetPieceTakerRemoveFromList;
                break;
            case "move":
            case "penalty-move":
                var moveList = action == "move" ? SideTakers(takerList, setpiece) :
                    Channel(penalties, setpiece, "SetPiecePenaltyTakersList").Value;
                offered = NativeValueFingerprint.Compute(moveList);
                var selection = JsonSerializer.Deserialize<string[]>(paths);
                var list = moveList?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
                if (list == null || selection?.Length != 1 || !int.TryParse(selection[0], out var source) ||
                    source < 0 || source >= list.Count || destination < 0 || destination >= list.Count || source == destination)
                    throw new ArgumentException("Choose one source row and a different destination in the live taker list.");
                var row = list[source];
                if (NegotiationActions.Record(row) == null) throw new ArgumentException("Expected a native set-piece taker row.");
                var moved = new SI.Bindable.DynamicReference();
                moved[0x4c205842] = TypedValue.CreateCopyFrom(row);
                moved[0x6a466259] = TypedValue.Create(destination);
                data = GameTools.MakeObjectTypedValue(moved);
                eventId = action == "move" ? (uint)InteropEventIDs.EventFmxSetPieceTakerMove :
                    (uint)InteropEventIDs.EventFmxSetPiecePenaltyCandidatesMove;
                break;
            case "penalty-add":
                offered = NativeValueFingerprint.Compute(Channel(penaltyCandidates, setpiece, "SetPiecePenaltyCandidatesList").Value);
                data = Rows(penaltyCandidates, paths);
                eventId = (uint)InteropEventIDs.EventFmxSetPiecePenaltyCandidatesAdd;
                break;
            case "penalty-remove":
                offered = NativeValueFingerprint.Compute(Channel(penalties, setpiece, "SetPiecePenaltyTakersList").Value);
                data = Rows(penalties, paths);
                eventId = (uint)InteropEventIDs.EventFmxSetPiecePenaltyCandidatesRemove;
                break;
            default:
                throw new ArgumentException("Use add-left/add-right/add-both/remove/move/penalty-move/penalty-add/penalty-remove/penalty-quick-pick.");
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), tactic = LiveTools.GetReference(tactic).GetPersistentIdentity(), setpiece = root.GetPersistentIdentity(),
            left = NativeValueFingerprint.Compute(Channel(left, setpiece, "CanAddToLeftFootTakers").Value),
            right = NativeValueFingerprint.Compute(Channel(right, setpiece, "CanAddToRightFootTakers").Value),
            penalties = NativeValueFingerprint.Compute(Channel(penalties, setpiece, "SetPiecePenaltyTakersList").Value),
            takers = NativeValueFingerprint.Compute(SideTakers(takerList, setpiece)),
            candidates = NativeValueFingerprint.Compute(Channel(candidates, setpiece, "SetPieceTakerAddPlayerList").Value),
            penaltyCandidates = NativeValueFingerprint.Compute(Channel(penaltyCandidates, setpiece, "SetPiecePenaltyCandidatesList").Value),
            sideContexts = Channel(takerList, setpiece, "SetPieceTakerDataForSide").Contexts,
            offered, payload = NativeValueFingerprint.Compute(data) }));
        return (root, data, eventId, token);
    }
    public static object Read(string team, string tactic, string setpiece, string candidates, string left, string right, string penalties, string takerList, string penaltyCandidates)
    {
        var root = Resolve(team, tactic, setpiece);
        return new { ok = true, targetIdentity = root.GetPersistentIdentity(),
            takers = LiveTools.DescribeValue(SideTakers(takerList, setpiece), 8),
            candidates = LiveTools.DescribeValue(Channel(candidates, setpiece, "SetPieceTakerAddPlayerList").Value, 8),
            canAddLeft = LiveTools.DescribeValue(Channel(left, setpiece, "CanAddToLeftFootTakers").Value),
            canAddRight = LiveTools.DescribeValue(Channel(right, setpiece, "CanAddToRightFootTakers").Value),
            penaltyTakers = LiveTools.DescribeValue(Channel(penalties, setpiece, "SetPiecePenaltyTakersList").Value, 8),
            penaltyCandidates = LiveTools.DescribeValue(Channel(penaltyCandidates, setpiece, "SetPiecePenaltyCandidatesList").Value, 8),
            liveVerified = false };
    }
    public static object Preview(string action, string team, string tactic, string setpiece, string candidates, string left, string right, string penalties,
        string takerList, string penaltyCandidates, string paths, int destination)
    {
        var p = Prepare(action, team, tactic, setpiece, candidates, left, right, penalties, takerList, penaltyCandidates, paths, destination);
        return new { ok = true, action, choiceToken = p.Token, eventId = p.Event, payload = LiveTools.DescribeValue(p.Data, 8), liveVerified = false };
    }
    public static object Execute(string id, string action, string team, string tactic, string setpiece, string candidates, string left, string right, string penalties,
        string takerList, string penaltyCandidates, string paths, int destination, string token)
    {
        var p = Prepare(action, team, tactic, setpiece, candidates, left, right, penalties, takerList, penaltyCandidates, paths, destination);
        if (p.Token != token) throw new InvalidOperationException("Set-piece selection or legal candidates changed; preview again.");
        LiveTools.RequireUnusedDraft(p.Root);
        return ActionCommands.DispatchDomain(id, "setpiece_takers." + action, p.Root.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Root, p.Data), null, null, "setpiece_takers_business_dispatch_only");
    }
}
