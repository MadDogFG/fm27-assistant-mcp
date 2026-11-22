using System;
using System.Collections.Generic;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// UI assets StatesSetPieceWizardStart/Setup: CreatorStart has no payload;
// CreatorNextStep passes the selected original AnswerList record. StateSetPieceWizardCreation
// sends CompletedTransition(true) only after the last answer enters the native creation phase.
public static class SetPieceCreatorCommands
{
    private static LiveTools.Snapshot Channel(string h, string creator, string property)
    {
        var s = LiveTools.GetSnapshot(h);
        if (!s.Ready || s.Source != creator || !string.IsNullOrEmpty(s.SourcePath) ||
            s.Identity != LiveTools.GetReference(creator).GetPersistentIdentity() || s.Property != InternalCommands.PropertyId(property))
            throw new ArgumentException("Wrong creator channel: " + property);
        return s;
    }
    private static bool Flag(LiveTools.Snapshot s) => bool.TryParse(s.Value?.AsString(), out var b) ? b : throw new InvalidOperationException("Creator flag unavailable.");
    private static InteropReference Target(string creator)
    {
        var target = LiveTools.GetReference(creator);
        var root = LiveTools.GetSnapshot(creator);
        if (!root.Ready || !string.IsNullOrEmpty(root.SourcePath) ||
            root.Property != InternalCommands.PropertyId("SetPieceCreator") ||
            target.GetIl2CppType().FullName != "FM.UI.SetPieceCreatorReference")
            throw new ArgumentException("Resolve the current tactic's SetPieceCreator.");
        var tactic = LiveTools.GetSnapshot(root.Source);
        if (!tactic.Ready || !string.IsNullOrEmpty(tactic.SourcePath) ||
            tactic.Property != InternalCommands.PropertyId("Tactic") ||
            LiveTools.GetReference(root.Source).GetIl2CppType().FullName != "FM.UI.TeamTacticReference")
            throw new ArgumentException("Use the manager's team tactic, not a match or another source.");
        var team = LiveTools.GetSnapshot(tactic.Source);
        if (!team.Ready || team.Source != "human" || !string.IsNullOrEmpty(team.SourcePath) ||
            team.Property != InternalCommands.PropertyId("Team") ||
            team.Identity != LiveTools.GetReference("human").GetPersistentIdentity())
            throw new ArgumentException("Set-piece creator does not belong to the active manager's team.");
        ContractCommands.Context(root, 0x50625059, LiveTools.GetReference("human").GetPersistentIdentity());
        return target;
    }
    public static object Read(string creator, string started, string completed, string question, string answers,
        string step, string substep, string state, string final, string maxStep, string maxSubstep)
    {
        var target = Target(creator);
        var options = Channel(answers, creator, "AnswerList").Value;
        var rows = options?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
        var choices = new List<object>();
        if (rows != null) for (var index = 0; index < rows.Count; index++) {
            var row = NegotiationActions.Record(rows[index]);
            var preferred = row != null && row.TryGetValue(0x5862734b, out var value) &&
                bool.TryParse(value?.AsString(), out var isPreferred) && isPreferred;
            choices.Add(new { index, optionPath = index.ToString(), staffPreferred = preferred, answer = LiveTools.DescribeValue(rows[index]) });
        }
        return new { ok = true, creatorIdentity = target.GetPersistentIdentity(), sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            started = Flag(Channel(started, creator, "HasSetPieceCreatorStarted")),
            completed = Flag(Channel(completed, creator, "HasSetPieceCreatorCompleted")),
            questionId = LiveTools.DescribeValue(Channel(question, creator, "QuestionID").Value),
            step = LiveTools.DescribeValue(Channel(step, creator, "CurrentCreatorStep").Value),
            substep = LiveTools.DescribeValue(Channel(substep, creator, "CurrentCreatorSubstep").Value),
            maxStep = LiveTools.DescribeValue(Channel(maxStep, creator, "MaxCreatorStep").Value),
            maxSubstep = LiveTools.DescribeValue(Channel(maxSubstep, creator, "MaxSubstep").Value),
            state = LiveTools.DescribeValue(Channel(state, creator, "SetPieceCreatorState").Value),
            finalQuestion = Flag(Channel(final, creator, "IsFinalQuestion")), choices,
            verificationScope = "set_piece_creator_state_not_applied_routines", liveVerified = false };
    }
    private static (InteropReference Target, TypedValue Payload, uint Event, string Token) Prepare(string action, string creator, string started, string completed, string question, string answers, string optionPath,
        string step, string substep, string state, string final, string maxStep, string maxSubstep)
    {
        var target = Target(creator);
        var st = Channel(started, creator, "HasSetPieceCreatorStarted");
        var done = Channel(completed, creator, "HasSetPieceCreatorCompleted");
        var q = Channel(question, creator, "QuestionID");
        var options = Channel(answers, creator, "AnswerList");
        int Number(string handle, string property) => int.TryParse(Channel(handle, creator, property).Value?.AsString(), out var number)
            ? number : throw new InvalidOperationException("Creator phase number unavailable: " + property);
        var phase = Number(state, "SetPieceCreatorState");
        var currentStep = Number(step, "CurrentCreatorStep");
        var currentSubstep = Number(substep, "CurrentCreatorSubstep");
        var lastStep = Number(maxStep, "MaxCreatorStep");
        var lastSubstep = Number(maxSubstep, "MaxSubstep");
        var finalQuestion = Flag(Channel(final, creator, "IsFinalQuestion"));
        if (Flag(done)) throw new InvalidOperationException("Creator is already completed.");
        TypedValue payload = null;
        uint ev;
        if (action == "start") {
            if (Flag(st) || phase != 1) throw new InvalidOperationException("Creator is not in its initial phase.");
            ev = 1768189304u;
        } else if (action == "next") {
            if (!Flag(st) || phase != 2) throw new InvalidOperationException("Creator is not accepting an answer; do not repeat next during creation.");
            if (!int.TryParse(optionPath, out var index) || index < 0 || index.ToString() != optionPath) throw new ArgumentException("Select an actual answer list index.");
            payload = LiveTools.GetValue(answers, optionPath);
            if (payload == null || payload.IsNull || NegotiationActions.Record(payload) == null) throw new ArgumentException("Answer is not an original native record.");
            var answer = NegotiationActions.Record(payload);
            if (NegotiationActions.Flag(answer, "IsDisabled", false) || NegotiationActions.Flag(answer, "Disabled", false))
                throw new InvalidOperationException("The game disabled this answer.");
            ev = 1684360497u;
        } else if (action == "finish") {
            if (!Flag(st) || phase != 3 || !finalQuestion || lastStep < 1 || lastSubstep < 1 ||
                currentStep != lastStep || currentSubstep != lastSubstep)
                throw new InvalidOperationException("Finish is allowed only in the native creation phase after the final answer.");
            ev = 1800687939u;
            payload = TypedValue.Create(true);
        } else throw new ArgumentException("Use start, next or finish.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action,
            identity = target.GetPersistentIdentity(),
            step = currentStep, substep = currentSubstep, maxStep = lastStep, maxSubstep = lastSubstep, state = phase,
            finalQuestion, question = NativeValueFingerprint.Compute(q.Value), answers = NativeValueFingerprint.Compute(options.Value),
            started = Flag(st), completed = Flag(done), payload = NativeValueFingerprint.Compute(payload), revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, ev, token);
    }
    public static object Preview(string action, string creator, string started, string completed, string question, string answers, string optionPath,
        string step, string substep, string state, string final, string maxStep, string maxSubstep)
    {
        var p = Prepare(action, creator, started, completed, question, answers, optionPath, step, substep, state, final, maxStep, maxSubstep);
        return new { ok = true, action, nativeEvent = p.Event, choiceToken = p.Token,
            sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, creatorIdentity = p.Target.GetPersistentIdentity(),
            started = Flag(Channel(started, creator, "HasSetPieceCreatorStarted")),
            completed = Flag(Channel(completed, creator, "HasSetPieceCreatorCompleted")),
            state = LiveTools.DescribeValue(Channel(state, creator, "SetPieceCreatorState").Value),
            step = LiveTools.DescribeValue(Channel(step, creator, "CurrentCreatorStep").Value),
            substep = LiveTools.DescribeValue(Channel(substep, creator, "CurrentCreatorSubstep").Value),
            questionId = LiveTools.DescribeValue(Channel(question, creator, "QuestionID").Value),
            payload = p.Payload == null ? null : LiveTools.DescribeValue(p.Payload),
            verificationScope = "set_piece_creator_dispatch_not_applied_routines", liveVerified = false };
    }
    public static object Execute(string id, string action, string creator, string started, string completed, string question, string answers, string optionPath, string token,
        string step, string substep, string state, string final, string maxStep, string maxSubstep)
    {
        var p = Prepare(action, creator, started, completed, question, answers, optionPath, step, substep, state, final, maxStep, maxSubstep);
        if (p.Token != token) throw new InvalidOperationException("Creator changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "set_piece_creator_" + action, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, "set_piece_creator_" + action);
    }
}
