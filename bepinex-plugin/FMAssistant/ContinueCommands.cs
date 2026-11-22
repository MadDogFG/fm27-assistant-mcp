using System;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using FM.GamePlugin;
using FM.UI;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using SI.Core;

namespace FMAssistant;

public static class ContinueCommands
{
    public static object Lookup(string id)
    {
        var found = ActionCommands.Contains(id);
        var receipt = found ? (DispatchJournal.Receipt)ActionCommands.Status(id) : null;
        return new { ok = true, found = found || CommandOperations.Contains(id) || TacticCommands.Contains(id) || SubstitutionCommands.ContainsRoot(id),
            belongsToContinuation = receipt?.command == ContinueRequestGuard.Command, receipt };
    }
    internal sealed record State(string GameIdentity, string HumanIdentity, bool Waiting, string DateFingerprint,
        long Flags, int FlowState, int HumanStatusAction, string CurrentActionFingerprint, string DeferredActionFingerprint,
        string ModuleIdentity, bool ProcessingTimer, bool InstantResult, bool DemoEnded, bool Deferred,
        string MatchPhaseFingerprint, bool CanDispatch, string Reason, string ChoiceToken);
    private static object Field(ContinueManagerModule module, string name)
    {
        const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        var property = typeof(ContinueManagerModule).GetProperty(name, flags);
        // Build26620374 renamed the deferred-task fields. Either generation remains
        // a conservative blocker while the task is pending; no flag is changed here.
        if (property == null && name == "m_shouldActWhenActive") property = typeof(ContinueManagerModule).GetProperty("m_hasDeferredTaskAction", flags);
        if (property == null && name == "m_actionToCallWhenActive") property = typeof(ContinueManagerModule).GetProperty("m_deferredTaskAction", flags);
        return (property ?? throw new InvalidOperationException("Continue module field unavailable: " + name)).GetValue(module);
    }
    private static bool Boolean(ContinueManagerModule module, string name) => Field(module, name) is bool value
        ? value : throw new InvalidOperationException("Continue module field is not a boolean: " + name);
    private static string Payload(object value) => value == null ? "null" : value is Il2CppObjectBase native
        ? NativeValueFingerprint.Compute(GameTools.MakeObjectTypedValue(native))
        : throw new InvalidOperationException("Continue action is not a native value.");
    private static bool IsFixturesTask(object action)
    {
        if (action is not SI.Core.Record record || !record.TryGetValue(0x37755247u, out var id) || id?.AsString() != "122" ||
            !record.TryGetValue(0x53554171u, out var parameters) ||
            parameters?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() is not { Count: 2 } list)
            return false;
        var competition = NegotiationActions.Record(list[0]);
        var mode = NegotiationActions.Record(list[1]);
        return competition != null && competition.TryGetValue(0x6b456435u, out var competitionKind) && competitionKind?.AsString() == "0" &&
            competition.TryGetValue(0x304a4a34u, out var reference) && reference?.DataType?.FullName == "FM.UI.CompReference" &&
            mode != null && mode.TryGetValue(0x6b456435u, out var modeKind) && modeKind?.AsString() == "1" &&
            mode.TryGetValue(0x304a4a34u, out var modeValue) && modeValue?.AsString() == "1";
    }
    private static LiveTools.Snapshot Channel(string handle, string property, string identity)
    {
        var channel = LiveTools.GetSnapshot(handle);
        if (!channel.Ready || channel.Source != "game" || !string.IsNullOrEmpty(channel.SourcePath) ||
            channel.Identity != identity || channel.Property != InternalCommands.PropertyId(property) || channel.Contexts.Count != 0)
            throw new ArgumentException("A ready, original game." + property + " subscription without contexts is required.");
        return channel;
    }
    internal static State Capture(string waiting, string date, bool worldContinuation = true, bool stageManagerKnown = false)
    {
        RuntimeCapabilities.RequireKnownProtocol(RuntimeCapabilities.MatchFlowObservation);
        var game = LiveTools.GetReference("game").GetPersistentIdentity();
        var human = LiveTools.GetReference("human").GetPersistentIdentity();
        var value = Channel(waiting, "GameWaiting", game).Value;
        if (value == null || value.IsNull || value.DataType?.FullName != "System.Boolean" || !bool.TryParse(value.AsString(), out var isWaiting))
            throw new InvalidOperationException("GameWaiting is not an actual boolean.");
        var dateValue = Channel(date, "CurrentGameDate", game).Value;
        if (dateValue == null || dateValue.IsNull || dateValue.DataType?.FullName != "FM.GamePlugin.GameDate")
            throw new InvalidOperationException("CurrentGameDate is not a native game date.");
        var candidates = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<ContinueManagerModule>())
            .Select(obj => obj.TryCast<ContinueManagerModule>()).Where(module => module != null &&
                ContinueRequestGuard.ModuleEligible(Boolean(module, "m_active"), Boolean(module, "m_initialised"),
                    Boolean(module, "m_isInMainGameScene"), Convert.ToInt64(Field(module, "m_gameStateFlags"), CultureInfo.InvariantCulture))).ToArray();
        if (candidates.Length > 1 || (candidates.Length == 0 && !stageManagerKnown))
            throw new InvalidOperationException("Expected exactly one active, initialised in-game continue module.");
        var module = candidates.Length == 1 ? candidates[0] : null;
        var flags = module != null ? Convert.ToInt64(Field(module, "m_gameStateFlags"), CultureInfo.InvariantCulture) : 0L;
        var flowState = module != null ? (int)module.m_continueState.Value : 0;
        var timer = module != null && Field(module, "m_processingCardTimerCoroutine") != null; // +0xb8 is a coroutine, not a dialog.
        var instant = module != null && Boolean(module, "m_isProcessingInstantResult");
        var demo = module != null && Boolean(module, "m_hasDemoEnded");
        var deferred = module != null && Boolean(module, "m_shouldActWhenActive");
        // Only stable phase identity participates; running minute/ticks do not
        // create another continuation intent while a prior request is in flight.
        using var match = System.Text.Json.JsonDocument.Parse(LiveTools.JsonText(MatchCommands.State()));
        var root = match.RootElement;
        var inMatch = root.GetProperty("inMatch").GetBoolean();
        var invalidMatch = inMatch && (root.GetProperty("pastMatch").GetBoolean() || root.GetProperty("replay").GetBoolean() ||
            root.GetProperty("spectating").GetBoolean() || (!stageManagerKnown && root.GetProperty("isHomeTeam").ValueKind == System.Text.Json.JsonValueKind.Null) ||
            !root.GetProperty("phase").GetProperty("ready").GetBoolean());
        if (inMatch && !invalidMatch)
        {
            var scripts = root.GetProperty("phase").GetProperty("scripts").EnumerateArray().ToArray();
            invalidMatch = scripts.Length == 0 || scripts.Any(script => !script.GetProperty("belongsToCurrentMatch").GetBoolean());
        }
        var preparing = inMatch && !invalidMatch && root.GetProperty("phase").GetProperty("periodTransitionPreparing").ValueKind != System.Text.Json.JsonValueKind.False;
        var phase = root.GetProperty("inMatch").GetBoolean() ? LiveTools.JsonText(new {
            match = root.GetProperty("matchIdentity").GetString(),
            phase = root.GetProperty("phase"), finished = root.GetProperty("finished").GetBoolean(),
            team = root.GetProperty("currentManagerTeam").GetString() }) : "no_match";
        // Additional exclusions are conservative preflight gates; engine event13
        // still performs the normal current-manager/request eligibility checks.
        const long excluded = 2 | 4 | 8 | 16 | 256 | 524288;
        var reason = isWaiting ? "already_waiting_do_not_toggle" : invalidMatch ? "current_managed_match_phase_unavailable" :
            preparing ? "match_period_transition_preparing" : timer ? "processing_card_timer_active" :
            instant ? "instant_result_processing" : demo ? "demo_ended" : deferred ? "deferred_continue_action" :
            (flags & excluded) != 0 ? "continue_module_not_ready" : ContinueRequestGuard.FlowReason(flowState, worldContinuation, inMatch);
        var currentAction = module != null ? Field(module, "m_currentAction") : null;
        if (worldContinuation && !inMatch && flowState == 25 && reason == "process_current_continue_workflow" &&
            IsFixturesTask(currentAction))
            reason = null;
        var humanStatusAction = module != null ? Convert.ToInt32(Field(module, "m_currentHumanStatusAction"), CultureInfo.InvariantCulture) : 0;
        var actionWhenActive = module != null ? Payload(Field(module, "m_actionToCallWhenActive")) : null;
        var moduleId = module != null ? module.Pointer.ToInt64().ToString(CultureInfo.InvariantCulture) : "0";
        var state = new State(game, human, isWaiting, NativeValueFingerprint.Compute(dateValue), flags, flowState,
            humanStatusAction,
            Payload(currentAction), actionWhenActive,
            moduleId, timer, instant, demo, deferred,
            DispatchJournal.Fingerprint(phase), reason == null, reason, null);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, state }));
        return state with { ChoiceToken = token };
    }
    internal static (ContinueProgress.Snapshot Snapshot, object Match, object Simulation) Observation(State state)
    {
        var session = LiveTools.SessionId; var epoch = LiveTools.CurrentEpoch;
        var cursor = ContinueCallbackLog.Cursor;
        var matchValue = MatchCommands.State(); var simulationValue = SimulationState.Read();
        using var matchDocument = JsonDocument.Parse(LiveTools.JsonText(matchValue));
        using var simulationDocument = JsonDocument.Parse(LiveTools.JsonText(simulationValue));
        var match = matchDocument.RootElement; var simulation = simulationDocument.RootElement;
        var inMatch = match.GetProperty("inMatch").GetBoolean();
        var phaseReady = inMatch && !match.GetProperty("pastMatch").GetBoolean() && !match.GetProperty("replay").GetBoolean() &&
            !match.GetProperty("spectating").GetBoolean() && match.GetProperty("isHomeTeam").ValueKind != JsonValueKind.Null &&
            match.GetProperty("phase").GetProperty("ready").GetBoolean();
        if (phaseReady)
        {
            var scripts = match.GetProperty("phase").GetProperty("scripts").EnumerateArray().ToArray();
            phaseReady = scripts.Length > 0 && scripts.All(script => script.GetProperty("belongsToCurrentMatch").GetBoolean());
        }
        var identity = inMatch ? match.GetProperty("matchIdentity").GetString() : null;
        var nativeReady = phaseReady && simulation.GetProperty("ready").GetBoolean() &&
            simulation.GetProperty("sessionId").GetString() == session && simulation.GetProperty("epoch").GetInt32() == epoch &&
            simulation.GetProperty("matchIdentity").GetString() == identity &&
            simulation.GetProperty("isHomeTeam").GetBoolean() == match.GetProperty("isHomeTeam").GetBoolean();
        if (session != LiveTools.SessionId || epoch != LiveTools.CurrentEpoch || ContinueCallbackLog.Cursor != cursor ||
            state.GameIdentity != LiveTools.GetReference("game").GetPersistentIdentity() || state.HumanIdentity != LiveTools.GetReference("human").GetPersistentIdentity())
            throw new InvalidOperationException("Continuation source changed while capturing its observation baseline.");
        var snapshot = new ContinueProgress.Snapshot(session, epoch, state.GameIdentity, state.HumanIdentity, state.DateFingerprint, state.Waiting,
            identity, inMatch ? match.GetProperty("controllerIdentity").GetString() : null, inMatch ? match.GetProperty("currentManagerTeam").GetString() : null,
            phaseReady, phaseReady ? match.GetProperty("phase").GetProperty("stateGuid").GetString() : null,
            nativeReady, nativeReady ? simulation.GetProperty("matchUniqueId").GetString() : null, nativeReady ? simulation.GetProperty("handle").GetString() : null,
            nativeReady ? simulation.GetProperty("simulationPeriodId").GetInt32() : null, cursor, ContinueCallbackLog.HooksReady,
            inMatch && match.GetProperty("multiplayer").GetBoolean());
        return (snapshot, matchValue, simulationValue);
    }
    internal static ContinueProgress.Snapshot Baseline(DispatchJournal.Receipt receipt)
    {
        if (string.IsNullOrEmpty(receipt?.observationBaseline)) return null;
        try { return JsonSerializer.Deserialize<ContinueProgress.Snapshot>(receipt.observationBaseline); }
        catch (JsonException) { return null; }
    }
    private static object CurrentManagerTask(State state)
    {
        if (state.FlowState is not (1 or 25 or 32 or 33)) return null;
        var module = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<ContinueManagerModule>())
            .Select(obj => obj.TryCast<ContinueManagerModule>()).Single(candidate => candidate != null &&
                candidate.Pointer.ToInt64().ToString(CultureInfo.InvariantCulture) == state.ModuleIdentity);
        var action = Field(module, "m_currentAction");
        if (Payload(action) != state.CurrentActionFingerprint)
            throw new InvalidOperationException("Current manager task changed while reading; refresh continuation state.");
        return action is Il2CppObjectBase native ? LiveTools.DescribeValue(GameTools.MakeObjectTypedValue(native), 6) : null;
    }
    public static object Read(string waiting, string date, string operationId = "")
    {
        var state = Capture(waiting, date);
        var observation = Observation(state);
        DispatchJournal.Receipt receipt = null;
        ContinueProgress.Report progress = null;
        if (!string.IsNullOrEmpty(operationId))
        {
            var previous = (DispatchJournal.Receipt)ActionCommands.Status(operationId);
            if (previous.command != ContinueRequestGuard.Command) throw new ArgumentException("This ID does not belong to continuation.");
            receipt = (DispatchJournal.Receipt)ActionCommands.ObserveDomain(operationId, state.GameIdentity, ContinueRequestGuard.Scope, state.Waiting.ToString());
            var baseline = Baseline(receipt);
            progress = ContinueProgress.Compare(baseline, observation.Snapshot, ContinueCallbackLog.Read(baseline?.callbackCursor ?? -1));
        }
        return new { ok = true, ready = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            gameIdentity = state.GameIdentity, humanIdentity = state.HumanIdentity, waiting = state.Waiting,
            choiceToken = state.ChoiceToken, canRequest = state.CanDispatch, reason = state.Reason,
            moduleFlags = state.Flags.ToString(CultureInfo.InvariantCulture), continueFlowState = state.FlowState,
            continueFlowName = ((ContinueManagerModule.ContinueFlowState)state.FlowState).ToString(),
            requiresManagerAction = (state.Flags & 1) != 0 || state.FlowState is 1 or 32 or 33, currentHumanStatusAction = state.HumanStatusAction,
            currentActionFingerprint = state.CurrentActionFingerprint, currentDateFingerprint = state.DateFingerprint,
            currentManagerTask = CurrentManagerTask(state),
            mutationCursor = MutationActivity.Cursor, clientMutationGuardReady = MutationActivity.HooksReady,
            receipt, progress, match = observation.Match, simulation = observation.Simulation,
            callbackObserver = new { hooksInstalled = ContinueCallbackLog.HooksReady, cursor = ContinueCallbackLog.Cursor,
                scope = "observed_controller_callback_only_not_exclusive_request_causality" },
            verificationScope = ContinueRequestGuard.Scope, stageAdvanceVerified = false,
            commandCausalityVerified = false, panelEffectsVerified = false, liveVerified = false };
    }
    public static object Execute(string id, string waiting, string date, string gameIdentity, string token, long cursor)
    {
        var fixtures = false;
        return ActionCommands.Continue(id, gameIdentity, token, () => {
            var state = Capture(waiting, date);
            fixtures = state.FlowState == 25;
            if (state.GameIdentity != gameIdentity) throw new InvalidOperationException("Current game identity changed.");
            if (cursor < 0) throw new ArgumentException("The preview mutation cursor is required.");
            var observation = Observation(state);
            MutationActivity.RequireUnchanged(cursor);
            ContinueCallbackLog.Armed = true; // Protocol hash was already checked; no first-use hash work in passive callbacks.
            return new ContinueRequestGuard.Preflight(state.ChoiceToken, state.Waiting, state.CanDispatch, state.Reason, LiveTools.JsonText(observation.Snapshot));
        }, () => {
            if (fixtures) SI.Core.GameSubsystems.Get<EventSubsystem>().SendEvent(new FM.UI.ContinueGameEvent());
            else SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(
                (uint)InteropEventIDs.EventFmxContinueGame, LiveTools.GetReference("game"), null);
        });
    }
}
