using System;
using SI.Core;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

internal static class GeneralTrainingControl
{
    internal static (TypedValue Value, bool Owned) Read(string calendar, string channel)
    {
        var value = Channel(channel, calendar, "GeneralTrainingHumanControlled").Value;
        var row = Record(value) ?? throw new InvalidOperationException("Training responsibility is not ready.");
        if (!row.TryGetValue(0x76616c75, out var flag) || !bool.TryParse(flag.AsString(), out var owned))
            throw new InvalidOperationException("Training responsibility has no native control flag.");
        return (value, owned);
    }
    // Mirrors Calendar's normalization before GeneralTrainingControl's YesThisOnce /
    // YesAllGeneralTraining choices. conx selects week vs session; it is not an ownership flag.
    internal static (SI.Core.Record Payload, uint Event, bool VerifyControl) Prepare(
        TypedValue responsibility, string delegation, SI.Core.Record payload, uint normalEvent, bool wholeWeek)
    {
        if (delegation != "respect" && delegation != "take_control_this_once" && delegation != "take_control_all")
            throw new ArgumentException("Unknown general training delegation mode.");
        var row = Record(responsibility) ?? throw new InvalidOperationException("Training responsibility is not ready.");
        if (!row.TryGetValue(0x76616c75, out var flag) || !bool.TryParse(flag.AsString(), out var owned))
            throw new InvalidOperationException("Training responsibility has no native control flag.");
        if (owned) return (payload, normalEvent, false);
        if (delegation == "respect") throw new InvalidOperationException("General training is delegated. Choose the game's take_control_this_once or take_control_all operation explicitly to apply this change.");
        if (!row.TryGetValue(0x4e504c5a, out var responsible) || responsible == null || responsible.IsNull ||
            responsible.DataType?.FullName == "SI.Core.DynamicNumber" || responsible.Get()?.TryCast<FM.UI.PersonReference>() == null)
            throw new InvalidOperationException("The game has not resolved the actual responsible staff member for its takeover operation.");
        var normalized = new SI.Core.Record();
        if (wholeWeek)
        {
            var eventData = Record(Field(payload, "EventData")) ?? throw new InvalidOperationException("Week schedule has no native event data.");
            foreach (var pair in eventData) normalized[pair.Key] = TypedValue.CreateCopyFrom(pair.Value);
            normalized[0x43714d41] = TypedValue.CreateCopyFrom(Field(payload, "Date"));
        }
        else
        {
            foreach (var name in new[] { "Date", "WeekStartDate", "SessionIndex", "SessionType" })
                normalized[InternalCommands.PropertyId(name)] = TypedValue.CreateCopyFrom(Field(payload, name));
        }
        normalized[0x636f6e78] = TypedValue.Create(wholeWeek);
        return (normalized, delegation == "take_control_all" ? 829782071u : 1999913557u, delegation == "take_control_all");
    }
    internal static string WithControl(string type, bool owned) => TrainingConfiguration.WithControl(type, owned);
}
