using System;
using System.Collections.Generic;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// TrainingCoachAssignmentBlock buttons target the real TeamTraining reference.
// CoachAssignments is IDataReference and deliberately has no invented persistent ID.
public static class TrainingManagementCommands
{
    private static readonly HashSet<string> Categories = new(StringComparer.Ordinal) { "AttackingTacticalCategory", "AttackingTechnicalCategory", "DefendingTacticalCategory", "DefendingTechnicalCategory",
        "PossessionTacticalCategory", "PossessionTechnicalCategory", "GoalkeepingCategory", "FitnessCategory", "SetPiecesCategory" };
    private sealed record Prepared(InteropReference Target, uint Event, string Token);
    private static Prepared Prepare(string operation, string team, string training, string assignments, string rows)
    {
        if (operation != "assistant_assign" && operation != "clear") throw new ArgumentException("Unknown coach-assignment operation.");
        var teamChannel = NegotiationActions.Channel(team, "human", "Team");
        if (teamChannel.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the current manager's actual team.");
        NegotiationActions.Channel(training, team, "TeamTraining");
        var target = LiveTools.GetReference(training);
        if (target.GetIl2CppType().FullName != "FM.UI.TeamTrainingReference") throw new ArgumentException("Use an actual TeamTrainingReference.");
        NegotiationActions.Channel(assignments, training, "CoachAssignments");
        var state = NegotiationActions.Channel(rows, assignments, "Assignments");
        if (state.Value == null || state.Value.IsNull) throw new InvalidOperationException("Actual coach assignments have not loaded.");
        var fingerprint = NativeValueFingerprint.Compute(state.Value);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), team = LiveTools.GetReference(team).GetPersistentIdentity(),
            training = target.GetPersistentIdentity(), operation, assignments = fingerprint }));
        return new Prepared(target, operation == "assistant_assign" ? (uint)InteropEventIDs.EventFmxAssistantAssignCoaches : (uint)InteropEventIDs.EventFmxClearCoaches, token);
    }
    public static object Preview(string operation, string team, string training, string assignments, string rows)
    {
        var p = Prepare(operation, team, training, assignments, rows);
        return new { ok = true, operation, targetIdentity = p.Target.GetPersistentIdentity(), choiceToken = p.Token,
            nativeEvent = p.Event, assignments = LiveTools.DescribeValue(LiveTools.GetSnapshot(rows).Value),
            authorizationScope = "manager_owned_team_and_original_native_command_game_rules_remain_authoritative",
            effect = operation == "assistant_assign" ? "assistant_selects_coaching_assignments" : "clear_coaching_assignments",
            liveVerified = false };
    }
    public static object Execute(string id, string operation, string team, string training, string assignments, string rows, string token)
    {
        var p = Prepare(operation, team, training, assignments, rows);
        if (p.Token != token) throw new InvalidOperationException("Coaching assignments changed; preview again.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "coaching_assignments." + operation, p.Target.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, TypedValue.Null),
            null, null, "coach_assignment_command_dispatch_only");
    }
    private sealed record CategoryState(InteropReference Target, TypedValue EventData, bool Before, bool Editable, string Token);
    private static CategoryState PrepareCategory(string team, string training, string assignments, string rows, string coachPath, string category,
        string categorySource, string current, string editable, string eventData, bool assigned)
    {
        if (!Categories.Contains(category)) throw new ArgumentException("Choose one of the original coaching assignment categories.");
        var teamChannel = NegotiationActions.Channel(team, "human", "Team");
        if (teamChannel.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the active manager's team.");
        NegotiationActions.Channel(training, team, "TeamTraining");
        var target = LiveTools.GetReference(training);
        if (target.GetIl2CppType().FullName != "FM.UI.TeamTrainingReference") throw new ArgumentException("Use actual team training.");
        NegotiationActions.Channel(assignments, training, "CoachAssignments");
        NegotiationActions.Channel(rows, assignments, "Assignments");
        // Exact original row/category source and fields: no caller-provided native payload.
        NegotiationActions.Channel(categorySource, rows, category, coachPath);
        var actual = NegotiationActions.Channel(current, categorySource, "IsAssigned");
        var allowed = NegotiationActions.Channel(editable, categorySource, "CanEdit");
        var payload = NegotiationActions.Channel(eventData, categorySource, "EventData").Value;
        if (actual.Value?.DataType?.FullName != "System.Boolean" || !bool.TryParse(actual.Value.AsString(), out var before) ||
            allowed.Value?.DataType?.FullName != "System.Boolean" || !bool.TryParse(allowed.Value.AsString(), out var canEdit) || payload == null || payload.IsNull)
            throw new InvalidOperationException("Native coaching cell state or business event data is unavailable.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), team = LiveTools.GetReference(team).GetPersistentIdentity(), training = target.GetPersistentIdentity(),
            coachPath, category, before, canEdit, assigned, payload = NativeValueFingerprint.Compute(payload) }));
        return new(target, payload, before, canEdit, token);
    }
    public static object PreviewCategory(string team, string training, string assignments, string rows, string coachPath, string category,
        string categorySource, string current, string editable, string eventData, bool assigned)
    {
        var p = PrepareCategory(team, training, assignments, rows, coachPath, category, categorySource, current, editable, eventData, assigned);
        return new { ok = true, category, assigned = p.Before, requested = assigned, canEdit = p.Editable, choiceToken = p.Token,
            eventData = LiveTools.DescribeValue(p.EventData), verificationScope = "coach_category_assignment_configuration", liveVerified = false };
    }
    public static object SetCategory(string id, string team, string training, string assignments, string rows, string coachPath, string category,
        string categorySource, string current, string editable, string eventData, bool assigned, string token)
    {
        var p = PrepareCategory(team, training, assignments, rows, coachPath, category, categorySource, current, editable, eventData, assigned);
        if (p.Token != token) throw new InvalidOperationException("Coaching category or editable state changed; preview again.");
        if (!p.Editable && p.Before != assigned) throw new InvalidOperationException("The game does not allow changing this coach/category assignment.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "coaching_category." + category, p.Target.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(assigned ? (uint)InteropEventIDs.EventFmxAssignCoach : (uint)InteropEventIDs.EventFmxUnassignCoach,
                p.Target, TypedValue.CreateCopyFrom(p.EventData)), p.Before.ToString(), assigned.ToString(),
            "coach_category_assignment_configuration." + NativeValueFingerprint.Compute(p.EventData));
    }
}
