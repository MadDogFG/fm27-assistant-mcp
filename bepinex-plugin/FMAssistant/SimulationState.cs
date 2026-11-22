using System;
using System.Globalization;

namespace FMAssistant;

// Uses the shipped SI.Match plugin interface's read-only methods. Never calls
// Setup/Tick/Seek/Shutdown or alters the playback state to obtain observations.
public static class SimulationState
{
    public static object Read()
    {
        try
        {
            RuntimeCapabilities.RequireKnownProtocol(RuntimeCapabilities.MatchFlowObservation);
            var controller = MatchCommands.ManagerController(false);
            var identity = controller.MatchReference.GetPersistentIdentity();
            var session = LiveTools.SessionId; var epoch = LiveTools.CurrentEpoch;
            var api = controller.MatchInterface;
            var handle = controller.MatchHandle;
            if (api == null || !handle.IsValid() || !api.IsHandleValid(handle))
                return new { ok = true, ready = false, reason = "current_native_match_handle_not_ready", matchIdentity = identity, sessionId = session, epoch };
            var ids = api.GetMatchUniqueIds(handle);
            var period = api.GetSimulationPeriod(handle);
            if ((int)period < 0 || (int)period > 9)
                return new { ok = true, ready = false, reason = "native_simulation_period_unavailable", rawPeriod = (int)period };
            var current = MatchCommands.ManagerController(false);
            if (current.Pointer != controller.Pointer || !current.MatchHandle.Equals(handle) || current.MatchReference.GetPersistentIdentity() != identity ||
                LiveTools.SessionId != session || LiveTools.CurrentEpoch != epoch || !api.IsHandleValid(handle) || api.GetMatchUniqueIds(handle).matchUniqueId != ids.matchUniqueId)
                throw new InvalidOperationException("Current native match changed during observation.");
            return new { ok = true, ready = true, sessionId = session, epoch, matchIdentity = identity,
                matchUniqueId = ids.matchUniqueId.ToString(CultureInfo.InvariantCulture), handle = handle.m_handle.ToString(CultureInfo.InvariantCulture),
                isHomeTeam = MatchCommands.ManagerTeam(current) == FM.Match.FixtureTeam.Home,
                simulationPeriod = period.ToString(), simulationPeriodId = (int)period,
                source = "SI.Match.IPluginMatchInterface.GetSimulationPeriod", observedUtc = DateTime.UtcNow.ToString("O"),
                verificationScope = "observed_current_native_simulation_period", commandCausalityVerified = false, liveVerified = false };
        }
        catch (Exception error) { return new { ok = true, ready = false, reason = error.GetBaseException().Message,
            sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, liveVerified = false }; }
    }
}
