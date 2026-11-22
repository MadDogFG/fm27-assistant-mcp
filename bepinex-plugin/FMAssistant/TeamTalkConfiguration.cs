using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace FMAssistant;

// The native TalkingTo list contains internal IDs; the setter/getter use UI IDs.
// Both mappings are recovered from this build, not enum values guessed from labels.
internal static class TeamTalkConfiguration
{
    internal static int UiGroup(int native) => native switch { 4 => 0, 0 => 1, 1 => 2, 2 => 3, 3 => 4,
        _ => throw new ArgumentException("Unknown native team-talk recipient group.") };
    internal static bool CanSelectGroup(int ui, bool completed, bool finished, bool allowGrouped) => !finished &&
        (ui == 0 ? !completed : ui >= 1 && ui <= 4 && completed && (ui == 4 || allowGrouped));
    internal static string State(int uiGroup, IEnumerable<string> members) => JsonSerializer.Serialize(new {
        group = uiGroup, members = members.OrderBy(member => member, StringComparer.Ordinal).ToArray()
    });
}
