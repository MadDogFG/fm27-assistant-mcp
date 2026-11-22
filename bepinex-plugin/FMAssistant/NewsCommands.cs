using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Current-build evidence: NEWS_ITEM_UI_HANDLER::playerEvent(27) consumes the two
// original response fields and forwards to the server business handler. Do not call
// NewsResponseActionEvent/SpeakToActionEvent: their managed handlers also navigate UI.
public static class NewsCommands
{
    private const string ReadScope = "observed_news_read_flag";
    // Installed speakto-messages-navigator-button/rid1013 first sends native75,
    // target newsitem, data const.True. Opening its card is a separate later frame.
    private static (InteropReference Target, bool IsRead, string Token, string UnreadToken) ReadPreparation(string inbox, string path, string team, string readFlag, string expectedNewsIdentity)
    {
        var target = Target(inbox, path);
        var identity = target.GetPersistentIdentity();
        if (string.IsNullOrEmpty(expectedNewsIdentity) || identity != expectedNewsIdentity)
            throw new InvalidOperationException("Expected news identity is required and must still match the complete inbox row.");
        var list = LiveTools.GetSnapshot(inbox);
        if (list.Property != InternalCommands.PropertyId("HumanPortalFilteredMessages"))
            throw new ArgumentException("Read-state commands require the complete inbox, never an unread-only list.");
        var human = LiveTools.GetReference("human").GetPersistentIdentity();
        var teamChannel = Channel(team, "human", "Team");
        if (teamChannel.Identity != human) throw new ArgumentException("Use the active manager's actual team.");
        var teamIdentity = LiveTools.GetReference(team).GetPersistentIdentity();
        void Contexts(LiveTools.Snapshot snapshot)
        {
            foreach (var context in snapshot.ContextDescriptions)
            {
                using var data = JsonDocument.Parse(context.Value);
                var value = data.RootElement;
                var key = context.Key;
                if (key == "human" || key == "Human" || key == "team" || key == "Team")
                {
                    var expected = key == "human" || key == "Human" ? human : teamIdentity;
                    if (!value.TryGetProperty("identity", out var actual) || actual.GetString() != expected)
                        throw new ArgumentException("News subscription belongs to another manager/team context.");
                }
                else if (key == "StringType" || key == "PortalMessagesTab")
                {
                    if (!snapshot.Contexts.TryGetValue(key, out var scalar) || scalar != (key == "StringType" ? "" : "0"))
                        throw new ArgumentException("Use the original complete, unfiltered inbox contexts.");
                }
                else throw new ArgumentException("Unsupported news read-state context: " + key);
            }
        }
        Contexts(teamChannel);
        Contexts(list);
        var state = NewsChannel(readFlag, inbox, path, "NewsItemHasBeenRead");
        Contexts(state);
        if (state.Value?.DataType?.FullName != "System.Boolean" || !bool.TryParse(state.Value.AsString(), out var isRead))
            throw new InvalidOperationException("The game's news read flag is not an actual boolean.");
        // Bookend the subscriptions with the original identity. List reordering must
        // fail instead of allowing a fresh channel to describe a different message.
        if (Target(inbox, path).GetPersistentIdentity() != identity)
            throw new InvalidOperationException("Inbox changed while reading this message; refresh the full inbox.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId,
            epoch = LiveTools.CurrentEpoch, human, teamIdentity, identity, path, isRead, requestedRead = true,
            list = NativeValueFingerprint.Compute(list.Value), revision = Revision(identity) }));
        var unreadToken = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId,
            epoch = LiveTools.CurrentEpoch, human, teamIdentity, identity, path, isRead, requestedRead = false,
            list = NativeValueFingerprint.Compute(list.Value), revision = Revision(identity) }));
        return (target, isRead, token, unreadToken);
    }
    public static object ReadFlag(string inbox, string path, string team, string readFlag, string expectedNewsIdentity, string operationId)
    {
        var p = ReadPreparation(inbox, path, team, readFlag, expectedNewsIdentity);
        var identity = p.Target.GetPersistentIdentity();
        return new { ok = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            targetIdentity = identity, isRead = p.IsRead, requestedRead = true, canMarkRead = !p.IsRead,
            canMarkUnread = p.IsRead, choiceToken = p.Token, unreadChoiceToken = p.UnreadToken,
            eventId = 75, unreadEventId = 138, verificationScope = ReadScope, commandCausalityVerified = false,
            receipt = string.IsNullOrEmpty(operationId) ? null : ActionCommands.ObserveDomain(operationId, identity, ReadScope, p.IsRead.ToString()) };
    }
    public static object SetRead(string id, string inbox, string path, string team, string readFlag, string expectedNewsIdentity, string token, bool isRead)
    {
        if (!isRead) throw new ArgumentException("使用 set-unread-state 将消息标为未读。");
        var p = ReadPreparation(inbox, path, team, readFlag, expectedNewsIdentity);
        if (p.Token != token) throw new InvalidOperationException("Message, inbox, read flag or manager changed since preview.");
        if (p.IsRead) throw new InvalidOperationException("The message is already read; no event was sent.");
        return ActionCommands.DispatchDomain(id, "mark_human_message_read", p.Target.GetPersistentIdentity(), token, () => {
            Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(75, p.Target, TypedValue.Create(true));
        }, p.IsRead.ToString(), true.ToString(), ReadScope);
    }
    // Native event 138 EventFmxMarkPortalMessageAsUnread mirrors 75 with the opposite flag.
    public static object SetUnread(string id, string inbox, string path, string team, string readFlag, string expectedNewsIdentity, string token)
    {
        var p = ReadPreparation(inbox, path, team, readFlag, expectedNewsIdentity);
        if (p.UnreadToken != token) throw new InvalidOperationException("Message, inbox, read flag or manager changed since preview.");
        if (!p.IsRead) throw new InvalidOperationException("The message is already unread; no event was sent.");
        return ActionCommands.DispatchDomain(id, "mark_human_message_unread", p.Target.GetPersistentIdentity(), token, () => {
            Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(138, p.Target, TypedValue.Create(false));
        }, p.IsRead.ToString(), false.ToString(), ReadScope);
    }
    private static readonly HashSet<string> Buckets = new() { "RequiredActions", "OptionalActions", "AdviceActions", "ExitActions" };
    private static InteropReference Target(string inbox, string path)
    {
        var list = LiveTools.GetSnapshot(inbox);
        if (!list.Ready || list.Source != "human" || !string.IsNullOrEmpty(list.SourcePath) ||
            list.Identity != LiveTools.GetReference("human").GetPersistentIdentity() ||
            (list.Property != InternalCommands.PropertyId("HumanPortalUnreadMessages") && list.Property != InternalCommands.PropertyId("HumanPortalFilteredMessages")))
            throw new ArgumentException("Use a current inbox subscription belonging to the active human manager.");
        if (!int.TryParse(path, NumberStyles.None, CultureInfo.InvariantCulture, out var index) || index < 0 || path != index.ToString(CultureInfo.InvariantCulture))
            throw new ArgumentException("Select a concrete inbox message by its current list index.");
        var target = LiveTools.GetReference(inbox, path);
        if (target.GetIl2CppType().FullName != "FM.UI.NewsItemReference") throw new ArgumentException("Inbox row is not an actual news item reference.");
        return target;
    }
    private static bool State(string handle, string inbox, string path, string property)
    {
        var value = NewsChannel(handle, inbox, path, property).Value;
        return bool.TryParse(value?.AsString(), out var flag) ? flag : throw new InvalidOperationException("News state is not ready: " + property);
    }
    private static LiveTools.Snapshot NewsChannel(string handle, string inbox, string path, string property)
    {
        var snapshot = Channel(handle, inbox, property, path);
        if (snapshot.Identity != Target(inbox, path).GetPersistentIdentity())
            throw new InvalidOperationException("Inbox reordered after this message subscription was opened. Refresh the message.");
        return snapshot;
    }
    private static (InteropReference Target, Il2CppSystem.Collections.Generic.List<TypedValue> Rows) Offered(
        string inbox, string path, string speakto, string actions, string primary, string groups, string options, string bucket)
    {
        var target = Target(inbox, path);
        NewsChannel(speakto, inbox, path, "SpeakTo");
        if (LiveTools.GetReference(speakto).GetIl2CppType().FullName != "FM.UI.SpeakToReference") throw new ArgumentException("Expected the news item's actual SpeakTo reference.");
        Channel(actions, speakto, "Actions");
        Channel(primary, actions, "PrimaryNpcWithActions");
        Channel(groups, primary, "Actions");
        if (!Buckets.Contains(bucket)) throw new ArgumentException("Unknown news action bucket.");
        var list = Channel(options, groups, bucket).Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
            ?? throw new InvalidOperationException("Game has not provided a news response list.");
        return (target, list);
    }
    private static (SI.Core.Record Payload, string Token, string Label, bool Confirmation) Prepare(
        string inbox, string path, string canRespond, string hasResponded, string speakto, string actions, string primary, string groups, string options, string bucket, int index)
    {
        var offered = Offered(inbox, path, speakto, actions, primary, groups, options, bucket);
        if (!State(canRespond, inbox, path, "CanRespond")) throw new InvalidOperationException("Game does not currently permit responding to this message.");
        var responded = State(hasResponded, inbox, path, "NewsHasResponded");
        if (index < 0 || index >= offered.Rows.Count) throw new ArgumentException("Choose an existing news response.");
        var row = Record(offered.Rows[index]) ?? throw new ArgumentException("News response is not a record.");
        if (Flag(row, "IsDisabled")) throw new InvalidOperationException("Game disabled this response.");
        if (!Flag(row, "IsSimpleButton") || Flag(row, "IsPopupButton") || Flag(row, "IsExitButton", false) ||
            Flag(row, "IsContinueMatchFlowButton", false) || Flag(row, "IsOpenPanelAction", false))
            throw new InvalidOperationException("This response needs a separate popup, navigation or match workflow.");
        foreach (var name in new[] { "NewsAction", "DynamicCardId" })
        {
            var extra = Field(row, name, false);
            if (extra != null && !extra.IsNull && (!int.TryParse(extra.AsString(), out var id) || id >= 0))
                throw new InvalidOperationException("Response requires an additional news/card workflow.");
        }
        if (Field(row, "Event").AsString() != "27") throw new InvalidOperationException("This news event's silent business protocol has not been recovered yet.");
        var responseId = Field(row, "ActionResponseId");
        var responseValue = Field(row, "ActionResponseValue");
        if (!int.TryParse(responseId.AsString(), out var rid) || rid < 0 || !int.TryParse(responseValue.AsString(), out var response) || response < 0)
            throw new InvalidOperationException("This action has no concrete native response ID/value.");
        var payload = new SI.Core.Record();
        payload[0x7a637056] = TypedValue.CreateCopyFrom(responseId);
        payload[0x73663370] = TypedValue.CreateCopyFrom(responseValue);
        var confirmation = Field(row, "ConfirmationDialogData", false);
        var ok = Field(row, "OKDialogData", false);
        var requiresConfirmation = confirmation != null && !confirmation.IsNull || ok != null && !ok.IsNull;
        var identity = offered.Target.GetPersistentIdentity();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), identity, responded, bucket, index, revision = Revision(identity),
            action = NativeValueFingerprint.Compute(offered.Rows[index]) }));
        return (payload, token, Field(row, "ActionTitle").AsString(), requiresConfirmation);
    }
    public static object OpenPressConference(string id, string expectedNewsIdentity, string inbox, string path,
        string speakto, string actions, string primary, string groups, string options)
    {
        const int pressConferenceInviteAction = 15;
        var (target, rows) = Offered(inbox, path, speakto, actions, primary, groups, options, "RequiredActions");
        var identity = target.GetPersistentIdentity();
        if (identity != expectedNewsIdentity)
            throw new InvalidOperationException("The original press conference invitation changed.");

        Il2CppSystem.Collections.Generic.List<TypedValue> references = null;
        for (var index = 0; index < rows.Count; index++)
        {
            var row = Record(rows[index]);
            if (row == null || !int.TryParse(row[0x37755247]?.AsString(), out var actionId) ||
                actionId != pressConferenceInviteAction || row[0x6b746a77]?.AsString() != "3")
                continue;
            if (references != null || Flag(row, "IsDisabled"))
                throw new InvalidOperationException("FM must offer exactly one enabled press conference invitation.");
            references = row[0x53554171]?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (references == null)
                throw new InvalidOperationException("Missing original press conference navigation parameter.");
        }
        uint? conferenceId = null;
        if (references != null)
        {
            for (var index = 0; index < references.Count; index++)
            {
                var reference = Record(references[index]);
                if (reference == null || reference[0x6b456435]?.AsString() != "0" ||
                    !uint.TryParse(reference[0x304a4a34]?.AsString(), out var candidate))
                    continue;
                if (conferenceId.HasValue)
                    throw new InvalidOperationException("FM supplied multiple press conference identity candidates.");
                conferenceId = candidate;
            }
        }
        if (!conferenceId.HasValue)
            throw new InvalidOperationException("FM supplied no unambiguous press conference identity.");
        if (Array.IndexOf(identity.Split(','), "1970170212:" + conferenceId.Value.ToString(CultureInfo.InvariantCulture)) < 0)
            throw new InvalidOperationException("The navigation target does not match the original conference invitation.");

        return ActionCommands.DispatchDomain(id, "open_press_conference", identity, conferenceId.Value.ToString(CultureInfo.InvariantCulture),
            () => GameSubsystems.Get<EventSubsystem>().SendEvent(new FM.UI.OpenNewsActionPanelEvent
            {
                ActionId = pressConferenceInviteAction,
                DynamicCardId = -1,
                PortalSourceId = -1,
                ActionDataReferences = references
            }), null, null, "press_conference_panel_dispatch");
    }
    public static object Describe(string inbox, string path, string canRespond, string hasResponded, string speakto, string actions, string primary, string groups, string options, string bucket, string title)
    {
        var offered = Offered(inbox, path, speakto, actions, primary, groups, options, bucket);
        var rows = new List<object>();
        for (var index = 0; index < offered.Rows.Count; index++)
        {
            var row = Record(offered.Rows[index]);
            try
            {
                var prepared = Prepare(inbox, path, canRespond, hasResponded, speakto, actions, primary, groups, options, bucket, index);
                rows.Add(new { index, label = prepared.Label, choiceToken = prepared.Token, silentExecutionImplemented = true,
                    requiresConfirmation = prepared.Confirmation });
            }
            catch (Exception)
            {
                if (row?[0x37755247]?.AsString() == "15" && row[0x6b746a77]?.AsString() == "3")
                    rows.Add(new { index, label = "出席新闻发布会", silentExecutionImplemented = false,
                        reason = "Use open_press_conference_for_player.", handoffTool = "open_press_conference_for_player" });
            }
        }
        return new { ok = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, targetIdentity = offered.Target.GetPersistentIdentity(), bucket,
            title = NewsChannel(title, inbox, path, "NewsTitleString").Value?.AsString(),
            canRespond = State(canRespond, inbox, path, "CanRespond"), hasResponded = State(hasResponded, inbox, path, "NewsHasResponded"), actions = rows, liveVerified = false };
    }
    public static object Execute(string id, string inbox, string path, string canRespond, string hasResponded, string speakto, string actions, string primary, string groups, string options, string bucket, int index, string token, bool acceptConfirmation)
    {
        var prepared = Prepare(inbox, path, canRespond, hasResponded, speakto, actions, primary, groups, options, bucket, index);
        if (prepared.Token != token) throw new InvalidOperationException("Message, response or manager changed since preview. Read current choices again.");
        if (prepared.Confirmation && !acceptConfirmation) throw new InvalidOperationException("Read the game's confirmation metadata and explicitly choose acceptConfirmation.");
        var target = Target(inbox, path);
        // A live NewsItem is shared by Portal bindings; allow native response dispatch.
        // LiveTools.RequireNoExternalSpeakTo();
        return ActionCommands.DispatchDomain(id, "news_response", target.GetPersistentIdentity(), LiveTools.JsonText(new { token, acceptConfirmation }), () => {
            Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(27, target, GameTools.MakeObjectTypedValue(prepared.Payload));
        }, null, null, "news_response_dispatch");
    }
    public static object Read(string inbox, string path, string canRespond, string hasResponded)
    {
        var target = Target(inbox, path);
        return new { ok = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, targetIdentity = target.GetPersistentIdentity(),
            canRespond = State(canRespond, inbox, path, "CanRespond"), hasResponded = State(hasResponded, inbox, path, "NewsHasResponded"),
            verificationScope = "observed_news_response_state", commandCausalityVerified = false };
    }
}
