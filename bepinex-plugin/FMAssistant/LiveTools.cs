using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;
using System.Reflection;
using FM.GamePlugin;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using SI.Bindable;
using SI.Bindable.Reference.Core;
using SI.Core;
using SI.Interop;
using DateTime = System.DateTime;

namespace FMAssistant;

// This surface never opens panels or dispatches input. All IL2CPP access stays on the game thread.
public static class LiveTools
{
    private sealed class Channel
    {
        public Bindings.Key Key;
        public Bindings.Key Root;
        public string Source;
        public string SourcePath;
        public string Identity;
        public uint Property;
        public TypedValue Value;
        public long Revision;
        public DateTime? Updated;
        public Dictionary<string, string> Contexts = new();
        public Dictionary<string, string> ContextDescriptions = new();
        public int Pins;
        public bool CloseRequested;
    }

    private static readonly Dictionary<string, Channel> Channels = new();
    private static Bindings.ValueChangedCallback Callback;
    private static GameInteropSubsystem Interop;
    private static ulong NextKey = 0xfaa5000000000000UL;
    private static int Epoch = 1;
    public static string SessionId { get; } = Guid.NewGuid().ToString("N");
    public static int CurrentEpoch => Epoch;

    internal sealed record Snapshot(TypedValue Value, long Revision, string Source, uint Property,
        string SourcePath, string Identity,
        Dictionary<string, string> Contexts, Dictionary<string, string> ContextDescriptions, bool Ready);
    internal static Snapshot GetSnapshot(string handle)
    {
        if (!Channels.TryGetValue(handle ?? "", out var channel)) throw new ArgumentException("Unknown or expired channel handle.");
        return new Snapshot(channel.Value, channel.Revision, channel.Source, channel.Property, channel.SourcePath,
            channel.Identity, channel.Contexts, channel.ContextDescriptions, channel.Updated.HasValue);
    }
    internal static void Pin(string handle) { GetSnapshot(handle); Channels[handle].Pins++; }
    internal static void Unpin(string handle)
    {
        if (!Channels.TryGetValue(handle ?? "", out var channel)) return;
        channel.Pins = Math.Max(0, channel.Pins - 1);
        if (channel.Pins == 0 && channel.CloseRequested) Close(handle);
    }
    internal static InteropReference GetReference(string source) => ResolveReference(source, "");
    internal static InteropReference GetReference(string source, string path) => ResolveReference(source, path);
    internal static TypedValue GetValue(string source, string path = "") => ResolveValue(source, path);
    internal static void UpdateProperty(string handle, TypedValue value)
    {
        if (!Channels.TryGetValue(handle, out var channel) || !channel.Updated.HasValue) throw new ArgumentException("Property channel is unavailable.");
        // This is the same command used by InteropDataHandler.UpdateChannel. It sends to the game,
        // without optimistically changing the local read binding.
        GetInterop().UpdateChannelData(channel.Key, value);
    }

    public static string JsonText(object value) => JsonSerializer.Serialize(value);
    internal static object DescribeValue(TypedValue value, int depth = 5) => Encode(value, depth, new HashSet<IntPtr>());

