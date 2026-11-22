using System;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;

namespace FMAssistant;

public static class BudgetCommands
{
    private static string Target(string budget)
    {
        var reference = LiveTools.GetReference(budget);
        if (reference.GetIl2CppType().FullName != "FM.UI.ClubBudgetAdjustmentReference") throw new ArgumentException("A real club budget adjustment reference is required.");
        var source = LiveTools.GetSnapshot(budget);
        if (!source.Ready || source.Property != InternalCommands.PropertyId("BudgetAdjustment") || !string.IsNullOrEmpty(source.SourcePath))
            throw new ArgumentException("Resolve budget adjustment from the active manager's club.");
        var club = LiveTools.GetSnapshot(source.Source);
        if (!club.Ready || club.Source != "human" || club.Property != InternalCommands.PropertyId("Club") ||
            !string.IsNullOrEmpty(club.SourcePath) || club.Identity != LiveTools.GetReference("human").GetPersistentIdentity())
            throw new ArgumentException("Budget adjustment does not belong to the active manager's club.");
        return reference.GetPersistentIdentity();
    }

    private static LiveTools.Snapshot BudgetChannel(string handle, string budget, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != budget || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Identity != Target(budget) || snapshot.Property != InternalCommands.PropertyId(property))
            throw new ArgumentException("A current budget adjustment subscription is required: " + property);
        return snapshot;
    }

    // Native current build: 1802552d0 validates an index into its legal allocation vector.
    // This edits the game's budget draft; it does not write a transfer/wage budget balance.
    public static object Adjust(string id, string budget, string current, string limits, string editable, int index, string expected)
    {
        var snapshot = BudgetChannel(current, budget, "BudgetAdjustmentSliderValue");
        var properties = BudgetChannel(limits, budget, "BudgetAdjustmentSliderProps");
        var allowed = BudgetChannel(editable, budget, "BudgetAdjustmentCanEditBudgets");
        if (!bool.TryParse(allowed.Value?.AsString(), out var canEdit) || !canEdit) throw new InvalidOperationException("Game does not currently permit budget allocation.");
        if (snapshot.Value?.AsString() != expected) throw new InvalidOperationException("Budget draft changed; refresh before applying.");
        var range = properties.Value?.Get()?.TryCast<SI.Core.Record>() ?? throw new ArgumentException("Budget allocation range is unavailable.");
        if (!range.TryGetValue(InternalCommands.PropertyId("MinValue"), out var minValue) ||
            !range.TryGetValue(InternalCommands.PropertyId("MaxValue"), out var maxValue) ||
            !double.TryParse(minValue.AsString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var min) ||
            !double.TryParse(maxValue.AsString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var max) ||
            index < min || index > max) throw new ArgumentException("Select a legal allocation step from the game's slider range.");
        LiveTools.RequireUnusedDraft(LiveTools.GetReference(budget));
        return CommandOperations.Start(id, "stage_budget_allocation", snapshot.Identity,
            LiveTools.JsonText(new { index, expected }), current, index.ToString(CultureInfo.InvariantCulture), "budget_draft",
            () => LiveTools.UpdateProperty(current, TypedValue.Create((float)index)));
    }

    private static string ConfirmToken(string budget, string current, string editable, string transfer, string other)
    {
        var index = BudgetChannel(current, budget, "BudgetAdjustmentSliderValue");
        var allowed = BudgetChannel(editable, budget, "BudgetAdjustmentCanEditBudgets");
        var transferValue = BudgetChannel(transfer, budget, "BudgetAdjustmentEditedTransferValue");
        var otherValue = BudgetChannel(other, budget, "BudgetAdjustmentEditedOtherValue");
        if (!bool.TryParse(allowed.Value?.AsString(), out var canEdit) || !canEdit) throw new InvalidOperationException("Game does not allow confirming this budget allocation.");
        return DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = Target(budget), index = index.Value.AsString(), transfer = transferValue.Value.AsString(), other = otherValue.Value.AsString() }));
    }

    public static object PreviewConfirm(string budget, string current, string editable, string transfer, string other) =>
        new { ok = true, confirmationToken = ConfirmToken(budget, current, editable, transfer, other),
            note = "Edited budget values are the game's display text, not authoritative raw money amounts." };

    public static object Confirm(string id, string budget, string current, string editable, string transfer, string other, string expectedToken)
    {
        var token = ConfirmToken(budget, current, editable, transfer, other);
        if (token != expectedToken) throw new InvalidOperationException("Budget allocation changed after preview; refresh before confirming.");
        var target = LiveTools.GetReference(budget);
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "confirm_budget_allocation", target.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxBudgetAdjustmentConfirm, target, null),
            null, null, "dispatch_history_only");
    }
}
