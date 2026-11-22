using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace FMAssistant;

// These are native training-unit involvement/attribute summaries. The current
// shipped source does not establish a player-membership editor for these records.
public static class TrainingUnitCommands
{
    private static readonly string[] Properties = { "AttackingUnit", "DefensiveUnit", "MidfieldUnit", "GoalkeepingUnit" };
    public static object Read(string team, string training, string channels)
    {
        var origin = NegotiationActions.Channel(team, "human", "Team");
        if (origin.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the active manager's actual team.");
        NegotiationActions.Channel(training, team, "TeamTraining");
        var target = LiveTools.GetReference(training);
        if (target.GetIl2CppType().FullName != "FM.UI.TeamTrainingReference") throw new ArgumentException("Use actual team training.");
        var handles = JsonSerializer.Deserialize<Dictionary<string, string>>(channels) ?? throw new ArgumentException("Actual unit channels are required.");
        if (handles.Count != Properties.Length || Properties.Any(name => !handles.ContainsKey(name))) throw new ArgumentException("Supply all four current training-unit summary channels.");
        var units = new List<object>();
        foreach (var property in Properties)
        {
            var snapshot = NegotiationActions.Channel(handles[property], training, property);
            if (snapshot.Identity != target.GetPersistentIdentity() || snapshot.Value == null || snapshot.Value.IsNull)
                throw new InvalidOperationException("Native training-unit summary is not ready: " + property);
            units.Add(new { unit = property, value = LiveTools.DescribeValue(snapshot.Value), revision = snapshot.Revision });
        }
        return new { ok = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, teamIdentity = LiveTools.GetReference(team).GetPersistentIdentity(),
            units, playerGroupingImplemented = false, writableMembershipProtocolRecovered = false,
            scope = "native_training_unit_involvement_and_attribute_summaries",
            note = "Current recovered unit records describe training involvement and attributes; no player-membership editor is established by the inspected UI/SDK/native handler.", liveVerified = false };
    }
}