    // Financial drafts can be shared by the game's own panels. Do not edit one while another
    // binding root is using it. Our private subscription roots are excluded from this check.
    internal static void RequireUnusedDraft(InteropReference reference)
    {
        var identity = reference.GetPersistentIdentity();
        RequireNoExternalReference(other => other.GetPersistentIdentity() == identity,
            "This draft is in use by another game binding root. Close that editing session before the agent changes its terms.");
    }
    internal static void RequireNoExternalSpeakTo() => RequireNoExternalReference(
        other => other.GetIl2CppType().FullName == "FM.UI.SpeakToReference",
        "An in-game communication binding is active. Defer the negotiation action until it closes; native completion notifications can close shared communication panels.");
    // Read-only diagnosis: report which binding roots outside our own subscriptions hold a
    // reference with the same persistent identity. Used to explain RequireUnusedDraft refusals
    // before changing any guard.
    internal static object ExternalReferenceUsers(InteropReference reference)
    {
        var identity = reference.GetPersistentIdentity();
        var ownRoots = Channels.Values.Select(channel => channel.Root.m_key).ToHashSet();
        var users = new List<object>();
        var visited = 0;
        void Visit(IReadOnlyNode node, int depth)
        {
            if (node == null) return;
            if (ownRoots.Contains(node.Key.m_key) || ++visited > 50000 || depth > 100) return;
            try
            {
                var type = node.Value?.DataType?.FullName ?? "";
                var scalar = type == "SI.Core.DynamicNumber" || type == "FM.GamePlugin.GameDate" || type == "System.String" || type == "System.Boolean" ||
                    type.StartsWith("System.Int") || type.StartsWith("System.UInt") || type == "System.Single" ||
                    type == "System.Double" || type == "System.Byte" || type == "System.SByte";
                if (!scalar && type.Length > 0 && Raw(node.Value)?.TryCast<InteropReference>() is { } other &&
                    other.GetPersistentIdentity() == identity)
                {
                    var name = "";
                    try { name = node.Name ?? ""; } catch { }
                    users.Add(new { key = node.Key.m_key.ToString("x16"), name, valueType = type,
                        referenceType = other.GetIl2CppType().FullName, depth });
                }
            }
            catch { }
            var child = node.FirstChild;
            while (child != null) { Visit(child, depth + 1); child = child.NextSibling; }
        }
        Visit(BindingTools.GetBindings().RootNode, 0);
        return new { identity, ownRoots = ownRoots.Count, visited, users };
    }
    private static void RequireNoExternalReference(Func<InteropReference, bool> conflicts, string message)
    {
        var ownRoots = Channels.Values.Select(channel => channel.Root.m_key).ToHashSet();
        var visited = 0;
        void Visit(IReadOnlyNode node, int depth)
        {
            if (node == null || ownRoots.Contains(node.Key.m_key)) return;
            if (++visited > 50000 || depth > 100) throw new InvalidOperationException("Could not establish whether this draft is in use; no edit was sent.");
            var valueType = node.Value?.DataType?.FullName ?? "";
            var scalar = valueType == "SI.Core.DynamicNumber" || valueType == "FM.GamePlugin.GameDate" || valueType == "System.String" || valueType == "System.Boolean" ||
                valueType.StartsWith("System.Int") || valueType.StartsWith("System.UInt") || valueType == "System.Single" ||
                valueType == "System.Double" || valueType == "System.Byte" || valueType == "System.SByte";
            var other = scalar ? null : Raw(node.Value)?.TryCast<InteropReference>();
            if (other != null && conflicts(other)) throw new InvalidOperationException(message);
            var child = node.FirstChild;
            while (child != null) { Visit(child, depth + 1); child = child.NextSibling; }
        }
        Visit(BindingTools.GetBindings().RootNode, 0);
    }

    // A timeout before execution cancels the queued read, so it cannot run unexpectedly later.
    public static (int, string) RunCommand(Func<object> action, string operationId, string route) => Run(() =>
    {
        RuntimeCapabilities.RequireKnownProtocol(route);
        using var owner = MutationActivity.Enter(operationId);
        return action();
    });

    public static (int, string) Run(Func<object> action)
    {
        var completion = new TaskCompletionSource<(int, string)>(TaskCreationOptions.RunContinuationsAsynchronously);
        var state = 0;
        MainThread.Enqueue(() =>
        {
            if (Interlocked.CompareExchange(ref state, 1, 0) != 0) return;
            try { completion.TrySetResult((200, JsonText(action()))); }
            catch (Exception ex) { completion.TrySetResult((400, JsonText(new { ok = false, error = ex.GetBaseException().Message }))); }
        });
        if (completion.Task.Wait(5000)) return completion.Task.Result;
        var cancelled = Interlocked.CompareExchange(ref state, 2, 0) == 0;
        return (504, JsonText(new { ok = false, status = cancelled ? "cancelled_before_execution" : "execution_result_unknown", retrySafe = cancelled }));
    }

    private static GameInteropSubsystem GetInterop()
    {
        if (Interop != null) return Interop;
        Interop = SI.Core.GameSubsystems.Get<GameInteropSubsystem>();
        if (Interop == null) throw new InvalidOperationException("Game interoperability subsystem is unavailable.");
        Callback = DelegateSupport.ConvertDelegate<Bindings.ValueChangedCallback>(new Action<Bindings.Key, TypedValue>(OnData));
        return Interop;
    }

    private static void OnData(Bindings.Key key, TypedValue value)
    {
        try
        {
            foreach (var channel in Channels.Values)
            {
                if (channel.Key.m_key != key.m_key) continue;
                var copy = value == null ? null : TypedValue.CreateCopyFrom(value);
                channel.Value?.Dispose();
                channel.Value = copy;
                channel.Revision++;
                channel.Updated = DateTime.UtcNow;
            }
        }
        catch (Exception ex) { EventLog.Add("error", "live response: " + ex.Message); }
    }

