using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using FM.GamePlugin;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using SI.Bindable.Reference.Core;
using SI.Core;

namespace FMAssistant;

// Diagnostic command transport for recovering player workflows. Not advertised as a verified domain tool.
public static class InternalCommands
{
    private static readonly Dictionary<string, uint> PropertyIds = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, (string Fingerprint, object Receipt)> Sent = new();

    public static uint PropertyId(string name)
    {
        if (name.StartsWith("0x", StringComparison.OrdinalIgnoreCase) || uint.TryParse(name, out _)) return LiveTools.ParseId(name);
        if (PropertyIds.Count == 0)
            foreach (var pair in PropertyIdentifierSet.Instance.m_idToInfo) PropertyIds.TryAdd(pair.Value.Name, pair.Key);
        return PropertyIds.TryGetValue(name, out var value) ? value : throw new ArgumentException("Unknown property: " + name);
    }

    public static object Registry(string kind, string filter)
    {
        var result = new List<object>();
        if (kind == "events")
        {
            foreach (var name in Enum.GetNames<InteropEventIDs>())
                if (string.IsNullOrEmpty(filter) || name.Contains(filter, StringComparison.OrdinalIgnoreCase))
                    result.Add(new { name, id = Convert.ToUInt32(Enum.Parse<InteropEventIDs>(name)), verification = "metadata_only" });
        }
        else
        {
            foreach (var pair in PropertyIdentifierSet.Instance.m_idToInfo)
                if (string.IsNullOrEmpty(filter) || pair.Value.Name.Contains(filter, StringComparison.OrdinalIgnoreCase))
                    result.Add(new { id = pair.Key, name = pair.Value.Name });
        }
        return new { ok = true, kind, items = result };
    }

    public static TypedValue Build(JsonElement value, int depth = 0)
    {
        if (depth > 10) throw new ArgumentException("Payload nesting limit reached.");
        switch (value.ValueKind)
        {
            case JsonValueKind.Null: return TypedValue.Null;
            case JsonValueKind.True: return TypedValue.Create(true);
            case JsonValueKind.False: return TypedValue.Create(false);
            case JsonValueKind.String: return TypedValue.Create(value.GetString());
            case JsonValueKind.Number:
                if (value.TryGetInt32(out var number)) return TypedValue.Create(number);
                if (value.TryGetInt64(out var large)) return TypedValue.Create(large);
                return TypedValue.Create(value.GetDouble());
            case JsonValueKind.Array:
                var list = new Il2CppSystem.Collections.Generic.List<TypedValue>();
                foreach (var item in value.EnumerateArray()) list.Add(Build(item, depth + 1));
                return GameTools.MakeObjectTypedValue(list);
            case JsonValueKind.Object:
                if (value.TryGetProperty("$value", out var source))
                    return TypedValue.CreateCopyFrom(LiveTools.GetValue(source.GetProperty("source").GetString(), source.TryGetProperty("path", out var path) ? path.GetString() : ""));
                if (value.TryGetProperty("$reference", out var reference))
                    return GameTools.MakeObjectTypedValue(LiveTools.GetReference(reference.GetProperty("source").GetString(), reference.TryGetProperty("path", out var refPath) ? refPath.GetString() : ""));
                if (value.TryGetProperty("$u64", out var unsigned)) return TypedValue.Create(ulong.Parse(unsigned.GetString(), CultureInfo.InvariantCulture));
                if (value.TryGetProperty("$u32", out var unsigned32)) return TypedValue.Create(uint.Parse(unsigned32.GetString(), CultureInfo.InvariantCulture));
                var plain = value.TryGetProperty("$plain", out var fields);
                if (!plain) fields = value;
                SI.Core.Record record = plain ? new SI.Core.Record() : new SI.Bindable.DynamicReference();
                foreach (var field in fields.EnumerateObject()) record[PropertyId(field.Name)] = Build(field.Value, depth + 1);
                return GameTools.MakeObjectTypedValue(record);
            default: throw new ArgumentException("Unsupported payload type.");
        }
    }

