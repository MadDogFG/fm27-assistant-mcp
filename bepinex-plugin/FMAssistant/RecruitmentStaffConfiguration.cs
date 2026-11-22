using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace FMAssistant;

internal static class RecruitmentStaffConfiguration
{
    // Both mode and actual membership must agree. Any=true alone is insufficient
    // while old explicit selections are still visible in another channel response.
    internal static string State(bool any, IEnumerable<string> identities) => JsonSerializer.Serialize(new {
        any, people = identities.OrderBy(value => value, StringComparer.Ordinal).ToArray()
    });
}
