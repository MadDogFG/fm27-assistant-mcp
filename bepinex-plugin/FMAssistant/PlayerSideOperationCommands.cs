using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Player-operation side actions recovered from the full UI index (evidence/v86-player-side-operations.json):
// 911762251 AssistantAssignIndividualTraining: target team.TeamTraining, data const.NullRef
// 134 DiscardPlayerFromAgentsOfferedList: target human, data player.Person
// 1316449644 DiscardAllPlayersFromAgentsOfferedList: target human, data null
// All are static evidence only; no live dispatch.
public static class PlayerSideOperationCommands
{
    private static InteropReference ResolveTraining(string training)
    {
        var target = LiveTools.GetReference(training);
        var snapshot = LiveTools.GetSnapshot(training);
        if (target.GetIl2CppType().FullName != "FM.UI.TeamTrainingReference" || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("TeamTraining"))
            throw new ArgumentException("Resolve the actual TeamTraining reference.");
        return target;
    }
    private static InteropReference ResolvePerson(string person)
    {
        var target = LiveTools.GetReference(person);
        var type = target.GetIl2CppType().FullName ?? "";
        if (!type.EndsWith("PersonReference", StringComparison.Ordinal))
            throw new ArgumentException("Resolve an actual person reference.");
        return target;
    }
    public static object AssistantTraining(string training)
    {
        var target = ResolveTraining(training);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "assistant-assign-individual-training", identity = target.GetPersistentIdentity(),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return new { ok = true, nativeEvent = 911762251u, choiceToken = token, payload = (object)null,
            draftOnly = true, liveVerified = false,
            note = "让助手分配个人训练；结果需独立读取个人训练/职责状态。" };
    }
    public static object ExecuteAssistantTraining(string id, string training, string token)
    {
        var target = ResolveTraining(training);
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "assistant-assign-individual-training", identity = target.GetPersistentIdentity(),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        if (token != expected) throw new InvalidOperationException("Team training changed since preview.");
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "assistant_assign_individual_training", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(911762251u, target, null);
        }, null, null, "assistant_individual_training_dispatch");
    }
    public static object DiscardOfferPreview(string person, bool all)
    {
        var human = LiveTools.GetReference("human");
        InteropReference subject = null;
        if (!all) subject = ResolvePerson(person);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = all ? "discard-all-agent-offers" : "discard-agent-offer", human = human.GetPersistentIdentity(),
            person = subject?.GetPersistentIdentity() }));
        return new { ok = true, action = all ? "discard-all" : "discard-one",
            nativeEvent = all ? 1316449644u : 134u, choiceToken = token,
            payload = subject == null ? null : subject.GetPersistentIdentity(), draftOnly = true, liveVerified = false };
    }
    public static object ExecuteDiscardOffer(string id, string person, bool all, string token)
    {
        var human = LiveTools.GetReference("human");
        InteropReference subject = null;
        if (!all) subject = ResolvePerson(person);
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = all ? "discard-all-agent-offers" : "discard-agent-offer", human = human.GetPersistentIdentity(),
            person = subject?.GetPersistentIdentity() }));
        if (token != expected) throw new InvalidOperationException("Agent offer list changed since preview.");
        LiveTools.RequireUnusedDraft(human);
        var payload = subject == null ? null : GameTools.MakeObjectTypedValue(subject);
        return ActionCommands.DispatchDomain(id, all ? "discard_all_agent_offers" : "discard_agent_offer",
            human.GetPersistentIdentity(), token, () => {
                SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(all ? 1316449644u : 134u, human, payload);
            }, null, null, "agent_offers_discard");
    }
}
