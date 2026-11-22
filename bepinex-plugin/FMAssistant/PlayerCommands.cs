using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Domain-specific recipes only. Never expose arbitrary property mutation as a manager operation.
public static class PlayerCommands
{
    internal static string Tactic(string handle)
    {
        var target = LiveTools.GetReference(handle);
        var type = target.GetIl2CppType().FullName;
        if (type == "FM.UI.MatchTacticReference") MatchCommands.RequireCurrentTactic(handle);
        if (type != "FM.UI.TeamTacticReference" && type != "FM.UI.MatchTacticReference")
            throw new ArgumentException("A real team or match tactic reference is required.");
        return target.GetPersistentIdentity();
    }

    internal static LiveTools.Snapshot Channel(string handle, string target, string property, IDictionary<string, string> contexts = null)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Identity != LiveTools.GetReference(target).GetPersistentIdentity() ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Subscription has the wrong target or property: " + property);
        if (contexts != null && contexts.Any(pair => !snapshot.Contexts.TryGetValue(pair.Key, out var value) || value != pair.Value))
            throw new ArgumentException("Subscription contexts do not match this operation.");
        return snapshot;
    }

    private static void Expected(LiveTools.Snapshot current, string expected)
    {
        if (expected == null || current.Value?.AsString() != expected)
            throw new InvalidOperationException("Current value changed; refresh before applying.");
    }

    public static object Mentality(string id, string tactic, string current, string write, string options, string optionPath, string expected)
    {
        var identity = Tactic(tactic);
        var snapshot = Channel(current, tactic, "Mentality");
        Channel(write, tactic, "MentalityDropdown");
        Channel(options, tactic, "MentalityDropdownOptions");
        Expected(snapshot, expected);
        // Only a direct game-provided dropdown record is sent, with its original scalar types.
        if (!int.TryParse(optionPath, out var index) || index < 0) throw new ArgumentException("Select a top-level mentality option.");
        var row = LiveTools.GetValue(options, optionPath);
        var record = row?.Get()?.TryCast<SI.Core.Record>() ?? throw new ArgumentException("Not a dropdown option.");
        if (!record.TryGetValue(InternalCommands.PropertyId("PropertyValue"), out var desired) ||
            !int.TryParse(desired.AsString(), out var number) || number < 0) throw new ArgumentException("Not a mentality choice.");
        return CommandOperations.Start(id, "set_mentality", identity, expected, current, desired.AsString(), "tactic_state",
            () => LiveTools.UpdateProperty(write, TypedValue.CreateCopyFrom(row)));
    }

    public static object Instruction(string id, string tactic, string current, string locked, string kind,
        int group, uint option, int slot, bool phase, string expected)
    {
        var identity = Tactic(tactic);
        if (kind != "team" && kind != "player") throw new ArgumentException("kind must be team or player.");
        var contexts = new Dictionary<string, string>();
        if (kind == "team") contexts["TeamInstructionID"] = group.ToString(CultureInfo.InvariantCulture);
        else
        {
            if (slot < 0 || slot > 10) throw new ArgumentException("A starting slot 0..10 is required.");
            contexts["PlayerInstructionGroupID"] = group.ToString(CultureInfo.InvariantCulture);
            contexts["TeamSelectionIndex"] = slot.ToString(CultureInfo.InvariantCulture);
            contexts["InPossession"] = phase ? "True" : "False";
            var lockState = Channel(locked, tactic, "PlayerInstructionGroupIsLocked", contexts);
            if (!bool.TryParse(lockState.Value?.AsString(), out var isLocked) || isLocked)
                throw new InvalidOperationException("This instruction group is locked for the current player/role.");
        }
        var catalog = kind == "team" ? InstructionCatalog.Team() : InstructionCatalog.Player();
        var entry = catalog.SingleOrDefault(i => i.Id == group) ?? throw new ArgumentException("Instruction asset is unavailable or does not contain this group.");
        if (!(kind == "player" && option == 0) && !entry.Options.Any(i => i.Id == option))
            throw new ArgumentException("Select an option from the current game's instruction catalog.");
        var snapshot = Channel(current, tactic, kind == "team" ? "SelectedTeamInstructionOption" : "SelectedPlayerInstruction", contexts);
        Expected(snapshot, expected);
        var semantic = LiveTools.JsonText(new { kind, group, option, slot, phase, expected });
        return CommandOperations.Start(id, "set_" + kind + "_instruction", identity, semantic, current,
            option.ToString(CultureInfo.InvariantCulture), "tactic_state", () => LiveTools.UpdateProperty(current, TypedValue.Create(option)));
    }

}
