using System.Text.Json;

namespace FMAssistant;

internal static class TrainingConfiguration
{
    // Joint postcondition: a matching session type alone cannot prove a responsibility change.
    internal static string WithControl(string type, bool owned) => JsonSerializer.Serialize(new { sessionType = type, generalTrainingControlled = owned });
}