    private static Il2CppSystem.Object Raw(TypedValue value) => value == null || value.IsNull ||
        value.DataType?.FullName == "SI.Core.DynamicNumber" || value.DataType?.FullName == "FM.GamePlugin.GameDate" ? null : value.Get();

    private static TypedValue ResolveValue(string handle, string path)
    {
        if (!Channels.TryGetValue(handle ?? "", out var channel)) throw new ArgumentException("Unknown or expired channel handle.");
        var value = channel.Value;
        if (value == null) throw new InvalidOperationException("Channel is awaiting a native response.");
        foreach (var part in (path ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            var raw = Raw(value);
            var record = raw?.TryCast<SI.Core.Record>();
            if (record != null)
            {
                var key = ParseId(part);
                if (!record.TryGetValue(key, out value)) throw new ArgumentException("Record property not found: " + part);
                continue;
            }
            var list = raw?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (list != null && int.TryParse(part, out var index) && index >= 0 && index < list.Count)
            { value = list[index]; continue; }
            throw new ArgumentException("Path is not a record property or list index: " + part);
        }
        return value;
    }

    private static InteropReference ResolveReference(string source, string path)
    {
        if (source == "game") return FM.UI.GameReference.GetInstance();
        if (source == "match") return MatchCommands.CurrentReference();
        if (source == "human")
        {
            var candidates = new Dictionary<string, InteropReference>();
            var visited = 0;
            FindHumans(BindingTools.GetBindings().RootNode, candidates, ref visited, 0);
            if (candidates.Count != 1) throw new InvalidOperationException("Expected one active human reference; found " + candidates.Count + ". Use an explicit reference.");
            return candidates.Values.First();
        }
        if ((source ?? "").StartsWith("singleton:", StringComparison.Ordinal))
        {
            var name = source.Substring(10);
            if (!name.EndsWith("Reference", StringComparison.Ordinal)) name += "Reference";
            var type = typeof(FM.UI.GameReference).Assembly.GetType("FM.UI." + name);
            if (type == null || !typeof(InteropReference).IsAssignableFrom(type)) throw new ArgumentException("Unknown interoperability reference type.");
            return type.GetMethod("GetInstance", BindingFlags.Public | BindingFlags.Static)?.Invoke(null, null) as InteropReference
                ?? throw new ArgumentException("Reference has no singleton factory.");
        }
        if ((source ?? "").StartsWith("binding:", StringComparison.Ordinal))
        {
            var key = new Bindings.Key(ulong.Parse(source.Substring(8), NumberStyles.HexNumber));
            var value = BindingTools.GetBindings().Get(ref key);
            return Raw(value)?.TryCast<InteropReference>() ?? throw new ArgumentException("Binding does not contain an interoperability reference.");
        }
        return Raw(ResolveValue(source, path))?.TryCast<InteropReference>()
            ?? throw new ArgumentException("Selected value is not an interoperability reference.");
    }

    private static IDataReference ResolveSource(string source, string path)
    {
        if ((source ?? "").StartsWith("singleton:", StringComparison.Ordinal))
        {
            var name = source.Substring(10);
            if (!name.EndsWith("Reference", StringComparison.Ordinal)) name += "Reference";
            var fullName = name.Contains('.') ? name : "FM.UI." + name;
            if (!fullName.StartsWith("FM.UI.", StringComparison.Ordinal) && !fullName.StartsWith("FM.Match.", StringComparison.Ordinal))
                throw new ArgumentException("Unsupported reference namespace.");
            var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType(fullName)).FirstOrDefault(t => t != null);
            var value = type?.GetMethod("GetInstance", BindingFlags.Public | BindingFlags.Static)?.Invoke(null, null) as Il2CppObjectBase;
            return value?.TryCast<IDataReference>() ?? throw new ArgumentException("Reference has no data factory.");
        }
        if (source == "game" || source == "human" || source == "match" || (source ?? "").StartsWith("binding:", StringComparison.Ordinal))
            return ResolveReference(source, path).TryCast<IDataReference>();
        return Raw(ResolveValue(source, path))?.TryCast<IDataReference>() ?? throw new ArgumentException("Value is not a game data reference.");
    }

    private static object SourceDescription(IDataReference reference)
    {
        var interop = reference.TryCast<InteropReference>();
        return interop != null ? Reference(interop) : new { kind = "data_reference", type = reference.TryCast<Il2CppSystem.Object>().GetIl2CppType().FullName, id = reference.ID.id };
    }

