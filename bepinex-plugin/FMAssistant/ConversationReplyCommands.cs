using System;
using System.Collections.Generic;
using System.Text.Json;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Meetings render the shared SpeakTo action widgets. Direct scalar event34
// responses remain a distinct, currently unrecovered candidate protocol.
public static class ConversationReplyCommands
{
    private static void Resolve(string source, string path, string session)
    {
        var actor = LiveTools.GetReference(source, path);
        var type = actor.GetIl2CppType().FullName;
        if (type != "FM.UI.PersonReference" && type != "FM.UI.TeamReference")
            throw new ArgumentException("Resolve a conversation from an actual person or team reference.");
        var origin = Channel(session, source, "ConversationEditSession", path);
        if (origin.Identity != actor.GetPersistentIdentity() || LiveTools.GetReference(session).GetIl2CppType().FullName != "FM.UI.ConversationEditSessionReference")
            throw new ArgumentException("Conversation session does not belong to the selected actual person/team.");
    }
    public static object Describe(string source, string path, string session, string speakto, string actions, string primary,
        string groups, string options, string bucket, string flat)
    {
        Resolve(source, path, session);
        var talkOrigin = Channel(speakto, session, "SpeakTo");
        if (talkOrigin.Identity != LiveTools.GetReference(session).GetPersistentIdentity() || LiveTools.GetReference(speakto).GetIl2CppType().FullName != "FM.UI.SpeakToReference")
            throw new ArgumentException("Use the actual conversation's original SpeakTo reference.");
        Channel(actions, speakto, "Actions"); Channel(primary, actions, "PrimaryNpcWithActions");
        Channel(groups, primary, "Actions");
        if (bucket != "RequiredActions" && bucket != "OptionalActions" && bucket != "AdviceActions" && bucket != "ExitActions") throw new ArgumentException("Unknown conversation action bucket.");
        Channel(options, groups, bucket);
        var offered = CommunicationCommands.Describe(session, "", speakto, actions, primary, groups, options, bucket);
        var views = new Dictionary<string, object>();
        if (!string.IsNullOrWhiteSpace(flat))
        {
            var handles = JsonSerializer.Deserialize<Dictionary<string, string>>(flat) ?? throw new ArgumentException("Flat views must be a property/handle map.");
            if (handles.Count > 8) throw new ArgumentException("Too many conversation action views.");
            foreach (var pair in handles)
            {
                if (!pair.Key.StartsWith("ActionsForButtons", StringComparison.Ordinal) && !pair.Key.StartsWith("ActionsForDropdown", StringComparison.Ordinal))
                    throw new ArgumentException("Only the game's actual shared button/dropdown action views are accepted.");
                var value = Channel(pair.Value, actions, pair.Key);
                views[pair.Key] = LiveTools.DescribeValue(value.Value, 7);
            }
        }
        return new { ok = true, conversationIdentity = LiveTools.GetReference(session).GetPersistentIdentity(), bucket,
            offered, flatViews = views, directScalarResponseProtocolImplemented = false,
            note = "Execute only the original primary-NPC bucket action index/token. Flat views are additional native views, not fabricated response candidates.", liveVerified = false };
    }
    public static object Execute(string id, string source, string path, string session, string speakto, string actions, string primary,
        string groups, string options, string bucket, int index, string token, bool acceptConfirmation)
    {
        Resolve(source, path, session);
        return CommunicationCommands.Execute(id, session, "", speakto, actions, primary, groups, options, bucket, index, token, acceptConfirmation);
    }
}
