using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using FM.GamePlugin;
using SI.Core;

namespace FMAssistant;

// Domain commands consume current game-provided options. No arbitrary role IDs or pointers.
public static class TacticCommands
{
    private const uint RoleOptionsProperty = 0x47414350; // AvailableRolesDropdown
    private const uint RoleValueProperty = 1902275159;
    private sealed class Operation
    {
        public string Id, Fingerprint, Status, RoleChannel, Before, Desired, After, TacticIdentity, Error, Command;
        public long InitialRevision;
        public int Epoch, SelectionIndex;
        public bool InPossession;
        public System.DateTime Started;
    }
    private static readonly Dictionary<string, Operation> Operations = new();
    public static bool Contains(string id) => Operations.ContainsKey(id ?? "");
    public static bool HasPending(string target) => Operations.Values.Any(op => op.Status == "pending" && op.TacticIdentity == target);

    private static object Receipt(Operation op) => new
    {
        ok = op.Status == "pending" || op.Status == "verified" || op.Status == "no_change",
        operationId = op.Id, status = op.Status, verified = op.Status == "verified" || op.Status == "no_change",
        command = op.Command,
        verificationScope = "tactic_state", matchEffectVerified = false,
        retrySafe = false, epoch = op.Epoch, tacticIdentity = op.TacticIdentity,
        selectionIndex = op.SelectionIndex, inPossession = op.InPossession,
        before = op.Before, requested = op.Desired, after = op.After, error = op.Error
    };

