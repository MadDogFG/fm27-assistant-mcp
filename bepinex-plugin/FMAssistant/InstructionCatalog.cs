// Protocol/asset mapping informed by FootballManagerMCP (MIT), copyright 2026 Leo Paradowski.
// See THIRD_PARTY_NOTICES.md for the license and pinned source revision.
using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using FM.UI;
using Il2CppInterop.Runtime;
using SI.Translation;
using UnityEngine;

namespace FMAssistant;

public static class InstructionCatalog
{
    private static AssetBundle StaticDataBundle;
    // Identified in the current game's own bundle container, not a fabricated data table.
    private static void LoadInstructionAssets()
    {
        var keys = new[] { "64a0d16a6bec8da449bd4a8d4b62f744", "d2e2da26dd18e1e4e8e422903fe5cd55" };
        if (StaticDataBundle == null)
        {
            var iterator = AssetBundle.GetAllLoadedAssetBundles().TryCast<Il2CppSystem.Collections.IEnumerable>().GetEnumerator();
            while (iterator.MoveNext())
            {
                var bundle = iterator.Current?.TryCast<AssetBundle>();
                if (bundle == null) continue;
                if (bundle.GetAllAssetNames().Any(name => keys.Contains(name))) { StaticDataBundle = bundle; break; }
            }
            if (StaticDataBundle == null)
            {
                var path = Path.Combine(BepInEx.Paths.GameRootPath, "fm_Data", "StreamingAssets", "aa", "StandaloneWindows64", "ui-staticdataentries_assets_all.bundle");
                if (File.Exists(path)) StaticDataBundle = AssetBundle.LoadFromFile(path);
            }
        }
        if (StaticDataBundle == null) return;
        // Instantiate only static instruction data. No panel or VisualElement is created.
        StaticDataBundle.LoadAsset(keys[0], Il2CppType.Of<TacticTeamInstructionData>());
        StaticDataBundle.LoadAsset(keys[1], Il2CppType.Of<PlayerInstructionEntries>());
    }
    public sealed record Option(string Key, uint Id, string Name);
    public sealed record Instruction(string Key, int Id, string Name, string Phase, Option[] Options);
    private static readonly Dictionary<string, string> PropertyAliases = new()
    {
        ["DefensiveLineMuchDeeper"] = "MuchDeeperDefensiveLine", ["DefensiveLineDeeper"] = "DeeperDefensiveLine",
        ["DefensiveLineHigherDefensiveLine"] = "HigherDefensiveLine", ["DefensiveLineMuchHigher"] = "MuchHigherDefensiveLine",
        ["LineOfEngagementHigh"] = "LineOfEngagementHigher", ["WasteTimeLessOften"] = "TimeWastingNone",
        ["WasteTimeStandard"] = "WasteTime", ["WasteTimeMoreOften"] = "TimeWastingExtreme"
    };
    private static string Translate(TranslationID id)
    {
        try { return TranslationManager.Translate(id.GameID); } catch { return null; }
    }

    internal static Instruction[] Team()
    {
        if (Resources.FindObjectsOfTypeAll(Il2CppType.Of<TacticTeamInstructionData>()).Length == 0) LoadInstructionAssets();
        var result = new Dictionary<int, Instruction>();
        foreach (var asset in Resources.FindObjectsOfTypeAll(Il2CppType.Of<TacticTeamInstructionData>()))
        {
            var data = asset.TryCast<TacticTeamInstructionData>()?.m_storedDataEntryList;
            if (data == null) continue;
            foreach (var entry in data)
            {
                if (entry == null) continue;
                var choices = new List<Option>();
                if (entry.m_instructionOptionEntries != null)
                    foreach (var option in entry.m_instructionOptionEntries)
                    {
                        if (option == null) continue;
                        var key = option.m_optionID.ToString();
                        // Unknown mappings are omitted; an enum number is not a native property ID.
                        try { choices.Add(new Option(key, InternalCommands.PropertyId(PropertyAliases.GetValueOrDefault(key, key)), Translate(option.m_nameTranslationID))); }
                        catch (ArgumentException) { }
                    }
                var id = (int)entry.m_instructionID;
                var instruction = new Instruction(entry.m_instructionID.ToString(), id, Translate(entry.m_nameTranslationID), entry.m_phaseID.ToString(), choices.ToArray());
                if (result.TryGetValue(id, out var previous) && LiveTools.JsonText(previous) != LiveTools.JsonText(instruction))
                    throw new InvalidOperationException("Conflicting loaded team instruction assets.");
                result[id] = instruction;
            }
        }
        return result.Values.OrderBy(i => i.Id).ToArray();
    }

    internal static Instruction[] Player()
    {
        if (Resources.FindObjectsOfTypeAll(Il2CppType.Of<PlayerInstructionEntries>()).Length == 0) LoadInstructionAssets();
        var result = new Dictionary<int, Instruction>();
        foreach (var asset in Resources.FindObjectsOfTypeAll(Il2CppType.Of<PlayerInstructionEntries>()))
        {
            var groups = asset.TryCast<PlayerInstructionEntries>()?.m_playerInstructionGroups;
            if (groups == null) continue;
            foreach (var group in groups)
            {
                if (group == null) continue;
                var options = new List<Option>();
                if (group.m_playerInstructionOptionEntries != null)
                    foreach (var option in group.m_playerInstructionOptionEntries)
                        if (option != null) options.Add(new Option(option.m_instructionID.ToString(), (uint)option.m_instructionID, Translate(option.m_instructionTranslation)));
                var id = (int)group.m_groupID;
                var instruction = new Instruction(group.m_groupID.ToString(), id, Translate(group.m_groupName), null, options.ToArray());
                if (result.TryGetValue(id, out var previous) && LiveTools.JsonText(previous) != LiveTools.JsonText(instruction))
                    throw new InvalidOperationException("Conflicting loaded player instruction assets.");
                result[id] = instruction;
            }
        }
        return result.Values.OrderBy(i => i.Id).ToArray();
    }

    public static object Get(string kind)
    {
        if (kind != "team" && kind != "player") throw new ArgumentException("kind must be team or player.");
        var values = kind == "team" ? Team() : Player();
        return new { ok = true, status = values.Length == 0 ? "asset_unavailable" : "ready", kind,
            source = "loaded_game_assets", requiresUiNavigation = false, instructions = values,
            note = values.Length == 0 ? "Instruction assets are not loaded. No page will be opened automatically." : null };
    }
}
