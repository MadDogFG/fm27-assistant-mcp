using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Normal focus area operations. The add setter consumes an original dropdown row;
// the remove event consumes an original Areas record, whose shape is different.
public static class RecruitmentAreas
{
    private sealed record Area(TypedValue Original, string Key);
    private static readonly uint[] AreaFields = { 0x4e6e6174, 0x636f6d70, 0x39332020, 0x39342020 };
    private static readonly string[] AreaTypes = { "FM.UI.NationReference", "FM.UI.CompReference", "FM.UI.ContinentReference", "FM.UI.RegionReference" };
    private static string Key(TypedValue value, int expectedType = -1)
    {
        if (value == null || value.IsNull || value.DataType?.FullName == "SI.Core.DynamicNumber" ||
            (value.DataType?.FullName ?? "").StartsWith("System.", StringComparison.Ordinal))
            throw new ArgumentException("Scouting area must be an original game object reference.");
        var reference = value.Get()?.TryCast<InteropReference>();
        var type = reference?.GetIl2CppType().FullName;
        if (reference == null || !AreaTypes.Contains(type) || expectedType >= 0 && type != AreaTypes[expectedType])
            throw new ArgumentException("Unsupported or mismatched native scouting area reference.");
        return DispatchJournal.Fingerprint(type + "\n" + reference.GetPersistentIdentity());
    }
    private static List<Area> Areas(string source, string path, string areas)
    {
        var value = RecruitmentCommands.FocusChannel(areas, source, "Areas", path).Value;
        if (!(value?.DataType?.FullName ?? "").StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal))
            throw new InvalidOperationException("Game has not returned the focus's native area list.");
        var list = value.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() ?? throw new InvalidOperationException("Native areas are unavailable.");
        var result = new List<Area>();
        for (var i = 0; i < list.Count; i++)
        {
            var row = Record(list[i]) ?? throw new InvalidOperationException("Native scouting area is not a record.");
            if (!row.TryGetValue(0x31303020, out var tag) || !int.TryParse(tag.AsString(), NumberStyles.None, CultureInfo.InvariantCulture, out var type) || type < 0 || type > 3 ||
                !row.TryGetValue(AreaFields[type], out var reference)) throw new InvalidOperationException("Unknown native scouting area record shape.");
            result.Add(new Area(list[i], Key(reference, type)));
        }
        if (result.Select(area => area.Key).Distinct().Count() != result.Count) throw new InvalidOperationException("Native focus contains duplicate scouting areas; refresh before editing.");
        return result;
    }
    public static object Read(string info, string source, string path, string areas, string areaKey, string operationId)
    {
        var target = RecruitmentCommands.Target(info, source, path);
        var rows = Areas(source, path, areas);
        if (!string.IsNullOrEmpty(operationId))
        {
            if (areaKey == null || areaKey.Length != 64 || areaKey.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentException("Use the areaKey from this command's preview or receipt.");
            return ActionCommands.ObserveDomain(operationId, target.GetPersistentIdentity(), "recruitment_focus_area." + areaKey,
                rows.Any(area => area.Key == areaKey).ToString());
        }
        return new { ok = true, targetIdentity = target.GetPersistentIdentity(), sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            areas = rows.Select((area, index) => new { optionPath = index.ToString(CultureInfo.InvariantCulture), areaKey = area.Key, value = LiveTools.DescribeValue(area.Original) }).ToArray(),
            focusSubmitted = false, liveVerified = false };
    }
    private static (InteropReference Target, TypedValue Payload, string Key, string Token) Prepare(
        string info, string source, string path, string areas, string team, string choices, string selector, string action, string optionPath)
    {
        if (action != "add" && action != "remove") throw new ArgumentException("Choose add or remove for a focus area.");
        var target = RecruitmentCommands.Target(info, source, path);
        var rows = Areas(source, path, areas);
        TypedValue original;
        string key;
        string teamIdentity = null;
        string menu = null;
        if (action == "add")
        {
            RecruitmentCommands.FocusChannel(selector, source, "PossibleScoutingAreasDropdownSelectedOption", path);
            var teamSource = Channel(team, "human", "Team");
            if (teamSource.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new InvalidOperationException("Active manager changed while resolving area choices.");
            var reference = LiveTools.GetReference(team);
            if (reference.GetIl2CppType().FullName != "FM.UI.TeamReference") throw new ArgumentException("Use the active manager's real team for scouting area candidates.");
            teamIdentity = reference.GetPersistentIdentity();
            var candidates = Channel(choices, team, "PossibleScoutingAreasDropdown");
            if (candidates.Identity != teamIdentity) throw new InvalidOperationException("Team changed after area candidates were subscribed.");
            original = NativeChoiceTree.Leaf(choices, optionPath);
            key = Key(Field(Record(original), "PropertyValue"));
            if (rows.Any(area => area.Key == key)) throw new InvalidOperationException("This area is already selected in the focus.");
            menu = NativeValueFingerprint.Compute(candidates.Value);
        }
        else
        {
            if (!int.TryParse(optionPath, NumberStyles.None, CultureInfo.InvariantCulture, out var index) || index < 0 || index >= rows.Count)
                throw new ArgumentException("Choose one current Areas list index for removal.");
            original = rows[index].Original;
            key = rows[index].Key;
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = target.GetPersistentIdentity(), revision = Revision(target.GetPersistentIdentity()), action, optionPath, key, teamIdentity,
            areas = NativeValueFingerprint.Compute(LiveTools.GetSnapshot(areas).Value), menu, payload = NativeValueFingerprint.Compute(original) }));
        return (target, TypedValue.CreateCopyFrom(original), key, token);
    }
    public static object Preview(string info, string source, string path, string areas, string team, string choices, string selector, string action, string optionPath)
    {
        var prepared = Prepare(info, source, path, areas, team, choices, selector, action, optionPath);
        return new { ok = true, areaKey = prepared.Key, choiceToken = prepared.Token, action, before = action == "remove", requested = action == "add", liveVerified = false };
    }
    public static object Execute(string id, string info, string source, string path, string areas, string team, string choices, string selector, string action, string optionPath, string token)
    {
        var prepared = Prepare(info, source, path, areas, team, choices, selector, action, optionPath);
        if (prepared.Token != token) throw new InvalidOperationException("Focus areas or legal area candidates changed since preview.");
        LiveTools.RequireUnusedDraft(prepared.Target);
        // info (ScoutingInfo) is held by persistent UI roots; only the draft target needs exclusive isolation.
        // Add is the ordinary focus property setter. Remove takes the whole original area wrapper.
        var receipt = ActionCommands.DispatchDomain(id, "recruitment_focus_area_" + action, prepared.Target.GetPersistentIdentity(), token, () => {
            Touch(prepared.Target.GetPersistentIdentity());
            if (action == "add") LiveTools.UpdateProperty(selector, prepared.Payload);
            else SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1883850830, prepared.Target, prepared.Payload);
        }, (action == "remove").ToString(), (action == "add").ToString(), "recruitment_focus_area." + prepared.Key);
        return new { ok = true, areaKey = prepared.Key, receipt, focusSubmitted = false };
    }
}