    private static LiveTools.Snapshot ValidateChannel(string handle, string tactic, uint property, int slot, bool phase)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != tactic || !string.IsNullOrEmpty(snapshot.SourcePath) || snapshot.Property != property ||
            !snapshot.Contexts.TryGetValue("TeamSelectionIndex", out var index) || index != slot.ToString(CultureInfo.InvariantCulture) ||
            !snapshot.Contexts.TryGetValue("InPossession", out var possession) || possession != (phase ? "True" : "False"))
            throw new ArgumentException("Subscription does not match the requested tactic, slot and phase.");
        return snapshot;
    }

    public static object SetRole(string id, string tactic, string options, string roleChannel, int optionIndex,
        int selectionIndex, bool inPossession, string expectedRole)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 100) throw new ArgumentException("An idempotency key (1..100 characters) is required.");
        var fingerprint = string.Join("|", LiveTools.CurrentEpoch, tactic, options, roleChannel, optionIndex, selectionIndex, inPossession, expectedRole);
        if (Operations.TryGetValue(id, out var previous))
        {
            if (previous.Fingerprint != fingerprint) throw new ArgumentException("Idempotency key was already used with different arguments.");
            return Receipt(previous);
        }
        if (selectionIndex < 0 || selectionIndex > 10) throw new ArgumentException("A starting position index 0..10 is required.");
        var target = LiveTools.GetReference(tactic);
        var type = target.GetIl2CppType().FullName;
        if (type == "FM.UI.MatchTacticReference") MatchCommands.RequireCurrentTactic(tactic);
        else if (type != "FM.UI.TeamTacticReference") throw new ArgumentException("Unsupported tactic target type.");
        var current = ValidateChannel(roleChannel, tactic, RoleValueProperty, selectionIndex, inPossession);
        ValidateChannel(options, tactic, RoleOptionsProperty, selectionIndex, inPossession);
        var before = current.Value?.AsString();
        if (before != expectedRole) throw new InvalidOperationException("Role changed since it was read; refresh current options.");
        var row = LiveTools.GetValue(options, optionIndex + "/0x526f7744");
        var rowRecord = row.Get().TryCast<SI.Core.Record>() ?? throw new ArgumentException("Not a role option.");
        if (!rowRecord.TryGetValue(0x7074766c, out var optionType) || optionType.AsString() != "1") throw new ArgumentException("Selected row is a navigation action, not a role.");
        var desiredValue = LiveTools.GetValue(options, optionIndex + "/0x526f7744/0x71764a36/0x506f736a");
        var desired = ulong.Parse(desiredValue.AsString(), CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture);
        var identity = target.GetPersistentIdentity();
        if (CommandOperations.Contains(id) || ActionCommands.Contains(id) || SubstitutionCommands.ContainsRoot(id)) throw new ArgumentException("Operation ID already belongs to another command.");
        if (CommandOperations.HasPending(identity) || HasPending(identity))
            throw new InvalidOperationException("Another command for this tactic is awaiting verification.");
        foreach (var old in Operations.Values.Where(op => op.Status != "pending").OrderBy(op => op.Started).Take(Math.Max(0, Operations.Count - 127)).ToArray())
            Operations.Remove(old.Id);
        if (Operations.Count >= 128) throw new InvalidOperationException("Operation receipt limit reached.");
        var operation = new Operation { Id = id, Command = "set_role", Fingerprint = fingerprint, Status = before == desired ? "no_change" : "pending",
            RoleChannel = roleChannel, Before = before, Desired = desired, After = before == desired ? before : null,
            InitialRevision = current.Revision, Epoch = LiveTools.CurrentEpoch, SelectionIndex = selectionIndex,
            InPossession = inPossession, TacticIdentity = identity, Started = System.DateTime.UtcNow };
        Operations.Add(id, operation);
        LiveTools.Pin(roleChannel);
        if (operation.Status == "no_change") { LiveTools.Unpin(roleChannel); return Receipt(operation); }
        try
        {
            var record = new SI.Core.Record();
            record[0x54536978] = TypedValue.Create(selectionIndex);
            record[0x506f736a] = TypedValue.CreateCopyFrom(row);
            record[0x4b727553] = TypedValue.Create(inPossession);
            var interop = SI.Core.GameSubsystems.Get<GameInteropSubsystem>() ?? throw new InvalidOperationException("Game interop unavailable.");
            interop.SendEvent(0x57785256, target, GameTools.MakeObjectTypedValue(record));
            EventLog.Add("command", LiveTools.JsonText(Receipt(operation)));
        }
        catch (Exception ex)
        {
            // A throwing native boundary may already have applied a command. Never auto-retry it.
            operation.Status = "dispatch_result_unknown";
            operation.Error = ex.GetBaseException().Message;
            LiveTools.Unpin(roleChannel);
        }
        return Receipt(operation);
    }

    public static object SetFormation(string id, string tactic, string options, string currentChannel, string optionPath,
        bool inPossession, string expected)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 100) throw new ArgumentException("An idempotency key is required.");
        var fingerprint = string.Join("|", LiveTools.CurrentEpoch, "formation", tactic, options, currentChannel, optionPath, inPossession, expected);
        if (Operations.TryGetValue(id, out var previous))
        {
            if (previous.Fingerprint != fingerprint) throw new ArgumentException("Idempotency key has different arguments.");
            return Receipt(previous);
        }
        var target = LiveTools.GetReference(tactic);
        var type = target.GetIl2CppType().FullName;
        if (type == "FM.UI.MatchTacticReference") MatchCommands.RequireCurrentTactic(tactic);
        else if (type != "FM.UI.TeamTacticReference") throw new ArgumentException("Unsupported tactic target.");
        var current = LiveTools.GetSnapshot(currentChannel);
        var choices = LiveTools.GetSnapshot(options);
        bool SamePhase(LiveTools.Snapshot value) => value.Source == tactic && string.IsNullOrEmpty(value.SourcePath) && value.Ready &&
            value.Contexts.TryGetValue("InPossession", out var phase) && phase == (inPossession ? "True" : "False");
        if (current.Property != 942940192 || choices.Property != 1364686705 || !SamePhase(current) || !SamePhase(choices))
            throw new ArgumentException("Formation subscriptions do not match the target and phase.");
        var row = LiveTools.GetValue(options, optionPath).Get()?.TryCast<SI.Core.Record>();
        if (optionPath.Split('/').Contains("0x526f7744", StringComparer.OrdinalIgnoreCase) ||
            row == null || row.Count != 2 || !row.TryGetValue(0x7074766c, out var desiredValue) ||
            !row.TryGetValue(0x71764a36, out var label) || label.DataType?.FullName != "System.String" ||
            !int.TryParse(desiredValue.AsString(), out var number) || number <= 0)
            throw new ArgumentException("Select a formation leaf from the game's formation options.");
        var before = current.Value?.AsString();
        if (before != expected) throw new InvalidOperationException("Formation changed; refresh before applying.");
        var identity = target.GetPersistentIdentity();
        if (CommandOperations.Contains(id) || ActionCommands.Contains(id) || SubstitutionCommands.ContainsRoot(id)) throw new ArgumentException("Operation ID already belongs to another command.");
        if (CommandOperations.HasPending(identity) || HasPending(identity)) throw new InvalidOperationException("A tactic command is already pending.");
        foreach (var old in Operations.Values.Where(op => op.Status != "pending").OrderBy(op => op.Started).Take(Math.Max(0, Operations.Count - 127)).ToArray())
            Operations.Remove(old.Id);
        if (Operations.Count >= 128) throw new InvalidOperationException("Operation receipt limit reached.");
        var operation = new Operation { Id = id, Command = "set_formation", Fingerprint = fingerprint,
            Status = before == desiredValue.AsString() ? "no_change" : "pending", RoleChannel = currentChannel,
            Before = before, Desired = desiredValue.AsString(), InitialRevision = current.Revision,
            Epoch = LiveTools.CurrentEpoch, SelectionIndex = -1, InPossession = inPossession,
            TacticIdentity = identity, Started = System.DateTime.UtcNow };
        if (operation.Status == "no_change") operation.After = before;
        Operations.Add(id, operation);
        if (operation.Status == "pending")
        {
            LiveTools.Pin(currentChannel);
            try { LiveTools.UpdateProperty(currentChannel, TypedValue.CreateCopyFrom(desiredValue)); }
            catch (Exception ex) { operation.Status = "dispatch_result_unknown"; operation.Error = ex.Message; LiveTools.Unpin(currentChannel); }
        }
        EventLog.Add("command", LiveTools.JsonText(Receipt(operation)));
        return Receipt(operation);
    }

    public static object Get(string id) => Operations.TryGetValue(id ?? "", out var operation)
        ? Receipt(operation) : throw new ArgumentException("Unknown operation ID.");

    public static void Tick()
    {
        foreach (var op in Operations.Values.Where(op => op.Status == "pending").ToArray())
        {
            try
            {
                if (op.Epoch != LiveTools.CurrentEpoch) op.Status = "session_changed";
                else
                {
                    var snapshot = LiveTools.GetSnapshot(op.RoleChannel);
                    if (snapshot.Revision > op.InitialRevision)
                    {
                        op.After = snapshot.Value?.AsString();
                        if (op.After == op.Desired) op.Status = "verified";
                        else if (op.After != op.Before) op.Status = "conflict";
                    }
                    if (op.Status == "pending" && (System.DateTime.UtcNow - op.Started).TotalSeconds > 8) op.Status = "unverified_timeout";
                }
            }
            catch (Exception ex) { op.Status = "verification_unavailable"; op.Error = ex.Message; }
            if (op.Status != "pending") { LiveTools.Unpin(op.RoleChannel); EventLog.Add("command", LiveTools.JsonText(Receipt(op))); }
        }
    }
}
