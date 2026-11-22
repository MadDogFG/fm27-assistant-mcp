using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

public static class RecruitmentCommands
{
    public sealed record Recipe(string Kind, string Current, string Choices, string Input, uint Event = 0, string Increment = null, string Decrement = null);
    private static readonly Recipe[] Recipes = {
        new("min-age", "MinAgeValue", "MinAgeList", "choice"), new("max-age", "MaxAgeValue", "MaxAgeList", "choice"),
        new("name", "Name", null, "text"), new("include-scouted", "ShouldIncludeScoutedPlayers", null, "boolean"),
        new("undeclared-players", "SearchForUndeclaredPlayers", null, "boolean"), new("priority", "Priority", null, "priority_index"),
        new("any-position", "AnyPosition", null, "boolean"),
        new("position", "TacticsSlotValue", "TacticsSlotDropdown", "choice"),
        new("ip-role", "RoleValue", "RolesList", "choice"), new("oop-role", "OOPRoleValue", "OOPRolesList", "choice"),
        new("current-ability-threshold", "PlayerCurrentAbility", null, "star-step", 1517250124, "PlayerCurrentAbilityIncrementEnabled", "PlayerCurrentAbilityDecrementEnabled"),
        new("potential-ability-threshold", "PlayerPotentialAbility", null, "star-step", 1431517038, "PlayerPotentialAbilityIncrementEnabled", "PlayerPotentialAbilityDecrementEnabled"),
        new("ip-role-proficiency", "TacticsRoleIpProficiency", null, "proficiency-step", 960968525),
        new("oop-role-proficiency", "TacticsRoleOopProficiency", null, "proficiency-step", 1449946478)
    };
    private static readonly string[] Fields = { "UniqueId", "Name", "MinAgeValue", "MaxAgeValue", "Priority", "ShouldIncludeScoutedPlayers",
        "SearchForUndeclaredPlayers", "TransferDealType", "AnyPosition", "TacticsSlotValue", "RoleValue", "OOPRoleValue", "PlayerCurrentAbility", "PlayerPotentialAbility",
        "TacticsRoleIpProficiency", "TacticsRoleOopProficiency", "Areas", "Scouts", "Analysts", "AnyScout", "AnyAnalyst", "IsValid", "DuplicateFocusName" };
    public static object Routing() => new { ok = true, recipes = Recipes, snapshotFields = Fields, liveVerified = false,
        snapshotScope = "recovered_fields_only_not_complete_filter_serialization" };
    private static Recipe Find(string kind) => Recipes.SingleOrDefault(r => r.Kind == kind) ?? throw new ArgumentException("Unknown recruitment focus setting.");
    internal static InteropReference Target(string info, string source, string path)
    {
        var origin = LiveTools.GetSnapshot(info);
        if (!origin.Ready || origin.Source != "human" || !string.IsNullOrEmpty(origin.SourcePath) ||
            origin.Property != InternalCommands.PropertyId("ScoutingInfo") || origin.Identity != LiveTools.GetReference("human").GetPersistentIdentity())
            throw new ArgumentException("Use the active manager's actual ScoutingInfo.");
        var parent = string.IsNullOrEmpty(path) ? Channel(source, info, "NewRecruitmentFocus") : Channel(source, info, "RecruitmentFocusesList");
        if (parent.Identity != LiveTools.GetReference(info).GetPersistentIdentity()) throw new InvalidOperationException("Scouting context changed after the focus was resolved.");
        var target = LiveTools.GetReference(source, path);
        if (target.GetIl2CppType().FullName != "FM.UI.RecruitmentFocusItemReference") throw new ArgumentException("Select an actual recruitment focus reference, not an ID or fabricated record.");
        return target;
    }
    internal static LiveTools.Snapshot FocusChannel(string handle, string source, string property, string path)
    {
        var snapshot = Channel(handle, source, property, path);
        if (snapshot.Identity != LiveTools.GetReference(source, path).GetPersistentIdentity()) throw new InvalidOperationException("Recruitment focus list changed after this field was subscribed. Refresh the focus.");
        return snapshot;
    }
    private static TypedValue Selection(Recipe recipe, TypedValue value)
    {
        if (recipe.Input == "choice") return Field(Record(value), "PropertyValue");
        if (recipe.Input == "star-step")
        {
            var row = Record(value) ?? throw new InvalidOperationException("Game ability threshold is not a star-range record.");
            if (!row.TryGetValue(0x4d696e56, out var min) || !row.TryGetValue(0x4d617856, out var max) || min.AsString() != max.AsString())
                throw new InvalidOperationException("Game did not return one concrete ability threshold.");
            return min;
        }
        return value;
    }
    private static (InteropReference Target, TypedValue Payload, string Before, string Desired, string Token) Prepare(
        string info, string source, string path, string kind, string current, string choices, int optionIndex, string optionPath, string input, string simplified, string increment, string decrement)
    {
        var target = Target(info, source, path);
        var recipe = Find(kind);
        var before = Selection(recipe, FocusChannel(current, source, recipe.Current, path).Value).AsString();
        TypedValue payload;
        string desired;
        if (recipe.Input == "choice")
        {
            FocusChannel(choices, source, recipe.Choices, path);
            if (string.IsNullOrEmpty(optionPath) && optionIndex < 0) throw new ArgumentException("Select an original dropdown option.");
            var option = NativeChoiceTree.Leaf(choices, string.IsNullOrEmpty(optionPath) ? optionIndex.ToString(CultureInfo.InvariantCulture) : optionPath);
            var row = Record(option);
            desired = Field(row, "PropertyValue").AsString();
            payload = TypedValue.CreateCopyFrom(option);
        }
        else if (recipe.Input == "text")
        {
            if (input == null || input.Length > 120 || input.Contains('\0')) throw new ArgumentException("Focus name must fit the game's 120-character field and contain no NUL.");
            payload = TypedValue.Create(input); desired = input;
        }
        else if (recipe.Input == "boolean")
        {
            if (!bool.TryParse(input, out var value)) throw new ArgumentException("Use true or false for this focus option.");
            payload = TypedValue.Create(value); desired = value.ToString();
        }
        else if (recipe.Input == "star-step" || recipe.Input == "proficiency-step")
        {
            if (input != "increase" && input != "decrease") throw new ArgumentException("Choose the game's increase or decrease threshold operation.");
            if (recipe.Input == "star-step")
            {
                var up = FocusChannel(increment, source, recipe.Increment, path).Value;
                var down = FocusChannel(decrement, source, recipe.Decrement, path).Value;
                if (!bool.TryParse((input == "increase" ? up : down)?.AsString(), out var allowed) || !allowed)
                    throw new InvalidOperationException("Game disabled this ability threshold step.");
            }
            var maximum = recipe.Input == "proficiency-step" ? 3 : 20;
            if (!int.TryParse(before, NumberStyles.None, CultureInfo.InvariantCulture, out var threshold)) throw new InvalidOperationException("Game threshold has no integral native step value.");
            var next = threshold + (input == "increase" ? 1 : -1);
            if (threshold < 1 || threshold > maximum || next < 1 || next > maximum) throw new InvalidOperationException("Threshold step is outside the recovered game range.");
            payload = TypedValue.Create(input == "increase" ? 1 : 0); desired = next.ToString(CultureInfo.InvariantCulture);
        }
        else
        {
            var mode = Channel(simplified, "singleton:FM.UI.ConfigReference", "UseSimplifiedRecruitment").Value;
            if (!bool.TryParse(mode?.AsString(), out var isSimplified)) throw new InvalidOperationException("Game recruitment mode is unavailable.");
            // FocusPriorityButtons: three ordered buttons in full mode, two in simplified mode;
            // empty OptionValues uses their ordered indices. Native setter maps these indices to core priority.
            if (!int.TryParse(input, NumberStyles.None, CultureInfo.InvariantCulture, out var priority) || priority > (isSimplified ? 1 : 2))
                throw new ArgumentException("Priority must be one of the current game's focus priority button indices.");
            payload = TypedValue.Create(priority); desired = priority.ToString(CultureInfo.InvariantCulture);
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            identity = target.GetPersistentIdentity(), revision = Revision(target.GetPersistentIdentity()), kind, before, desired,
            payload = NativeValueFingerprint.Compute(payload), mode = recipe.Input == "priority_index" ? NativeValueFingerprint.Compute(LiveTools.GetSnapshot(simplified).Value) : null }));
        return (target, payload, before, desired, token);
    }
    public static object Read(string info, string source, string path, string kind, string current, string operationId)
    {
        var target = Target(info, source, path); var recipe = Find(kind);
        var value = FocusChannel(current, source, recipe.Current, path).Value;
        return string.IsNullOrEmpty(operationId) ? new { ok = true, current = Selection(recipe, value).AsString(), raw = LiveTools.DescribeValue(value),
            targetIdentity = target.GetPersistentIdentity(), sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, verificationScope = "recruitment_focus_draft." + kind }
            : ActionCommands.ObserveDomain(operationId, target.GetPersistentIdentity(), "recruitment_focus_draft." + kind, Selection(recipe, value).AsString());
    }
    public static object Preview(string info, string source, string path, string kind, string current, string choices, int optionIndex, string optionPath, string input, string simplified, string increment, string decrement)
    {
        var prepared = Prepare(info, source, path, kind, current, choices, optionIndex, optionPath, input, simplified, increment, decrement);
        return new { ok = true, before = prepared.Before, requested = prepared.Desired, choiceToken = prepared.Token, liveVerified = false };
    }
    public static object Execute(string id, string info, string source, string path, string kind, string current, string choices, int optionIndex, string optionPath, string input, string simplified, string increment, string decrement, string token)
    {
        var prepared = Prepare(info, source, path, kind, current, choices, optionIndex, optionPath, input, simplified, increment, decrement);
        if (prepared.Token != token) throw new InvalidOperationException("Recruitment focus, draft or legal option changed since preview.");
        LiveTools.RequireUnusedDraft(prepared.Target);
        // info (ScoutingInfo) is held by the game's persistent UI roots; only the focus draft target needs exclusive draft isolation.
        return ActionCommands.DispatchDomain(id, "recruitment_focus_" + kind, prepared.Target.GetPersistentIdentity(), token, () => {
            Touch(prepared.Target.GetPersistentIdentity());
            var recipe = Find(kind);
            if (recipe.Event == 0) LiveTools.UpdateProperty(current, prepared.Payload);
            else SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(recipe.Event, prepared.Target, prepared.Payload);
        }, prepared.Before, prepared.Desired, "recruitment_focus_draft." + kind);
    }
    private static (InteropReference Target, string Token, Dictionary<string, object> Values) Draft(string info, string source, string path, string fieldsJson)
    {
        var target = Target(info, source, path);
        using var document = JsonDocument.Parse(fieldsJson);
        var supplied = document.RootElement;
        if (supplied.ValueKind != JsonValueKind.Object || supplied.EnumerateObject().Count() != Fields.Length) throw new ArgumentException("Supply all recovered focus snapshot fields.");
        var values = new Dictionary<string, object>(); var fingerprints = new Dictionary<string, string>();
        foreach (var property in Fields)
        {
            if (!supplied.TryGetProperty(property, out var handle) || handle.ValueKind != JsonValueKind.String) throw new ArgumentException("Missing focus snapshot channel: " + property);
            var value = FocusChannel(handle.GetString(), source, property, path).Value;
            values[property] = LiveTools.DescribeValue(value); fingerprints[property] = NativeValueFingerprint.Compute(value);
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = target.GetPersistentIdentity(), revision = Revision(target.GetPersistentIdentity()), fingerprints }));
        return (target, token, values);
    }
    public static object Snapshot(string info, string source, string path, string fieldsJson)
    {
        var draft = Draft(info, source, path, fieldsJson);
        return new { ok = true, targetIdentity = draft.Target.GetPersistentIdentity(), draftToken = draft.Token, fields = draft.Values,
            tokenScope = "recovered_fields_only_not_complete_filter_serialization", liveVerified = false };
    }
    public static object Complete(string id, string action, string info, string source, string path, string fieldsJson, string token)
    {
        if (action != "submit" && action != "cancel") throw new ArgumentException("Choose submit or cancel for this focus draft.");
        var draft = Draft(info, source, path, fieldsJson);
        if (token != draft.Token) throw new InvalidOperationException("Recruitment focus changed since preview.");
        if (action == "submit")
        {
            using var document = JsonDocument.Parse(fieldsJson);
            var valid = LiveTools.GetSnapshot(document.RootElement.GetProperty("IsValid").GetString()).Value;
            var duplicate = LiveTools.GetSnapshot(document.RootElement.GetProperty("DuplicateFocusName").GetString()).Value;
            var dupText = duplicate?.AsString() ?? "";
            var isDuplicate = bool.TryParse(dupText, out var b) ? b : !string.IsNullOrEmpty(dupText);
            if (!bool.TryParse(valid?.AsString(), out var isValid) || !isValid || isDuplicate)
                throw new InvalidOperationException("Game marks the focus invalid or its name duplicate.");
        }
        LiveTools.RequireUnusedDraft(draft.Target);
        // info (ScoutingInfo) is held by persistent UI roots; only the draft target needs exclusive isolation.
        return ActionCommands.DispatchDomain(id, "recruitment_focus_" + action, draft.Target.GetPersistentIdentity(), token, () => {
            Touch(draft.Target.GetPersistentIdentity()); SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(action == "submit" ? 55u : 56u, draft.Target, TypedValue.Null);
        }, null, null, "recruitment_focus_" + action + "_dispatch");
    }
}