    private static MethodInfo SourceMethod(IDataReference reference, string name)
    {
        var fullName = reference.TryCast<Il2CppSystem.Object>().GetIl2CppType().FullName;
        var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType(fullName)).FirstOrDefault(t => t != null);
        return type?.GetMethod(name, BindingFlags.Public | BindingFlags.Static)
            ?? throw new InvalidOperationException("Data metadata method unavailable: " + fullName + "." + name);
    }

    private static void SourceContexts(IDataReference reference, uint property, Il2CppSystem.Collections.Generic.List<ContextID> contexts)
        => SourceMethod(reference, "GetContextsInternal").Invoke(null, new object[] { property, contexts });

    private static void FindHumans(IReadOnlyNode node, Dictionary<string, InteropReference> result, ref int visited, int depth)
    {
        if (node == null || visited++ > 10000 || depth > 80) return;
        if (node.Name == "Human")
        {
            var reference = Raw(node.Value)?.TryCast<FM.UI.PersonReference>();
            if (reference != null) result[reference.GetPersistentIdentity()] = reference;
        }
        var child = node.FirstChild;
        while (child != null && visited < 10000)
        { FindHumans(child, result, ref visited, depth + 1); child = child.NextSibling; }
    }

    public static uint ParseId(string text) => text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
        ? uint.Parse(text.Substring(2), NumberStyles.HexNumber) : uint.Parse(text, CultureInfo.InvariantCulture);

    private static object Reference(InteropReference reference) => new
    {
        kind = "reference", type = reference.GetIl2CppType().FullName, identity = reference.GetPersistentIdentity(),
        pairs = reference.m_id == null ? null : Enumerable.Range(0, reference.m_id.Count)
            .Select(i => new { id = reference.m_id[i].ID, value = reference.m_id[i].Value }).ToArray()
    };

    public static object Properties(string source, string path, string filter)
    {
        var reference = ResolveSource(source, path);
        var properties = new Il2CppSystem.Collections.Generic.List<PropertyID>();
        reference.GetProperties(properties);
        var result = new List<object>();
        for (var i = 0; i < properties.Count; i++)
        {
            var property = properties[i];
            var name = property.ToString();
            if (!string.IsNullOrEmpty(filter) && name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
            var contexts = new Il2CppSystem.Collections.Generic.List<ContextID>();
            SourceContexts(reference, property.id, contexts);
            result.Add(new { id = property.id, hex = "0x" + property.id.ToString("x8"), name,
                contexts = Enumerable.Range(0, contexts.Count).Select(j => new { id = contexts[j].id, name = contexts[j].ToString() }).ToArray() });
        }
        return new { ok = true, epoch = Epoch, reference = SourceDescription(reference), properties = result };
    }

    public sealed record Subscription(bool ok, string status, string handle, int epoch, object reference, string propertyName, string bindingKey);

    public static Subscription Open(string source, string path, uint property, string contextsJson, bool transient = false)
    {
        if (Channels.Count >= 128) throw new InvalidOperationException("Close unused subscriptions (limit 128).");
        var reference = ResolveSource(source, path);
        // DynamicReference is a real record whose instance checks its actual keys.
        // Its static metadata stub always returns false; ID=1 is not a typed UI schema.
        var dynamicRecord = reference.TryCast<SI.Bindable.DynamicReference>();
        var accepts = dynamicRecord != null ? dynamicRecord.AcceptsProperty(property) :
            (bool)SourceMethod(reference, "AcceptsPropertyInternal").Invoke(null, new object[] { property });
        if (!accepts) throw new ArgumentException("Reference does not accept this property.");
        var required = new Il2CppSystem.Collections.Generic.List<ContextID>();
        SourceContexts(reference, property, required);
        using var contextDocument = JsonDocument.Parse(string.IsNullOrEmpty(contextsJson) ? "{}" : contextsJson);
        var contextObject = contextDocument.RootElement;
        if (contextObject.ValueKind != JsonValueKind.Object) throw new ArgumentException("contexts must be an object.");
        var contextValues = new Dictionary<string, TypedValue>();
        for (var i = 0; i < required.Count; i++)
        {
            var contextName = required[i].ToString().Split(':')[0];
            if (!contextObject.TryGetProperty(contextName, out var item)) throw new ArgumentException("Missing required context: " + contextName);
            contextValues[contextName] = item.ValueKind switch
            {
                JsonValueKind.Null => TypedValue.Null,
                JsonValueKind.True => TypedValue.Create(true),
                JsonValueKind.False => TypedValue.Create(false),
                JsonValueKind.Number => InternalCommands.Build(item),
                JsonValueKind.String => TypedValue.Create(item.GetString()),
                JsonValueKind.Object when item.TryGetProperty("valueSource", out var valueSource) =>
                    TypedValue.CreateCopyFrom(ResolveValue(valueSource.GetString(), item.TryGetProperty("path", out var valuePath) ? valuePath.GetString() : "")),
                JsonValueKind.Object when item.TryGetProperty("source", out var contextSource) =>
                    GameTools.MakeObjectTypedValue(ResolveReference(contextSource.GetString(), item.TryGetProperty("path", out var p) ? p.GetString() : "")),
                JsonValueKind.Object => InternalCommands.Build(item),
                JsonValueKind.Array => InternalCommands.Build(item),
                _ => throw new ArgumentException("Unsupported context: " + contextName)
            };
        }
        if (contextObject.EnumerateObject().Count() != contextValues.Count) throw new ArgumentException("Unknown context name.");
        GetInterop();
        var bindings = BindingTools.GetBindings();
        var rootPath = GameTools.MakeSpan("FMAssistantLive.e" + Epoch + "c" + (++NextKey).ToString("x16"));
        var root = bindings.Create(ref rootPath, Bindings.NodeFlags.None);
        bindings.Set(ref root, GameTools.MakeObjectTypedValue(reference), Bindings.SetFlags.Default);
        foreach (var contextValue in contextValues)
        {
            var contextPath = GameTools.MakeSpan(contextValue.Key);
            bindings.Set(ref root, ref contextPath, contextValue.Value, Bindings.NodeFlags.None, Bindings.SetFlags.Default);
        }
        var name = new PropertyID(property).ToString().Split(':')[0];
        var relative = GameTools.MakeSpan(name);
        var key = bindings.Create(ref root, ref relative, Bindings.NodeFlags.None);
        var handle = "s" + SessionId + "e" + Epoch + "c" + NextKey.ToString("x16");
        var channel = new Channel { Key = key, Root = root, Source = source, SourcePath = path ?? "",
            Identity = reference.TryCast<InteropReference>()?.GetPersistentIdentity(), Property = property,
            Contexts = contextValues.ToDictionary(pair => pair.Key, pair => pair.Value.AsString()),
            ContextDescriptions = contextValues.ToDictionary(pair => pair.Key, pair => JsonText(DescribeValue(pair.Value))) };
        Channels.Add(handle, channel);
        try { bindings.Bind(ref key, bindings.TryCast<Il2CppSystem.Object>(), Callback); }
        catch (Exception ex) { Channels.Remove(handle); bindings.Remove(ref root); Diagnostics.Log("open_fail " + name + " " + source + "/" + (path ?? "") + ": " + ex.GetType().Name + " " + ex.Message); throw; }
        Diagnostics.Log("open " + name + " " + source + "/" + (path ?? "") + " handle=" + handle + " contexts=" + string.Join(",", contextValues.Keys));
        if (transient) _ = Expire(handle);
        return new(true, "subscribed", handle, Epoch, SourceDescription(reference), name, key.m_key.ToString("x16"));
    }

    private static async Task Expire(string handle)
    {
        await Task.Delay(10000).ConfigureAwait(false);
        MainThread.Enqueue(() => { if (Channels.ContainsKey(handle)) Close(handle); });
    }

    public static object Read(string handle, string path, int depth)
    {
        if (!Channels.TryGetValue(handle ?? "", out var channel)) throw new ArgumentException("Unknown or expired channel handle.");
        Diagnostics.Log("read " + handle + " path=" + (path ?? "") + " updated=" + channel.Updated.HasValue);
        if (!channel.Updated.HasValue)
            return new { ok = true, status = "awaiting_response", epoch = Epoch, sessionId = SessionId, handle, revision = channel.Revision, updatedAt = channel.Updated, source = "live_native_channel", value = (object)null };
        object value;
        try { value = Encode(ResolveValue(handle, path), Math.Clamp(depth, 0, 6), new HashSet<IntPtr>()); }
        catch (Exception ex)
        {
            Diagnostics.Log("read_unavailable " + handle + ": " + ex.GetType().Name + " " + ex.Message);
            return new { ok = true, status = "unavailable", epoch = Epoch, sessionId = SessionId, handle, revision = channel.Revision, updatedAt = channel.Updated, source = "live_native_channel", value = (object)null };
        }
        return new { ok = true, status = "ready", epoch = Epoch, sessionId = SessionId,
            handle, revision = channel.Revision, updatedAt = channel.Updated, source = "live_native_channel", value };
    }

    private static object Encode(TypedValue value, int depth, HashSet<IntPtr> seen)
    {
        if (value == null || value.IsNull) return null;
        var type = value.DataType?.FullName ?? "unknown";
        if (type == "FM.GamePlugin.GameDate")
            return new { kind = "game_date", type, packedValue = value.Get<GameDate>().Data1.ToString(CultureInfo.InvariantCulture), display = value.AsString() };
        // AsString is a virtual game conversion; reading a boxed m_value as an object corrupts scalar results.
        if (type == "SI.Core.DynamicNumber" || type == "System.String" || type == "System.Boolean" || type.StartsWith("System.Int") || type.StartsWith("System.UInt") ||
            type == "System.Single" || type == "System.Double" || type == "System.Byte" || type == "System.SByte")
            return new { kind = "scalar", type, value = value.AsString() };
        var raw = Raw(value);
        if (raw == null) return null;
        var reference = raw.TryCast<InteropReference>();
        if (reference != null) return Reference(reference);
        if (depth == 0) return new { kind = "object", type = raw.GetIl2CppType().FullName, truncated = true };
        if (!seen.Add(raw.Pointer)) return new { kind = "cycle", type };
        try
        {
            var record = raw.TryCast<SI.Core.Record>();
            if (record != null)
            {
                var fields = new Dictionary<string, object>();
                var keys = record.Keys.GetEnumerator();
                while (keys.MoveNext() && fields.Count < 128)
                { var key = keys.Current; fields["0x" + key.ToString("x8")] = Encode(record[key], depth - 1, seen); }
                return new { kind = "record", type = raw.GetIl2CppType().FullName, count = record.Count, truncated = record.Count > fields.Count, fields };
            }
            var list = raw.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (list != null)
                return new { kind = "list", count = list.Count, truncated = list.Count > 64,
                    items = Enumerable.Range(0, Math.Min(list.Count, 64)).Select(i => Encode(list[i], depth - 1, seen)).ToArray() };
            return new { kind = "object", type = raw.GetIl2CppType().FullName, text = value.AsString() };
        }
        finally { seen.Remove(raw.Pointer); }
    }

    public static object Close(string handle)
    {
        if (!Channels.TryGetValue(handle ?? "", out var channel)) throw new ArgumentException("Unknown or expired channel handle.");
        // A channel that never produced a value may still hold a binding to a null/dynamic
        // reference; touching the native binding for it is where native crashes showed up.
        // Drop it from the bookkeeping instead of unbinding, and never resolve its value.
        if (!channel.Updated.HasValue)
        {
            Diagnostics.Log("close_skip_unupdated " + handle);
            Channels.Remove(handle);
            return new { ok = true, status = "closed_without_value", handle };
        }
        if (channel.Pins > 0)
        {
            channel.CloseRequested = true;
            return new { ok = true, status = "close_deferred_until_command_finishes", handle };
        }
        var bindings = BindingTools.GetBindings();
        try { bindings.Unbind(ref channel.Key, Callback); bindings.Remove(ref channel.Root); }
        catch (Exception ex) { Diagnostics.Log("close_fail " + handle + ": " + ex.GetType().Name + " " + ex.Message); }
        Channels.Remove(handle);
        channel.Value?.Dispose();
        Diagnostics.Log("close " + handle);
        return new { ok = true, status = "closed", handle };
    }

    public static void Reset()
    {
        foreach (var handle in Channels.Keys.ToArray())
        {
            try { Channels[handle].Pins = 0; Close(handle); }
            catch (Exception ex) { EventLog.Add("error", "close live channel: " + ex.Message); }
        }
        Channels.Clear();
        Epoch++;
    }

    public static object SelfTest()
    {
        var direct = new SI.Core.Record();
        direct[1] = TypedValue.Create(7);
        var generic = new SI.Core.Record();
        generic.InsertOrAssign<TypedValue>(1, TypedValue.Create(7));
        return new { ok = true, direct = Encode(direct[1], 2, new()), oldGeneric = Encode(generic[1], 2, new()),
            scalarBool = Encode(TypedValue.Create(false), 1, new()), scalarInt = Encode(TypedValue.Create(42), 1, new()) };
    }
}
