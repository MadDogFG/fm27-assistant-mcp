using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Set-piece routine editing: the game opens an edit session, then the routine properties
// (instructions, delivery, frequency, ...) are ordinary bindable option channels. This
// command only updates a channel with the option row the game itself returned; no payload
// shapes are invented and no save-specific data is used.
public static class SetPieceEditCommands
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
    private static LiveTools.Snapshot Channel(string handle, string root, string property, string expectedIdentity, bool checkIdentity)
    {
        var value = NegotiationActions.Channel(handle, root, property);
        if (checkIdentity && value.Identity != expectedIdentity) throw new ArgumentException("Set-piece channel belongs to another configuration.");
        return value;
    }
    private sealed record Prepared(InteropReference Root, uint Event, TypedValue Data, string ChannelHandle, string Token);
    private static Prepared Prepare(string action, string team, string tactic, string setpiece, string channel, string property, string options, string optionPath, string routine = "")
    {
        var root = Resolve(team, tactic, setpiece);
        var channelRoot = setpiece;
        var expectedIdentity = root.GetPersistentIdentity();
        var checkIdentity = true;
        if (!string.IsNullOrWhiteSpace(routine))
        {
            var routineSnap = NegotiationActions.Channel(routine, setpiece, "CurrentSetPieceRoutine");
            if (routineSnap.Identity != expectedIdentity)
                throw new ArgumentException("Set-piece routine belongs to another set-piece configuration.");
            channelRoot = routine;
            checkIdentity = false;
        }
        if (action == "option")
        {
            if (string.IsNullOrWhiteSpace(channel) || string.IsNullOrWhiteSpace(property)) throw new ArgumentException("Provide the live channel handle and its property name.");
            var current = Channel(channel, channelRoot, property, expectedIdentity, checkIdentity);
            var leaf = NativeChoiceTree.Leaf(options, optionPath, false);
            var payload = leaf;
            if ((current.Value?.DataType?.FullName ?? "") == "SI.Core.DynamicNumber" && Record(leaf) is { } leafRec)
            {
                var pv = Field(leafRec, "PropertyValue", false);
                if (pv != null && !pv.IsNull) payload = TypedValue.CreateCopyFrom(pv);
            }
            var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action = "option",
                human = LiveTools.GetReference("human").GetPersistentIdentity(), setpiece = root.GetPersistentIdentity(), channelScope = string.IsNullOrWhiteSpace(routine) ? "setpiece" : "routine", channel = current.Property.ToString(),
                current = NativeValueFingerprint.Compute(current.Value), payload = NativeValueFingerprint.Compute(payload) }));
            return new Prepared(root, 0, payload, channel, token);
        }
        if (action == "begin" || action == "end" || action == "cancel")
        {
            var eventId = action == "begin" ? (uint)InteropEventIDs.EventFmxSetPieceEditSessionBegin :
                action == "end" ? (uint)InteropEventIDs.EventFmxSetPieceEditSessionEnd : (uint)InteropEventIDs.EventFmxSetPieceEditSessionCancel;
            var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action = "session." + action,
                human = LiveTools.GetReference("human").GetPersistentIdentity(), setpiece = root.GetPersistentIdentity(), eventId }));
            return new Prepared(root, eventId, TypedValue.Create(true), "", token);
        }
        throw new ArgumentException("Use option, begin, end or cancel.");
    }
    public static object Preview(string action, string team, string tactic, string setpiece, string channel, string property, string options, string optionPath, string routine = "")
    {
        var p = Prepare(action, team, tactic, setpiece, channel, property, options, optionPath, routine);
        return new { ok = true, action, choiceToken = p.Token, eventId = p.Event, payload = LiveTools.DescribeValue(p.Data, 8), liveVerified = false };
    }
    public static object Execute(string id, string action, string team, string tactic, string setpiece, string channel, string property, string options, string optionPath, string token, string routine = "")
    {
        var p = Prepare(action, team, tactic, setpiece, channel, property, options, optionPath, routine);
        if (p.Token != token) throw new InvalidOperationException("Set-piece routine or option changed; preview again.");
        LiveTools.RequireUnusedDraft(p.Root);
        if (action == "option")
            return ActionCommands.DispatchDomain(id, "set_piece_edit.option", p.Root.GetPersistentIdentity(), token,
                () => LiveTools.UpdateProperty(p.ChannelHandle, p.Data), null, null, "set_piece_option_update");
        return ActionCommands.DispatchDomain(id, "set_piece_edit." + action, p.Root.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Root, p.Data), null, null, "set_piece_edit_session");
    }
}