    public static object Send(string id, string eventName, string source, string path, string payload, bool apply)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 100) throw new ArgumentException("Request ID required.");
        var fingerprint = string.Join("|", LiveTools.CurrentEpoch, eventName, source, path, payload, apply);
        if (Sent.TryGetValue(id, out var old))
        {
            if (old.Fingerprint != fingerprint) throw new ArgumentException("Request ID has different arguments.");
            return old.Receipt;
        }
        if (!Enum.TryParse<InteropEventIDs>(eventName, out var eventId) || !Enum.IsDefined(typeof(InteropEventIDs), eventId)) throw new ArgumentException("Unknown game event.");
        var canonicalName = Enum.GetName(typeof(InteropEventIDs), eventId);
        if (canonicalName.Contains("Debug", StringComparison.OrdinalIgnoreCase) || canonicalName.Contains("Cheat", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Not a player command.");
        var target = string.IsNullOrEmpty(source) || source == "none" ? null : LiveTools.GetReference(source, path);
        using var document = JsonDocument.Parse(string.IsNullOrEmpty(payload) ? "null" : payload);
        var data = document.RootElement.ValueKind == JsonValueKind.Null ? null : Build(document.RootElement);
        var receipt = new { ok = true, requestId = id, status = apply ? "dispatched_unverified" : "preview",
            verified = false, epoch = LiveTools.CurrentEpoch, eventName, eventId = (uint)eventId,
            target = target?.GetPersistentIdentity(), data = LiveTools.DescribeValue(data), retrySafe = !apply };
        if (apply)
        {
            // Record intent before entering native code: exceptions do not authorize a retry.
            Sent[id] = (fingerprint, receipt);
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)eventId, target, data);
            EventLog.Add("internal-command", LiveTools.JsonText(receipt));
        }
        if (Sent.Count > 256) Sent.Remove(Sent.Keys.First());
        return receipt;
    }

    public static object Update(string channel, string payload, bool apply)
    {
        using var document = JsonDocument.Parse(payload);
        var value = Build(document.RootElement);
        var snapshot = LiveTools.GetSnapshot(channel);
        var before = LiveTools.DescribeValue(snapshot.Value);
        var requested = LiveTools.DescribeValue(value);
        if (apply) LiveTools.UpdateProperty(channel, value);
        return new { ok = true, status = apply ? "dispatched_unverified" : "preview", verified = false,
            before, requested, source = snapshot.Source, property = snapshot.Property, contexts = snapshot.Contexts };
    }

    public static object ContinueState()
    {
        var modules = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<FM.UI.ContinueManagerModule>());
        var results = new List<object>();
        foreach (var obj in modules)
        {
            var module = obj.TryCast<FM.UI.ContinueManagerModule>();
            if (module == null) continue;
            var fields = new Dictionary<string, object>();
            foreach (var name in new[] { "m_active", "m_initialised", "m_isInMainGameScene", "m_gameStateFlags", "m_currentHumanStatusAction", "m_continueState", "m_messagesResponseRequiredMainString", "m_mustRespondGrouping", "m_pendingPortalScreenAction", "m_editSession", "m_currentAction", "m_actionToCallWhenActive", "m_hasDeferredTaskAction", "m_deferredTaskAction" })
            {
                var property = typeof(FM.UI.ContinueManagerModule).GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                var value = property?.GetValue(module);
                if (value != null && (name == "m_continueState" || name == "m_messagesResponseRequiredMainString" || name == "m_mustRespondGrouping"))
                    value = value.GetType().GetProperty("Value")?.GetValue(value) ?? value;
                if (value is Il2CppObjectBase wrapped)
                {
                    var typed = wrapped.TryCast<TypedValue>();
                    fields[name] = LiveTools.DescribeValue(typed ?? GameTools.MakeObjectTypedValue(wrapped));
                }
                else fields[name] = value?.ToString();
            }
            results.Add(fields);
        }
        return new { ok = true, modules = results };
    }
}
