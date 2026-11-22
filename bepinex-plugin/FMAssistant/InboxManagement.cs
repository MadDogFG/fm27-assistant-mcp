using System;
using System.Globalization;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// PortalMessagesTile-Small rid1081: native99, target human, original team data.
public static class InboxManagement
{
    private static (InteropReference Human, InteropReference Team, string Count, string Token) Prepare(string team, string unread)
    {
        var human = LiveTools.GetReference("human"); var teamRef = LiveTools.GetReference(team);
        if (NegotiationActions.Channel(team, "human", "Team").Identity != human.GetPersistentIdentity()) throw new ArgumentException("Use the manager's original team.");
        var value = NegotiationActions.Channel(unread, "human", "NumberUnreadMessages");
        if (value.Identity != human.GetPersistentIdentity() || !ulong.TryParse(value.Value?.AsString(), NumberStyles.None, CultureInfo.InvariantCulture, out var count))
            throw new InvalidOperationException("Actual unread-message count is unavailable.");
        foreach (var context in value.ContextDescriptions)
        {
            if (!context.Key.Equals("team", StringComparison.OrdinalIgnoreCase)) continue;
            using var description = JsonDocument.Parse(context.Value);
            if (!description.RootElement.TryGetProperty("identity", out var id) || id.GetString() != teamRef.GetPersistentIdentity())
                throw new ArgumentException("Unread count belongs to another team context.");
        }
        var text = count.ToString(CultureInfo.InvariantCulture);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = human.GetPersistentIdentity(), team = teamRef.GetPersistentIdentity(), unread = text }));
        return (human, teamRef, text, token);
    }
    public static object Preview(string team, string unread, string operationId)
    {
        var p = Prepare(team, unread);
        return new { ok = true, unread = p.Count, choiceToken = p.Token, eventId = 99,
            receipt = string.IsNullOrEmpty(operationId) ? null : ActionCommands.ObserveDomain(operationId, p.Human.GetPersistentIdentity(), "observed_unread_message_count", p.Count),
            liveVerified = false };
    }
    public static object Execute(string id, string team, string unread, string token)
    {
        var p = Prepare(team, unread);
        if (p.Token != token) throw new InvalidOperationException("Inbox or manager changed; refresh preview.");
        return ActionCommands.DispatchDomain(id, "mark_all_human_messages_read", p.Human.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxMarkAllHumanMessagesAsRead,
                p.Human, GameTools.MakeObjectTypedValue(p.Team)), p.Count, "0", "observed_unread_message_count");
    }
}
