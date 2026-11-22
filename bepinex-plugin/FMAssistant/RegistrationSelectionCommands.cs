using System;
using System.Linq;
using System.Text.Json;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// PlayerSquadRegistrationSelectionRow uses normal checkbox Selected binding,
// scoped to the original Person inherited by that row.
public static class RegistrationSelectionCommands
{
    private sealed record Prepared(InteropReference Session, string Person, bool Before, bool Allowed, string Token, string ObservationTarget);
    private static Prepared Prepare(string team, string session, string players, string personPath, string current, string editable, bool selected)
    {
        var teamOrigin = NegotiationActions.Channel(team, "human", "Team");
        if (teamOrigin.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the current manager's actual team.");
        var sessionSource = NegotiationActions.Channel(session, team, "SquadRegistration");
        var target = LiveTools.GetReference(session);
        if (target.GetIl2CppType().FullName != "FM.UI.SquadRegistrationEditSession") throw new ArgumentException("Use the actual registration edit session.");
        NegotiationActions.Channel(players, session, "Players");
        var person = LiveTools.GetReference(players, personPath);
        if (person.GetIl2CppType().FullName != "FM.UI.PersonReference") throw new ArgumentException("Choose a real player from this registration's candidates.");
        var identity = person.GetPersistentIdentity();
        bool Flag(string handle, string property)
        {
            var snapshot = NegotiationActions.Channel(handle, session, property);
            if (snapshot.Identity != target.GetPersistentIdentity()) throw new ArgumentException("Registration identity changed.");
            var contexts = snapshot.ContextDescriptions.Where(pair => pair.Key.Equals("person", StringComparison.OrdinalIgnoreCase)).ToArray();
            if (contexts.Length != 1) throw new ArgumentException("Selection channel must have exactly one original person context.");
            using var description = JsonDocument.Parse(contexts[0].Value);
            if (description.RootElement.GetProperty("kind").GetString() != "reference" || description.RootElement.GetProperty("identity").GetString() != identity)
                throw new ArgumentException("Selection channel belongs to another player.");
            if (snapshot.Value?.DataType?.FullName != "System.Boolean" || !bool.TryParse(snapshot.Value.AsString(), out var value))
                throw new InvalidOperationException("Registration selection is not an actual boolean.");
            return value;
        }
        var before = Flag(current, "Selected"); var allowed = Flag(editable, "CanChangeSelection");
        var context = DispatchJournal.Fingerprint(LiveTools.JsonText(new { registration = sessionSource.ContextDescriptions,
            selection = LiveTools.GetSnapshot(current).ContextDescriptions, permission = LiveTools.GetSnapshot(editable).ContextDescriptions }));
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), team = LiveTools.GetReference(team).GetPersistentIdentity(),
            session = target.GetPersistentIdentity(), context, person = identity, before, allowed, selected }));
        return new(target, identity, before, allowed, token, target.GetPersistentIdentity() + "/" + context);
    }
    public static object Preview(string team, string session, string players, string personPath, string current, string editable, bool selected)
    {
        var p = Prepare(team, session, players, personPath, current, editable, selected);
        return new { ok = true, personIdentity = p.Person, selected = p.Before, requested = selected, canChange = p.Allowed,
            choiceToken = p.Token, verificationScope = "registration_player_selection_draft", liveVerified = false };
    }
    public static object Execute(string id, string team, string session, string players, string personPath, string current, string editable, bool selected, string token)
    {
        var p = Prepare(team, session, players, personPath, current, editable, selected);
        if (p.Token != token) throw new InvalidOperationException("Player registration state or permission changed; preview again.");
        if (!p.Allowed && p.Before != selected) throw new InvalidOperationException("The game does not permit changing this player's registration.");
        LiveTools.RequireUnusedDraft(p.Session);
        return ActionCommands.DispatchDomain(id, "registration.player_selection", p.ObservationTarget,
            LiveTools.JsonText(new { person = p.Person, selected, token }), () => LiveTools.UpdateProperty(current, TypedValue.Create(selected)),
            p.Before.ToString(), selected.ToString(), "registration_player_selection_draft." + p.Person);
    }
    public static object Observe(string id, string team, string session, string players, string personPath, string current, string editable)
    {
        var p = Prepare(team, session, players, personPath, current, editable, false);
        return ActionCommands.ObserveDomain(id, p.ObservationTarget, "registration_player_selection_draft." + p.Person, p.Before.ToString());
    }
}
