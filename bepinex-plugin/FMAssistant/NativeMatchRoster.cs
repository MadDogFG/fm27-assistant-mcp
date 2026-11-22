using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using SI.Core;

namespace FMAssistant;

internal static class NativeMatchRoster
{
    internal static SubstitutionWorkflow.Roster Read(string listHandle, string resolutionsJson)
    {
        var context = MatchCommands.CapturePlayerContext(false);
        var source = LiveTools.GetSnapshot(listHandle);
        if (!source.Ready || source.Source != "match" || !string.IsNullOrEmpty(source.SourcePath) ||
            source.Identity != context.MatchIdentity || source.Property != InternalCommands.PropertyId("PlayerMatchStatsOnPitch"))
            throw new ArgumentException("Use the current match's native PlayerMatchStatsOnPitch channel.");
        var side = source.Contexts.Where(pair => pair.Key.Equals("IsHomeTeam", StringComparison.OrdinalIgnoreCase)).ToArray();
        if (side.Length != 1 || !bool.TryParse(side[0].Value, out var home) || home != context.IsHomeTeam)
            throw new ArgumentException("Roster must belong to the active manager's actual match side.");
        if (!(source.Value?.DataType?.FullName ?? "").StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal))
            throw new InvalidOperationException("Native on-pitch roster is not a list.");
        var rows = source.Value.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() ?? throw new InvalidOperationException("Native roster unavailable.");
        using var document = JsonDocument.Parse(resolutionsJson);
        if (document.RootElement.ValueKind != JsonValueKind.Array || document.RootElement.GetArrayLength() != rows.Count)
            throw new ArgumentException("Resolve every native roster row; truncated or partial rosters cannot prove substitution.");
        var revision = source.Revision;
        void Chain(string handle, string path, int row, int depth)
        {
            if (handle == listHandle)
            {
                if (path != row.ToString(CultureInfo.InvariantCulture)) throw new ArgumentException("Roster row index does not match its source.");
                return;
            }
            if (depth > 3 || !string.IsNullOrEmpty(path)) throw new ArgumentException("Unsupported roster resolution chain.");
            var child = LiveTools.GetSnapshot(handle);
            if (!child.Ready || !new[] { "Person", "Player", "MatchPlayer" }.Any(name => child.Property == InternalCommands.PropertyId(name)))
                throw new ArgumentException("Roster resolution must use original Person/Player/MatchPlayer properties.");
            // Only an actual interoperability-reference parent supplies a persistent identity.
            // Unknown IDataReference-only shapes remain unsupported rather than being accepted on an ID guess.
            if (child.Identity == null || child.Identity != LiveTools.GetReference(child.Source, child.SourcePath).GetPersistentIdentity())
                throw new InvalidOperationException("Roster source changed, or this data-reference shape has not been recovered.");
            Chain(child.Source, child.SourcePath ?? "", row, depth + 1);
        }
        var ids = new List<int>(); var index = 0;
        foreach (var item in document.RootElement.EnumerateArray())
        {
            var handle = item.GetProperty("source").GetString();
            var path = item.TryGetProperty("path", out var nested) ? nested.GetString() ?? "" : "";
            Chain(handle, path, index++, 0);
            var person = LiveTools.GetReference(handle, path).TryCast<FM.UI.PersonReference>() ?? throw new ArgumentException("Roster row has no actual person reference.");
            var id = person.TryCast<FM.UI.DatabaseRecordReference>()?.m_index ?? -1;
            if (id < 0 || ids.Contains(id)) throw new InvalidOperationException("Invalid or duplicate native on-pitch person identity.");
            ids.Add(id);
        }
        var final = MatchCommands.CapturePlayerContext(false);
        if (LiveTools.GetSnapshot(listHandle).Revision != revision || final.MatchIdentity != context.MatchIdentity || final.IsHomeTeam != context.IsHomeTeam)
            throw new InvalidOperationException("Native roster changed while proving its complete membership.");
        return new SubstitutionWorkflow.Roster(context.MatchIdentity, LiveTools.SessionId, LiveTools.CurrentEpoch, context.IsHomeTeam,
            context.TimeSlice, ids.ToArray(), "validated_native_PlayerMatchStatsOnPitch_subscription_graph", System.DateTime.UtcNow.ToString("O"));
    }
}
