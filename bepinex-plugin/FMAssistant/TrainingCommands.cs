using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using FM.GamePlugin;
using SI.Core;

namespace FMAssistant;

// Derived from the current shipped dropdown bindings plus native player-training dispatchers.
// Only the editable training selector record is cloned; the player's data is never patched.
public static class TrainingCommands
{
    public sealed record Recipe(string Kind, string Owner, string Choices, bool ChoicesOnOwner, uint Field, uint Event);
    private static readonly Recipe[] Recipes = {
        new("intensity", "TrainingIntensityOrRest", "IndividualTrainingIntensityList", false, 0x7074766c, 1735948081),
        new("focus", "AdditionalFocus", "IndividualTrainingAdditionalFocusList", false, 0x72396d4d, 1280659764),
        new("position-role", "TrainingPosition", "IndividualTrainingPositionList", false, 0x58745a59, 2052018511),
        new("oop-role", "OOPTraining", "PossibleIndividualOOPTrainingRoles", true, 0x4634466c, 1176516205)
    };
    private const string Scope = "individual_training_configuration";
    public static object Routing() => new { ok = true, recipes = Recipes, liveVerified = false };
    private static Recipe Find(string kind) => Recipes.SingleOrDefault(r => r.Kind == kind) ?? throw new ArgumentException("Unknown individual training kind.");
    private static SI.Core.Record Record(TypedValue value) => value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    private static TypedValue Field(SI.Core.Record record, uint field) => record != null && record.TryGetValue(field, out var value) ? value : throw new ArgumentException("Training record is missing field 0x" + field.ToString("x8"));

    private static (LiveTools.Snapshot Snapshot, SI.Core.Record Record, string Target) Owner(string training, string owner, Recipe recipe)
    {
        var reference = LiveTools.GetReference(training);
        if (reference.GetIl2CppType().FullName != "FM.UI.PlayerTrainingReference") throw new ArgumentException("A real player training reference is required.");
        var snapshot = LiveTools.GetSnapshot(owner);
        if (!snapshot.Ready || snapshot.Source != training || !string.IsNullOrEmpty(snapshot.SourcePath) || snapshot.Property != InternalCommands.PropertyId(recipe.Owner))
            throw new ArgumentException("Training selector subscription does not match this player and setting.");
        return (snapshot, Record(snapshot.Value) ?? throw new ArgumentException("Training selector is not a native record."), reference.GetPersistentIdentity());
    }

    private static string Selection(Recipe recipe, TypedValue value)
    {
        if (recipe.Kind == "position-role")
        {
            var record = Record(value) ?? throw new ArgumentException("Training position choice is not a role/position record.");
            var role = ulong.Parse(Field(record, 0x7074766c).AsString(), CultureInfo.InvariantCulture);
            var position = role == 0 ? "0" : Field(record, 0x506f7369).AsString();
            return LiveTools.JsonText(new { role = role.ToString(CultureInfo.InvariantCulture), position });
        }
        return recipe.Kind == "oop-role" && (value == null || value.IsNull) ? "0" : value.AsString();
    }

    private static string Current(Recipe recipe, SI.Core.Record owner)
    {
        if (recipe.Kind == "intensity" && owner.TryGetValue(0x736d5542, out var directIntensity))
            return LiveTools.JsonText(new { selection = directIntensity.AsString(), forwarding = Field(DispatchOwner(recipe, owner), 0x4875436f).AsString() });
        var value = Field(owner, recipe.Field);
        var nested = recipe.Kind is "intensity" or "position-role" ? null : NegotiationActions.Record(value);
        var selection = Selection(recipe, nested != null ? Field(nested, 0x7074766c) : value);
        return LiveTools.JsonText(new { selection, forwarding = Field(owner, 0x4875436f).AsString() });
    }

    private static SI.Core.Record DispatchOwner(Recipe recipe, SI.Core.Record owner) =>
        recipe.Kind == "intensity" && owner.TryGetValue(0x62486137, out var row)
            ? Record(row) ?? throw new InvalidOperationException("The game's current intensity row is unavailable.")
            : owner;

    public static object Read(string kind, string training, string owner, string operationId)
    {
        var recipe = Find(kind);
        var state = Owner(training, owner, recipe);
        var current = Current(recipe, state.Record);
        return string.IsNullOrEmpty(operationId)
            ? new { ok = true, kind, current, revision = state.Snapshot.Revision, epoch = LiveTools.CurrentEpoch, targetIdentity = state.Target }
            : ActionCommands.ObserveDomain(operationId, state.Target, Scope + "." + kind, current);
    }

