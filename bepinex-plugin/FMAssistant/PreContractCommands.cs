using System;
using System.Globalization;
using System.Linq;
using SI.Core;
using FM.GamePlugin;
using SI.Interop;

namespace FMAssistant;

// Shipped ContractPromisesBlock and its original component dropdowns/events.
// These operations negotiate promises, not the eventual fulfilment of a promise.
public static class PreContractCommands
{
    public sealed record Recipe(string Action, string Collection = "", string Owner = "", string Current = "", string Choices = "",
        string Permission = "", bool Lock = false, uint Event = 0, bool Numeric = false);
    private static readonly Recipe[] Recipes = {
        new("agreed-playing-time", Owner: "AgreedPlayingTimeComponentInfo", Current: "AgreedPlayingTime", Choices: "PossibleValues"),
        new("agreed-playing-time-lock", Owner: "AgreedPlayingTimeComponentInfo", Current: "AgreedPlayingTimeLockStatus", Choices: "PossibleLockStatuses", Lock: true),
        new("start-date", Owner: "StartDateComponentInfo", Current: "StartDate", Choices: "PossibleValues"),
        new("start-date-lock", Owner: "StartDateComponentInfo", Current: "StartDateLockStatus", Choices: "PossibleLockStatuses", Lock: true),
        new("overall-lock", Current: "OverallOfferLockStatus", Choices: "PossibleOverallOfferLockStatuses"),
        new("add-promise", Choices: "PossiblePlayingTimesAndPromises", Event: 1415082856),
        new("promise-linked-value", "PromisesList", Current: "PromiseLinkedValue", Choices: "PromisePossibleLinkedValues", Permission: "PromiseRequiresLinkedValue"),
        new("promise-lock", "PromisesList", Current: "PromiseLockStatus", Choices: "PossibleLockStatuses", Lock: true),
        new("remove-promise", "PromisesList", Permission: "PromiseCanBeRemoved", Event: 48),
        new("future-playing-time", "FuturePlayingTimesList", Current: "FuturePlayingTimeValue", Choices: "FuturePlayingTimePossibleValues"),
        new("future-playing-time-lock", "FuturePlayingTimesList", Current: "FuturePlayingTimeLockStatus", Choices: "PossibleLockStatuses", Lock: true),
        new("future-target-type", "FuturePlayingTimesList", Current: "FuturePlayingTimeTargetType", Choices: "FuturePlayingTimePossibleTargetTypes", Permission: "FuturePlayingTimeCanSetTarget"),
        new("future-target-choice", "FuturePlayingTimesList", Owner: "FuturePlayingTimePossibleTargetValues", Current: "FuturePlayingTimeTargetValue", Choices: "Items", Permission: "FuturePlayingTimeCanSetTarget"),
        new("remove-future-playing-time", "FuturePlayingTimesList", Permission: "FuturePlayingTimeCanBeRemoved", Event: 48),
        new("clear-future-target", "FuturePlayingTimesList", Permission: "FuturePlayingTimeHasTargetSet", Event: 115),
        new("future-target-value", "FuturePlayingTimesList", Current: "FuturePlayingTimeTargetValue",
            Permission: "FuturePlayingTimeCanSetTarget", Numeric: true),
        new("reset", Event: 91)
    };
    public static object Routing() => new { ok = true, recipes = Recipes, liveVerified = false,
        scope = "precontract_promise_draft", targetDropdownImplemented = true, targetNumericInputImplemented = true,
        numericInputScope = "future_playing_time_target_value_draft_only",
        numericInputNote = "UI 该值由 SIStepIntButton/SIStepFloatButton 写入同一 FuturePlayingTimeTargetValue 绑定；本命令直接对该绑定做原值复制+数值替换的渠道更新，未逐个触发步进按钮事件，接受/取整/夹取仍待真机。" };
    internal static InteropReference Target(string session, string club)
    {
        var human = LiveTools.GetReference("human");
        var actor = NegotiationActions.Channel(club, "human", "Club");
        if (actor.Identity != human.GetPersistentIdentity()) throw new ArgumentException("Use the current manager's actual club.");
        var source = LiveTools.GetSnapshot(session);
        var target = LiveTools.GetReference(session);
        if (!source.Ready || source.Property != InternalCommands.PropertyId("PreContractPromisesEditSession") ||
            target.GetIl2CppType().FullName != "FM.UI.PreContractPromisesEditSessionReference" ||
            LiveTools.GetReference(source.Source, source.SourcePath).GetIl2CppType().FullName != "FM.UI.PersonReference")
            throw new ArgumentException("Resolve the actual person's pre-contract promise session.");
        ContractCommands.Context(source, 0x50625059, human.GetPersistentIdentity());
        ContractCommands.Context(source, 0x43627963, LiveTools.GetReference(club).GetPersistentIdentity());
        return target;
    }
    private static void Flag(TypedValue value, bool expected, string message)
    { if (!bool.TryParse(value?.AsString(), out var actual) || actual != expected) throw new InvalidOperationException(message); }
    private sealed record Prepared(InteropReference Root, InteropReference Target, TypedValue Payload, string Current,
        string Before, string Requested, string Token, string Scope, uint Event, bool Numeric);
    private static Prepared Prepare(string action, string session, string club, string readOnly, string willing,
        string collection, string componentPath, string owner, string baseInfo, string permission, string current, string options, string optionPath, string number)
    {
        var recipe = Recipes.SingleOrDefault(r => r.Action == action) ?? throw new ArgumentException("Unknown pre-contract promise operation.");
        var root = Target(session, club);
        Flag(NegotiationActions.Channel(readOnly, session, "NegotiationReadOnly").Value, false, "Promise negotiation is read-only.");
        Flag(NegotiationActions.Channel(willing, session, "IsWillingToEnterNegotiations").Value, true, "The person is unwilling to negotiate promises.");
        var target = root;
        var targetSource = session; var targetPath = ""; var ownerSource = session;
        if (recipe.Collection != "")
        {
            NegotiationActions.Channel(collection, session, recipe.Collection);
            target = LiveTools.GetReference(collection, componentPath);
            var expected = recipe.Collection == "PromisesList" ? "FM.UI.PreContractPromisesEditSessionPromiseReference" : "FM.UI.PreContractPromisesEditSessionFuturePlayingTimeReference";
            if (target.GetIl2CppType().FullName != expected) throw new ArgumentException("Choose an original component from the actual promise draft list.");
            targetSource = collection; targetPath = componentPath; ownerSource = collection;
        }
        if (recipe.Owner != "")
        { NegotiationActions.Channel(owner, targetSource, recipe.Owner, targetPath); ownerSource = owner; }
        if (recipe.Permission != "")
            Flag(NegotiationActions.Channel(permission, targetSource, recipe.Permission, targetPath).Value, true, "Game does not permit this promise operation.");
        if (recipe.Lock)
        {
            var data = NegotiationActions.Channel(baseInfo, recipe.Owner != "" ? owner : targetSource, "BaseComponentData", recipe.Owner != "" ? "" : targetPath);
            Flag(NegotiationActions.Field(NegotiationActions.Record(data.Value), "DisableLock"), false, "Game disabled this promise lock.");
            ownerSource = baseInfo;
        }
        TypedValue payload = null; string before = null, requested = null;
        if (recipe.Numeric)
        {
            if (string.IsNullOrWhiteSpace(number)) throw new ArgumentException("Numeric future target input requires a decimal string in the native value units.");
            var currentValue = NegotiationActions.Channel(current, targetSource, recipe.Current, targetPath).Value;
            var currentRecord = NegotiationActions.Record(currentValue) ?? throw new ArgumentException("Future target value is not a native record.");
            var propertyValue = NegotiationActions.Field(currentRecord, "PropertyValue");
            var typeName = propertyValue?.DataType?.FullName ?? "";
            TypedValue numeric;
            string canonical;
            if (typeName == "System.Int32")
            {
                if (!int.TryParse(number, NumberStyles.Integer, CultureInfo.InvariantCulture, out var intValue)) throw new ArgumentException("Future target value is an integer input; use a base-10 integer string.");
                numeric = TypedValue.Create(intValue); canonical = intValue.ToString(CultureInfo.InvariantCulture);
            }
            else if (typeName == "System.Int64")
            {
                if (!long.TryParse(number, NumberStyles.Integer, CultureInfo.InvariantCulture, out var longValue)) throw new ArgumentException("Future target value is a 64-bit integer input; use a base-10 integer string.");
                numeric = TypedValue.Create(longValue); canonical = longValue.ToString(CultureInfo.InvariantCulture);
            }
            else if (typeName == "System.Single")
            {
                if (!float.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var floatValue)) throw new ArgumentException("Future target value is a float input; use an invariant decimal string.");
                numeric = TypedValue.Create(floatValue); canonical = floatValue.ToString("R", CultureInfo.InvariantCulture);
            }
            else if (typeName == "System.Double")
            {
                if (!double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var doubleValue)) throw new ArgumentException("Future target value is a double input; use an invariant decimal string.");
                numeric = TypedValue.Create(doubleValue); canonical = doubleValue.ToString("R", CultureInfo.InvariantCulture);
            }
            else
            {
                throw new ArgumentException("Future target value is not a native integer or float input: " + typeName);
            }
            var propertyId = InternalCommands.PropertyId("PropertyValue");
            var payloadRecord = new SI.Core.Record();
            foreach (var pair in currentRecord) payloadRecord[pair.Key] = TypedValue.CreateCopyFrom(pair.Value);
            payloadRecord[propertyId] = numeric;
            payload = GameTools.MakeObjectTypedValue(payloadRecord);
            before = NativeValueFingerprint.Compute(propertyValue);
            requested = canonical;
        }
        if (recipe.Choices != "")
        {
            var choicePath = recipe.Collection != "" && recipe.Owner == "" && !recipe.Lock ? targetPath : "";
            NegotiationActions.Channel(options, ownerSource, recipe.Choices, choicePath);
            payload = TypedValue.CreateCopyFrom(NativeChoiceTree.Leaf(options, optionPath));
            requested = NativeValueFingerprint.Compute(NegotiationActions.Field(NegotiationActions.Record(payload), "PropertyValue"));
        }
        if (recipe.Current != "")
        {
            var actual = NegotiationActions.Channel(current, targetSource, recipe.Current, targetPath).Value;
            before = NativeValueFingerprint.Compute(NegotiationActions.Field(NegotiationActions.Record(actual), "PropertyValue"));
        }
        var scope = "precontract_promise_draft." + action + "." + target.GetPersistentIdentity();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), club = LiveTools.GetReference(club).GetPersistentIdentity(),
            root = root.GetPersistentIdentity(), target = target.GetPersistentIdentity(), action,
            revision = NegotiationActions.Revision(root.GetPersistentIdentity()), before, requested,
            payload = NativeValueFingerprint.Compute(payload),
            choices = string.IsNullOrEmpty(options) ? null : NativeValueFingerprint.Compute(LiveTools.GetSnapshot(options).Value),
            collection = string.IsNullOrEmpty(collection) ? null : NativeValueFingerprint.Compute(LiveTools.GetSnapshot(collection).Value) }));
        return new(root, target, payload, current, before, requested, token, scope, recipe.Event, recipe.Numeric);
    }
    public static object Read(string action, string session, string club, string collection, string componentPath, string current, string operationId)
    {
        var recipe = Recipes.SingleOrDefault(r => r.Action == action) ?? throw new ArgumentException("Unknown pre-contract operation.");
        if (recipe.Current == "") throw new ArgumentException("This operation requires independent list/action-state observation, not a scalar draft check.");
        var root = Target(session, club); var source = session; var path = ""; var target = root;
        if (recipe.Collection != "")
        {
            NegotiationActions.Channel(collection, session, recipe.Collection);
            target = LiveTools.GetReference(collection, componentPath);
            var expected = recipe.Collection == "PromisesList" ? "FM.UI.PreContractPromisesEditSessionPromiseReference" : "FM.UI.PreContractPromisesEditSessionFuturePlayingTimeReference";
            if (target.GetIl2CppType().FullName != expected) throw new ArgumentException("Use the actual promise component.");
            source = collection; path = componentPath;
        }
        var value = NegotiationActions.Channel(current, source, recipe.Current, path).Value;
        var fingerprint = NativeValueFingerprint.Compute(NegotiationActions.Field(NegotiationActions.Record(value), "PropertyValue"));
        var scope = "precontract_promise_draft." + action + "." + target.GetPersistentIdentity();
        return new { ok = true, current = LiveTools.DescribeValue(value), draftOnly = true, liveVerified = false,
            operation = string.IsNullOrEmpty(operationId) ? null : ActionCommands.ObserveDomain(operationId, root.GetPersistentIdentity(), scope, fingerprint) };
    }
    public static object Preview(string action, string session, string club, string readOnly, string willing, string collection,
        string componentPath, string owner, string baseInfo, string permission, string current, string options, string optionPath, string number)
    {
        var p = Prepare(action, session, club, readOnly, willing, collection, componentPath, owner, baseInfo, permission, current, options, optionPath, number);
        return new { ok = true, choiceToken = p.Token, before = p.Before, requested = p.Requested, verificationScope = p.Scope,
            nativeEvent = p.Event, draftOnly = true, numericInput = p.Numeric, numericUnit = p.Numeric ? "native_future_target_value_units" : null,
            payload = p.Payload == null ? null : LiveTools.DescribeValue(p.Payload), liveVerified = false };
    }
    public static object Execute(string id, string action, string session, string club, string readOnly, string willing, string collection,
        string componentPath, string owner, string baseInfo, string permission, string current, string options, string optionPath, string number, string token)
    {
        var p = Prepare(action, session, club, readOnly, willing, collection, componentPath, owner, baseInfo, permission, current, options, optionPath, number);
        if (token != p.Token) throw new InvalidOperationException("Promise draft, options or actor changed; preview again.");
        LiveTools.RequireUnusedDraft(p.Root);
        return ActionCommands.DispatchDomain(id, "precontract_" + action, p.Root.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Root.GetPersistentIdentity());
            if (p.Event != 0) SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
            else LiveTools.UpdateProperty(p.Current, p.Payload);
        }, p.Before, p.Event == 0 ? p.Requested : null, p.Scope);
    }
}
