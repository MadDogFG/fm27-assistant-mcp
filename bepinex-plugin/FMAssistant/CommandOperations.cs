using System;
using System.Collections.Generic;
using System.Linq;
using SI.Core;
using DateTime = System.DateTime;

namespace FMAssistant;

// A game response verifies only the named scope. A changed tactic draft is never on-pitch proof.
public static class CommandOperations
{
    private sealed class Operation
    {
        public string Id, Fingerprint, Command, Target, Channel, Scope;
        public CommandState State;
        public Func<TypedValue, string> Read;
        public bool Released;
    }
    private static readonly Dictionary<string, Operation> Operations = new();
    public static bool Contains(string id) => Operations.ContainsKey(id ?? "");
    public static bool HasPending(string target) => Operations.Values.Any(op => op.State.Pending && op.Target == target);

    private static object Receipt(Operation op) => new
    {
        ok = op.State.Pending || op.State.Verified, operationId = op.Id, command = op.Command,
        status = op.State.Status, verified = op.State.Verified, retrySafe = false,
        epoch = op.State.Epoch, targetIdentity = op.Target, verificationScope = op.Scope,
        matchEffectVerified = false, before = op.State.Before, requested = op.State.Desired,
        after = op.State.After, error = op.State.Error
    };
    public static object Get(string id) => Operations.TryGetValue(id ?? "", out var op) ? Receipt(op)
        : throw new ArgumentException("Unknown operation ID.");

    internal static object Start(string id, string command, string target, string semanticArguments,
        string channel, string desired, string scope, Action dispatch, Func<TypedValue, string> read = null)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 100) throw new ArgumentException("Operation ID (1..100 characters) is required.");
        var fingerprint = LiveTools.JsonText(new { epoch = LiveTools.CurrentEpoch, command, target, semanticArguments, desired });
        if (Operations.TryGetValue(id, out var old))
        {
            if (old.Fingerprint != fingerprint) throw new ArgumentException("Operation ID was already used with different arguments.");
            return Receipt(old);
        }
        if (TacticCommands.Contains(id) || ActionCommands.Contains(id) || SubstitutionCommands.ContainsRoot(id)) throw new ArgumentException("Operation ID already belongs to another command.");
        if (HasPending(target) || TacticCommands.HasPending(target)) throw new InvalidOperationException("Another command for this target is awaiting verification.");
        foreach (var expired in Operations.Values.Where(op => !op.State.Pending).OrderBy(op => op.State.Started)
            .Take(Math.Max(0, Operations.Count - 127)).ToArray()) Operations.Remove(expired.Id);
        if (Operations.Count >= 128) throw new InvalidOperationException("Too many commands awaiting verification.");
        var snapshot = LiveTools.GetSnapshot(channel);
        if (!snapshot.Ready) throw new ArgumentException("Verification channel is not ready.");
        read ??= value => value == null || value.IsNull ? null : value.AsString();
        var operation = new Operation { Id = id, Command = command, Target = target, Fingerprint = fingerprint,
            Channel = channel, Scope = scope, Read = read,
            State = new CommandState(read(snapshot.Value), desired, snapshot.Revision, LiveTools.CurrentEpoch, DateTime.UtcNow) };
        // Retain verification even when an HTTP/MCP client disconnects or closes its subscriptions.
        LiveTools.Pin(channel);
        Operations.Add(id, operation);
        operation.State.Dispatching();
        EventLog.Add("command", LiveTools.JsonText(Receipt(operation)));
        if (operation.State.Pending)
        {
            try { dispatch(); }
            catch (Exception ex) { operation.State.DispatchFailed(ex.GetBaseException().Message); }
        }
        ReleaseIfFinished(operation);
        return Receipt(operation);
    }

    private static void ReleaseIfFinished(Operation op)
    {
        if (op.State.Pending || op.Released) return;
        op.Released = true;
        LiveTools.Unpin(op.Channel);
        EventLog.Add("command", LiveTools.JsonText(Receipt(op)));
    }

    public static void Tick()
    {
        foreach (var op in Operations.Values.Where(op => op.State.Pending).ToArray())
        {
            try
            {
                if (op.State.Epoch != LiveTools.CurrentEpoch)
                    op.State.Observe(LiveTools.CurrentEpoch, 0, null, DateTime.UtcNow);
                else
                {
                    var snapshot = LiveTools.GetSnapshot(op.Channel);
                    op.State.Observe(LiveTools.CurrentEpoch, snapshot.Revision, op.Read(snapshot.Value), DateTime.UtcNow);
                }
            }
            catch (Exception ex) { op.State.VerificationFailed(ex.GetBaseException().Message); }
            ReleaseIfFinished(op);
        }
    }
}
