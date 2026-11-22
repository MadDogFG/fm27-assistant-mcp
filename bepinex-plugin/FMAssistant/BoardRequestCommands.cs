using System;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// ClubBoardBlock dropdown -> Club.BoardRequestSpeakTo.Actions.ActionsForDropdown.
// The original SpeakToAction context explicitly supplies null NPC and copies the
// selected leaf's response/action fields. It does not require opening a panel.
public static class BoardRequestCommands
{
    private sealed record Prepared(InteropReference SpeakTo, uint Event, SI.Core.Record Payload, string Token, bool Confirmation, object Metadata);
    private static Prepared Prepare(string club, string speakto, string actions, string options, string optionPath)
    {
        var owner = Channel(club, "human", "Club");
        if (owner.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the actual manager's club.");
        var root = LiveTools.GetReference(club); var speech = Channel(speakto, club, "BoardRequestSpeakTo");
        if (speech.Identity != root.GetPersistentIdentity()) throw new ArgumentException("Board request belongs to another club.");
        var target = LiveTools.GetReference(speakto);
        if (target.GetIl2CppType().FullName != "FM.UI.SpeakToReference") throw new ArgumentException("Use the original board-request SpeakTo reference.");
        Channel(actions, speakto, "Actions"); Channel(options, actions, "ActionsForDropdown");
        // NativeChoiceTree also rejects disabled ancestors and category headings.
        var selected = NativeChoiceTree.Leaf(options, optionPath, false);
        var row = Record(selected) ?? throw new ArgumentException("Choose an original board-request action record.");
        if (Flag(row, "IsDisabled", false) || Flag(row, "IsOpenPanelAction", false) || Flag(row, "IsContinueMatchFlowButton", false) || Flag(row, "IsExitButton", false))
            throw new InvalidOperationException("Board request is disabled or requires another presentation/phase workflow.");
        foreach (var property in new[] { "NewsAction", "DynamicCardId" })
        {
            var value = Field(row, property, false);
            if (value != null && !value.IsNull && int.TryParse(value.AsString(), out var additional) && additional >= 0)
                throw new InvalidOperationException("This request requires a separate news/card prelude.");
        }
        if (!uint.TryParse(Field(row, "Event").AsString(), NumberStyles.None, CultureInfo.InvariantCulture, out var eventId) ||
            eventId == 0 || !Enum.IsDefined(typeof(InteropEventIDs), eventId)) throw new InvalidOperationException("Unknown current SDK board-request event.");
        var data = new SI.Core.Record(); data[0x204a3168] = TypedValue.Null;
        data[0x7a637056] = TypedValue.CreateCopyFrom(Field(row, "ActionResponseId"));
        data[0x73663370] = TypedValue.CreateCopyFrom(Field(row, "ActionResponseValue"));
        data[0x42755170] = TypedValue.CreateCopyFrom(Field(row, "ActionID"));
        data[0x42755176] = TypedValue.CreateCopyFrom(Field(row, "ActionProps"));
        data[0x61636474] = TypedValue.CreateCopyFrom(Field(row, "ActionData"));
        var confirmation = Field(row, "ConfirmationDialogData", false); var ok = Field(row, "OKDialogData", false);
        var reject = Field(row, "RejectConfirmationEvent", false);
        var requires = confirmation != null && !confirmation.IsNull || ok != null && !ok.IsNull ||
            reject != null && !reject.IsNull && uint.TryParse(reject.AsString(), out var rejectId) && rejectId != 0;
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), club = root.GetPersistentIdentity(), target = target.GetPersistentIdentity(),
            revision = Revision(target.GetPersistentIdentity()), row = NativeValueFingerprint.Compute(selected) }));
        return new(target, eventId, data, token, requires, LiveTools.DescribeValue(selected));
    }
    public static object Preview(string club, string speakto, string actions, string options, string optionPath)
    {
        var p = Prepare(club, speakto, actions, options, optionPath);
        return new { ok = true, choiceToken = p.Token, eventId = p.Event, requiresConfirmation = p.Confirmation,
            originalOption = p.Metadata, verificationScope = "board_request_dispatch_only", liveVerified = false };
    }
    public static object Execute(string id, string club, string speakto, string actions, string options, string optionPath, string token, bool acceptConfirmation)
    {
        var p = Prepare(club, speakto, actions, options, optionPath);
        if (p.Token != token) throw new InvalidOperationException("Board request changed; refresh preview.");
        if (p.Confirmation && !acceptConfirmation) throw new InvalidOperationException("Read and explicitly accept the game's original confirmation metadata.");
        LiveTools.RequireUnusedDraft(p.SpeakTo); LiveTools.RequireNoExternalSpeakTo();
        return ActionCommands.DispatchDomain(id, "board_request", p.SpeakTo.GetPersistentIdentity(), token, () => {
            Touch(p.SpeakTo.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.SpeakTo, GameTools.MakeObjectTypedValue(p.Payload));
        }, null, null, "board_request_dispatch_only");
    }
}
