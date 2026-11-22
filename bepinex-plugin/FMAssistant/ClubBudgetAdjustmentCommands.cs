using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Club budget adjustment dialog (ClubBudgetAdjustmentDialog asset, current build):
// budget = human.Club.BudgetAdjustment (ClubBudgetAdjustmentReference), confirm event 146 with target=budget
// and null data, gated by BudgetAdjustmentCanEditBudgets. Slider value editing is not wired here.
// Evidence: v81-club-budget-adjustment.json. Not live-verified.
public static class ClubBudgetAdjustmentCommands
{
    private static InteropReference Resolve(string budget)
    {
        var target = LiveTools.GetReference(budget);
        var snapshot = LiveTools.GetSnapshot(budget);
        if (target.GetIl2CppType().FullName != "FM.UI.ClubBudgetAdjustmentReference" || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("BudgetAdjustment"))
            throw new ArgumentException("Resolve the actual Club.BudgetAdjustment reference.");
        return target;
    }
    private static LiveTools.Snapshot Channel(string handle, string budget, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != budget || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong budget adjustment subscription: " + property);
        return snapshot;
    }
    public static object Read(string budget, string canEdit, string board, string currentSpend, string ffp, string scouting, string agentFees)
    {
        var target = Resolve(budget);
        var editable = Channel(canEdit, budget, "BudgetAdjustmentCanEditBudgets");
        if (!bool.TryParse(editable.Value?.AsString(), out var allowed)) throw new ArgumentException("Native budget edit flag is not ready.");
        return new { ok = true, budgetIdentity = target.GetPersistentIdentity(), canEditBudgets = allowed,
            boardString = LiveTools.DescribeValue(Channel(board, budget, "BudgetAdjustmentBoardString").Value),
            currentSpendString = LiveTools.DescribeValue(Channel(currentSpend, budget, "BudgetAdjustmentCurrentSpendString").Value),
            ffpString = LiveTools.DescribeValue(Channel(ffp, budget, "BudgetAdjustmentFFpString").Value),
            scoutingBudgetString = LiveTools.DescribeValue(Channel(scouting, budget, "BudgetAdjustmentScoutingBudgetString").Value),
            agentFeesString = LiveTools.DescribeValue(Channel(agentFees, budget, "BudgetAdjustmentAgentFeesString").Value),
            draftOnly = true, liveVerified = false };
    }
    private static (InteropReference Target, string Token) Prepare(string budget, string canEdit)
    {
        var target = Resolve(budget);
        var editable = Channel(canEdit, budget, "BudgetAdjustmentCanEditBudgets");
        if (!bool.TryParse(editable.Value?.AsString(), out var allowed) || !allowed)
            throw new InvalidOperationException("Game does not allow editing this club budget.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "confirm-budget-adjustment", identity = target.GetPersistentIdentity(),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, token);
    }
    public static object Preview(string budget, string canEdit)
    {
        var p = Prepare(budget, canEdit);
        return new { ok = true, nativeEvent = 146u, choiceToken = p.Token, payload = (object)null, draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string budget, string canEdit, string token)
    {
        var p = Prepare(budget, canEdit);
        if (token != p.Token) throw new InvalidOperationException("Club budget draft changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "club_budget_adjustment_confirm", p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(146u, p.Target, null);
        }, null, null, "club_budget_adjustment_confirm");
    }
}
