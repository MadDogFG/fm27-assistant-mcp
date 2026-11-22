using System;
using System.Collections.Generic;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// The shared SpeakToAction business leaf constructs these six fields for the
// event offered by the game. No caller-supplied event ID or payload is accepted.
public static class CommunicationCommands
{
    private const string ConferenceType = "FM.UI.PressConferenceEditSessionReference";
    private static bool IsConferenceHandoff(SI.Core.Record row)
    {
        if (row == null || !uint.TryParse(Field(row, "Event", false)?.AsString(), out var eventId)) return false;
        return eventId == 863384693u || eventId == (uint)InteropEventIDs.EventFmxPressConferenceSendAssistant;
    }

    private sealed record Choice(InteropReference Root, InteropReference SpeakTo, uint Event, SI.Core.Record Payload,
        string Label, string Token, bool Confirmation);
    private static Choice Prepare(string source, string path, string speakto, string actions, string primary, string groups,
        string options, string bucket, int index)
    {
        var root = LiveTools.GetReference(source, path);
        var rootType = root.GetIl2CppType().FullName;
        if (rootType != ConferenceType || bucket != "OptionalActions")
            throw new InvalidOperationException("Only supported press conference handoffs are available.");
        var channel = Channel(speakto, source, "SpeakTo", path);
        if (channel.Identity != root.GetPersistentIdentity()) throw new ArgumentException("Communication owner changed.");
        var target = LiveTools.GetReference(speakto);
        if (target.GetIl2CppType().FullName != "FM.UI.SpeakToReference") throw new ArgumentException("Use an original SpeakTo reference.");
        Channel(actions, speakto, "Actions"); Channel(primary, actions, "PrimaryNpcWithActions");
        var npc = Field(Record(LiveTools.GetValue(primary)), "NPC"); // Preserve actual null as well as references.
        Channel(groups, primary, "Actions");
        var rows = Channel(options, groups, bucket).Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
            ?? throw new InvalidOperationException("Communication actions not ready.");
        if (index < 0 || index >= rows.Count) throw new ArgumentException("Choose an original offered action.");
        var row = Record(rows[index]);
        if (!IsConferenceHandoff(row)) throw new InvalidOperationException("This action belongs to the player's dialogue.");
        if (Flag(row, "IsDisabled") || !Flag(row, "IsSimpleButton") || Flag(row, "IsPopupButton") ||
            Flag(row, "IsExitButton", false) || Flag(row, "IsContinueMatchFlowButton", false) || Flag(row, "IsOpenPanelAction", false))
            throw new InvalidOperationException("This action is disabled or requires a separate popup/navigation/phase workflow.");
        foreach (var name in new[] { "NewsAction", "DynamicCardId" })
        {
            var value = Field(row, name, false);
            if (value != null && !value.IsNull && int.TryParse(value.AsString(), out var additional) && additional >= 0)
                throw new InvalidOperationException("This action requires a separate news/card prelude.");
        }
        if (!uint.TryParse(Field(row, "Event").AsString(), out var eventId) || eventId == 0 || !Enum.IsDefined(typeof(InteropEventIDs), eventId))
            throw new InvalidOperationException("The offered action has no current SDK business event.");
        var payload = new SI.Core.Record();
        payload[0x204a3168] = TypedValue.CreateCopyFrom(npc);
        payload[0x7a637056] = TypedValue.CreateCopyFrom(Field(row, "ActionResponseId"));
        payload[0x73663370] = TypedValue.CreateCopyFrom(Field(row, "ActionResponseValue"));
        payload[0x42755170] = TypedValue.CreateCopyFrom(Field(row, "ActionID"));
        payload[0x42755176] = TypedValue.CreateCopyFrom(Field(row, "ActionProps"));
        payload[0x61636474] = TypedValue.CreateCopyFrom(Field(row, "ActionData"));
        var confirmation = Field(row, "ConfirmationDialogData", false); var ok = Field(row, "OKDialogData", false);
        var label = Field(row, "ActionTitle").AsString();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), owner = root.GetPersistentIdentity(), speakto = target.GetPersistentIdentity(),
            revision = Revision(target.GetPersistentIdentity()), bucket, index, eventId, label,
            payload = NativeValueFingerprint.Compute(GameTools.MakeObjectTypedValue(payload)),
            confirmation = NativeValueFingerprint.Compute(confirmation), ok = NativeValueFingerprint.Compute(ok) }));
        return new(root, target, eventId, payload, label, token,
            confirmation != null && !confirmation.IsNull || ok != null && !ok.IsNull);
    }
    public static object Describe(string source, string path, string speakto, string actions, string primary, string groups, string options, string bucket)
    {
        if (bucket != "OptionalActions" || LiveTools.GetReference(source, path).GetIl2CppType().FullName != ConferenceType)
            throw new InvalidOperationException("Only supported press conference handoffs are available.");
        var rows = Channel(options, groups, bucket).Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
            ?? throw new InvalidOperationException("Communication actions not ready.");
        var choices = new List<object>();
        void AddChoice(int index)
        {
            try
            {
                var item = Prepare(source, path, speakto, actions, primary, groups, options, bucket, index);
                choices.Add(new { index, label = item.Label, eventId = item.Event, choiceToken = item.Token, implemented = true,
                    requiresConfirmation = item.Confirmation });
            }
            catch (Exception error) { choices.Add(new { index, implemented = false, reason = error.GetBaseException().Message }); }
        }
        for (var index = 0; index < rows.Count; index++)
            if (IsConferenceHandoff(Record(rows[index]))) AddChoice(index);
        return new { ok = true, actions = choices, liveVerified = false, scope = "game_offered_shared_speakto_business_actions" };
    }
    public static object Execute(string id, string source, string path, string speakto, string actions, string primary, string groups, string options, string bucket,
        int index, string token, bool acceptConfirmation)
    {
        var item = Prepare(source, path, speakto, actions, primary, groups, options, bucket, index);
        if (item.Token != token) throw new InvalidOperationException("Communication action changed; refresh preview.");
        if (item.Confirmation && !acceptConfirmation) throw new InvalidOperationException("Read and explicitly accept the game's confirmation content.");
        // Allow dispatching communication action on the target SpeakTo reference.
        // LiveTools.RequireUnusedDraft(item.SpeakTo); LiveTools.RequireNoExternalSpeakTo();
        return ActionCommands.DispatchDomain(id, "communication_action", item.SpeakTo.GetPersistentIdentity(), item.Token, () => {
            Touch(item.SpeakTo.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(item.Event, item.SpeakTo, GameTools.MakeObjectTypedValue(item.Payload));
        }, null, null, "communication_action_dispatch");
    }
}