    private static (Recipe Recipe, uint Event, SI.Core.Record Payload, string Before, string Desired, string Target, string Token) Prepare(
        string kind, string training, string owner, string options, string editable, int optionIndex, string delegation, int roleIndex)
    {
        var recipe = Find(kind);
        var state = Owner(training, owner, recipe);
        var choices = LiveTools.GetSnapshot(options);
        if (!choices.Ready || choices.Source != (recipe.ChoicesOnOwner ? owner : training) || !string.IsNullOrEmpty(choices.SourcePath) ||
            choices.Property != InternalCommands.PropertyId(recipe.Choices)) throw new ArgumentException("Choices belong to a different training selector.");
        var canEdit = LiveTools.GetSnapshot(editable);
        if (!canEdit.Ready || canEdit.Source != owner || canEdit.Property != InternalCommands.PropertyId("CanEdit") ||
            !bool.TryParse(canEdit.Value?.AsString(), out var allowed) || !allowed) throw new InvalidOperationException("Game does not allow editing this training setting.");
        if (optionIndex < 0) throw new ArgumentException("Select a nonnegative option index.");
        var option = LiveTools.GetValue(options, optionIndex.ToString(CultureInfo.InvariantCulture));
        var row = Record(option) ?? throw new ArgumentException("Training option is not a record.");
        if (kind == "position-role" && roleIndex >= 0)
        {
            if (row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabledPosition) && disabledPosition.AsString() == "True")
                throw new InvalidOperationException("Game disabled this training position.");
            option = LiveTools.GetValue(options, $"{optionIndex}/0x34453354/{roleIndex}");
            row = Record(option) ?? throw new ArgumentException("Choose a role from the game's position group.");
        }
        if (!row.TryGetValue(0x7074766c, out var value))
        {
            option = Field(row, 0x526f7744);
            row = Record(option) ?? throw new ArgumentException("Training row has no choice data.");
            value = Field(row, 0x7074766c);
        }
        if (row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() == "True")
            throw new InvalidOperationException("Game disabled this training option.");
        if (delegation != "respect" && delegation != "take_control_this_player") throw new ArgumentException("Unknown training delegation action.");
        var desiredSelection = Selection(recipe, value);
        var payload = new SI.Bindable.DynamicReference();
        foreach (var pair in DispatchOwner(recipe, state.Record)) payload[pair.Key] = TypedValue.CreateCopyFrom(pair.Value);
        payload[recipe.Field] = TypedValue.CreateCopyFrom(recipe.Kind == "intensity" ? value : option);
        // Preserve the native forwarding/confirmation branch; the alternate helper needs its own protocol.
        var forwarding = Field(payload, 0x4875436f).AsString();
        if (!bool.TryParse(forwarding, out var isDirect)) throw new ArgumentException("Native training control flag is unavailable.");
        var eventId = recipe.Event;
        if (!isDirect)
        {
            if (delegation != "take_control_this_player") throw new InvalidOperationException("Game requires a training responsibility decision. Select take_control_this_player to execute that native player operation.");
            // Native 18057d710 builds this core configuration; 180581bb0 consumes it for the
            // real TakeControlThisPlayerTraining action. Do not forge the owner's forwarding flag.
            payload = new SI.Bindable.DynamicReference();
            var type = kind == "position-role" ? 0 : kind == "focus" ? 1 : kind == "oop-role" ? 2 : 3;
            payload[0x74797065] = TypedValue.Create((sbyte)type);
            if (kind == "intensity") payload[0x7074766c] = TypedValue.CreateCopyFrom(value);
            else if (kind == "focus") payload[0x63617467] = TypedValue.CreateCopyFrom(value);
            else if (kind == "oop-role") payload[0x726f6c65] = TypedValue.CreateCopyFrom(value);
            else
            {
                var pair = Record(value);
                var role = Field(pair, 0x7074766c);
                payload[0x726f6c65] = TypedValue.CreateCopyFrom(role);
                payload[0x706f736e] = role.AsString() == "0" ? TypedValue.Create(0) : TypedValue.CreateCopyFrom(Field(pair, 0x506f7369));
            }
            eventId = (uint)InteropEventIDs.EventFmxTakeControlThisPlayerTraining;
        }
        var desired = LiveTools.JsonText(new { selection = desiredSelection, forwarding = "True" });
        var before = Current(recipe, state.Record);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, kind, state.Target, before, desired,
            eventId, delegation, payload = NativeValueFingerprint.Compute(GameTools.MakeObjectTypedValue(payload)) }));
        return (recipe, eventId, payload, before, desired, state.Target, token);
    }

    public static object Preview(string kind, string training, string owner, string options, string editable, int optionIndex, string delegation, int roleIndex)
    {
        var prepared = Prepare(kind, training, owner, options, editable, optionIndex, delegation, roleIndex);
        return new { ok = true, kind, before = prepared.Before, requested = prepared.Desired, choiceToken = prepared.Token,
            delegation, nativeEventId = prepared.Event,
            verificationScope = Scope + "." + kind, liveVerified = false };
    }

    public static object Execute(string id, string kind, string training, string owner, string options, string editable, int optionIndex, string token, string delegation, int roleIndex)
    {
        var prepared = Prepare(kind, training, owner, options, editable, optionIndex, delegation, roleIndex);
        if (prepared.Token != token) throw new InvalidOperationException("Training state or choice changed; refresh before applying.");
        return ActionCommands.DispatchDomain(id, "set_training_" + kind, prepared.Target,
            LiveTools.JsonText(new { kind, delegation, prepared.Before, prepared.Desired }), () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>()
                .SendEvent(prepared.Event, LiveTools.GetReference(training), GameTools.MakeObjectTypedValue(prepared.Payload)),
            prepared.Before, prepared.Desired, Scope + "." + kind);
    }
}
