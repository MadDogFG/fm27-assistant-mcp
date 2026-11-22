using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Apply opposition-instruction advice to the tactic. Full UI index (evidence/v97-opposition-apply-advice.json):
// OppositionInstructionsBlock fires OppositionInstructionsApplyAdvice (1853321843) with target=Tactic and
// data=Tactic.AllOppositionInstructionSuggestions (property 0x5a37356b; the current-only suggestions
// property name is plural in the asset but not registered, so only the all-suggestions variant is wired).
// Static evidence only; no live dispatch.
public static class OppositionAdviceCommands
{
    private static InteropReference Resolve(string tactic)
    {
        var target = LiveTools.GetReference(tactic);
        var snapshot = LiveTools.GetSnapshot(tactic);
        var type = target.GetIl2CppType().FullName ?? "";
        if (!type.EndsWith("TacticReference", StringComparison.Ordinal) || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("Tactic"))
            throw new ArgumentException("Resolve the actual current Tactic reference.");
        return target;
    }
    private static TypedValue Suggestions(string handle, string tactic)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != tactic || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId("AllOppositionInstructionSuggestions"))
            throw new ArgumentException("Provide the tactic's AllOppositionInstructionSuggestions channel.");
        if (snapshot.Value == null || snapshot.Value.IsNull) throw new ArgumentException("Opposition instruction suggestions are empty.");
        return TypedValue.CreateCopyFrom(snapshot.Value);
    }
    private static (InteropReference Target, TypedValue Payload, string Token) Prepare(string tactic, string suggestions)
    {
        var target = Resolve(tactic);
        var payload = Suggestions(suggestions, tactic);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "apply-opposition-instruction-advice", identity = target.GetPersistentIdentity(),
            payload = NativeValueFingerprint.Compute(payload), revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, token);
    }
    public static object Preview(string tactic, string suggestions)
    {
        var p = Prepare(tactic, suggestions);
        return new { ok = true, nativeEvent = 1853321843u, choiceToken = p.Token, payload = LiveTools.DescribeValue(p.Payload),
            draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string tactic, string suggestions, string token)
    {
        var p = Prepare(tactic, suggestions);
        if (token != p.Token) throw new InvalidOperationException("Opposition suggestions changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "apply_opposition_instruction_advice", p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1853321843u, p.Target, p.Payload);
        }, null, null, "apply_opposition_instruction_advice");
    }
}
