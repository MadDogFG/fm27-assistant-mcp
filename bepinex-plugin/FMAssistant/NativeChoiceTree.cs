using System;
using System.Globalization;
using SI.Core;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Accept only list indices, ChildList and a terminal RowData. Never an arbitrary nested record.
internal static class NativeChoiceTree
{
    internal static TypedValue Leaf(string handle, string path, bool requirePropertyValue = true)
    {
        var parts = (path ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) throw new ArgumentException("Choose a concrete native option path.");
        var value = LiveTools.GetValue(handle);
        var childKey = "0x" + InternalCommands.PropertyId("ChildList").ToString("x8");
        var at = 0;
        for (var depth = 0; depth < 8; depth++)
        {
            var type = value?.DataType?.FullName ?? "";
            if (!type.StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal)) throw new ArgumentException("Option group is not a native list.");
            var list = value.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() ?? throw new ArgumentException("Option list is unavailable.");
            if (at >= parts.Length || !int.TryParse(parts[at++], NumberStyles.None, CultureInfo.InvariantCulture, out var index) || index < 0 || index >= list.Count)
                throw new ArgumentException("Option index is outside the game's current list.");
            var original = list[index];
            var row = Record(original) ?? throw new ArgumentException("Native option row is not a record.");
            if (Flag(row, "Disabled", false)) throw new InvalidOperationException("Game disabled the option or its parent group.");
            var selected = row.TryGetValue(InternalCommands.PropertyId("RowData"), out var data) ? data : original;
            var selectedRow = Record(selected) ?? throw new ArgumentException("Native option has no original RowData.");
            if (Flag(selectedRow, "Disabled", false)) throw new InvalidOperationException("Game disabled this option.");
            var children = Field(row, "ChildList", false);
            if (children == null || children.IsNull) children = Field(selectedRow, "ChildList", false);
            if (at < parts.Length && parts[at].Equals(childKey, StringComparison.OrdinalIgnoreCase)) { at++; value = children; continue; }
            if (at < parts.Length && parts[at].Equals("0x526f7744", StringComparison.OrdinalIgnoreCase)) at++;
            if (at != parts.Length) throw new ArgumentException("Only native ChildList indices and terminal RowData are selectable.");
            if (children != null && !children.IsNull)
            {
                var childType = children.DataType?.FullName ?? "";
                if (!childType.StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal) ||
                    children.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()?.Count != 0)
                    throw new ArgumentException("Select a native option leaf, not a category heading.");
            }
            if (requirePropertyValue) Field(selectedRow, "PropertyValue");
            return selected;
        }
        throw new ArgumentException("Native option nesting exceeds eight levels.");
    }
}
