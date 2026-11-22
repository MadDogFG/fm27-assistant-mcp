using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FMAssistant;

// Persist intent before a native side effect. This proves dispatch history, never game acceptance.
// Kept independent of Unity so crash/restart behavior can be checked offline.
public sealed class DispatchJournal
{
    public sealed record Receipt(string operationId, string command, string targetIdentity, int epoch,
        string fingerprint, string status, string error = null, string verificationScope = "dispatch_history_only",
        string before = null, string requested = null, string after = null, string sessionId = null, string observationBaseline = null)
    {
        public bool ok => status == "dispatched_unverified" || verified;
        public bool verified => status == "verified" || status == "no_change";
        public bool retrySafe => false;
    }
    private readonly string FileName;
    private readonly string SessionId;
    private readonly Dictionary<string, Receipt> Receipts = new(StringComparer.Ordinal);

    public DispatchJournal(string fileName, string sessionId = null)
    {
        SessionId = sessionId ?? Guid.NewGuid().ToString("N");
        FileName = Path.GetFullPath(fileName);
        if (!File.Exists(FileName)) return;
        if (new FileInfo(FileName).Length > 16 * 1024 * 1024) throw new InvalidOperationException("Dispatch journal requires archival before further writes.");
        var lines = File.ReadAllLines(FileName);
        for (var i = 0; i < lines.Length; i++)
        {
            if (string.IsNullOrWhiteSpace(lines[i])) continue;
            try
            {
                var entry = JsonSerializer.Deserialize<Receipt>(lines[i]) ?? throw new JsonException("Empty journal record");
                Receipts[entry.operationId] = entry;
            }
            catch (JsonException) when (i == lines.Length - 1)
            {
                // Never append behind a torn record; that would hide a later intent on restart.
                throw new InvalidOperationException("Dispatch journal has a torn final record; recover the file before more commands.");
            }
        }
    }

    public static string Fingerprint(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public bool Contains(string id) => Receipts.ContainsKey(id ?? "");
    internal bool HasFingerprint(string fingerprint)
    {
        foreach (var receipt in Receipts.Values)
            if (receipt.fingerprint == fingerprint) return true;
        return false;
    }
    public Receipt Get(string id) => Receipts.TryGetValue(id ?? "", out var receipt) ? receipt : throw new ArgumentException("Unknown operation ID.");

    private void Persist(Receipt entry)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FileName));
        using var file = new FileStream(FileName, FileMode.Append, FileAccess.Write, FileShare.Read);
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(entry) + "\n");
        file.Write(bytes, 0, bytes.Length);
        file.Flush(true);
        Receipts[entry.operationId] = entry;
    }

    public Receipt Dispatch(string id, string command, string target, int epoch, string semanticArguments, Action action,
        string before = null, string requested = null, string scope = "dispatch_history_only", string observationBaseline = null)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 100) throw new ArgumentException("Operation ID (1..100 characters) is required.");
        var fingerprint = Fingerprint(JsonSerializer.Serialize(new { command, target, semanticArguments }));
        if (Receipts.TryGetValue(id, out var previous))
        {
            if (previous.fingerprint != fingerprint) throw new ArgumentException("Operation ID was already used with different arguments.");
            return previous; // A restart or another epoch cannot authorize replay.
        }
        if (Receipts.Count >= 4096) throw new InvalidOperationException("Archive the dispatch journal before starting more operations.");
        var intent = new Receipt(id, command, target, epoch, fingerprint, "dispatch_started", verificationScope: scope, before: before, requested: requested, sessionId: SessionId, observationBaseline: observationBaseline);
        if (requested != null && before == requested)
        {
            intent = intent with { status = "no_change", after = before };
            Persist(intent);
            return intent;
        }
        Persist(intent); // If durable recording fails, the native action is never entered.
        Receipt result;
        try { action(); result = intent with { status = "dispatched_unverified" }; }
        catch (Exception ex) { result = intent with { status = "dispatch_result_unknown", error = ex.GetBaseException().Message }; }
        try { Persist(result); }
        catch (Exception ex)
        {
            result = intent with { status = "dispatch_result_unknown", error = "Post-dispatch journal write failed: " + ex.GetBaseException().Message };
            Receipts[id] = result;
        }
        return result;
    }

    public Receipt Observe(string id, string target, int epoch, string scope, string observed)
    {
        var entry = Get(id);
        if (entry.targetIdentity != target || entry.verificationScope != scope || entry.requested == null)
            throw new ArgumentException("Observation does not belong to this command's target and postcondition.");
        if (entry.verified || entry.status == "session_changed") return entry;
        if (entry.epoch != epoch || entry.sessionId != SessionId)
        {
            var expired = entry with { status = "session_changed" };
            Persist(expired);
            return expired;
        }
        if (entry.requested != observed) return entry with { after = observed };
        var result = entry with { status = "verified", after = observed, error = null };
        Persist(result);
        return result;
    }
}
