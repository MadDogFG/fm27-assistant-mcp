using System;
using System.Collections.Generic;
using System.Linq;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

internal static class NativeValueFingerprint
{
    public static string Compute(TypedValue value, bool stablePreferredMove = false)
    {
        var nodes = 0;
        object Encode(TypedValue item, int depth, bool advisoryList = false)
        {
            if (++nodes > 10000 || depth > 24) throw new ArgumentException("Native payload is too large to fingerprint completely.");
            if (item == null || item.IsNull) return null;
            var type = item.DataType?.FullName ?? "unknown";
            if (type == "SI.Bindable.NullReference") return new { type };
            if (item.Get()?.TryCast<SI.Core.SmallMessage>() is { } message)
                return new { type, sha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(message.GetBuffer().ToArray())) };
            if (type == "FM.GamePlugin.GameDate")
                return new { type, packedValue = item.Get<FM.GamePlugin.GameDate>().Data1.ToString(System.Globalization.CultureInfo.InvariantCulture) };
            if (type == "UnityEngine.Color32" || type == "UnityEngine.Color")
                return new { type, value = "color_opaque" };
            if (type == "SI.Core.DynamicNumber" || type == "System.String" || type == "System.Boolean" ||
                type.StartsWith("System.Int") || type.StartsWith("System.UInt") || type == "System.Single" || type == "System.Double" || type == "System.Byte" || type == "System.SByte")
                return new { type, value = item.AsString() };
            var raw = item.Get();
            var reference = raw?.TryCast<InteropReference>();
            if (reference != null) return new { type = reference.GetIl2CppType().FullName, identity = reference.GetPersistentIdentity() };
            var record = raw?.TryCast<SI.Core.Record>();
            if (record != null)
            {
                var fields = new SortedDictionary<uint, object>();
                foreach (var pair in record)
                    if (!(advisoryList && depth == 2 && pair.Key == 0x706d7469u))
                        fields[pair.Key] = Encode(pair.Value, depth + 1, stablePreferredMove && depth == 0 && pair.Key == 0x506d6d41u);
                return new { type, fields };
            }
            var list = raw?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (list != null) return new { type, values = Enumerable.Range(0, list.Count).Select(i => Encode(list[i], depth + 1, advisoryList)).ToArray() };
            throw new ArgumentException("Cannot fingerprint this native payload type completely: " + type);
        }
        return DispatchJournal.Fingerprint(LiveTools.JsonText(Encode(value, 0)));
    }
}
