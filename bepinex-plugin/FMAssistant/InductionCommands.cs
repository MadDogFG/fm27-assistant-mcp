using System;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// The native induction SpeakTo handler routes 0x4969436e through 1803e63c0.
// This is the game's offered exit action; dispatch alone does not prove completion.
public static class InductionCommands
{
    private const uint EndEvent = 0x4969436e;
    private const uint SkipEvent = 0x4969456e;
    private sealed record Choice(InteropReference Target, uint Event, SI.Core.Record Payload, string Token, string Label,
        bool Confirmation, TypedValue ConfirmationData, TypedValue OkData, string NewsIdentity, string InductionIdentity,
        string Complete, string Step, string MaxStep);
    private static Choice Prepare(string inbox, string path, string induction, string speakto, string actions, string primary,
        string groups, string options, string complete, string step, string maxStep, int index)
    {
        var list = LiveTools.GetSnapshot(inbox);
        if (!list.Ready || list.Source != "human" || !string.IsNullOrEmpty(list.SourcePath) ||
            list.Identity != LiveTools.GetReference("human").GetPersistentIdentity() ||
            list.Property != InternalCommands.PropertyId("HumanPortalFilteredMessages"))
            throw new ArgumentException("Use the active manager's complete inbox.");
        if (!int.TryParse(path, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n < 0 || path != n.ToString(CultureInfo.InvariantCulture))
            throw new ArgumentException("Select a current inbox row.");
        var news = LiveTools.GetReference(inbox, path);
        if (news.GetIl2CppType().FullName != "FM.UI.NewsItemReference") throw new ArgumentException("Expected an actual news row.");
        var newsId = news.GetPersistentIdentity();
        var origin = Channel(induction, inbox, "Induction", path);
        if (origin.Identity != newsId) throw new InvalidOperationException("Inbox row changed; refresh.");
        var intro = LiveTools.GetReference(induction);
        var introId = intro.GetPersistentIdentity();
        if (intro.GetIl2CppType().FullName != "FM.UI.InductionReference")
            throw new ArgumentException("Use the original news induction reference.");
        var talkOrigin = Channel(speakto, induction, "SpeakTo");
        if (talkOrigin.Identity != introId) throw new InvalidOperationException("Induction reference changed.");
        var target = LiveTools.GetReference(speakto);
        if (target.GetIl2CppType().FullName != "FM.UI.SpeakToReference" ||
            Array.IndexOf(target.GetPersistentIdentity().Split(','), "1398040932:13") < 0)
            throw new ArgumentException("Expected the original induction SpeakTo handler.");
        Channel(actions, speakto, "Actions"); Channel(primary, actions, "PrimaryNpcWithActions");
        var npc = Field(Record(LiveTools.GetValue(primary)), "NPC");
        Channel(groups, primary, "Actions");
        var rows = Channel(options, groups, "ExitActions").Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
            ?? throw new InvalidOperationException("Game has not provided exit actions.");
        var done = Channel(complete, speakto, "InteractionIsComplete").Value?.AsString();
        var current = Channel(step, speakto, "CurrentInductionStepIndex").Value?.AsString();
        var maximum = Channel(maxStep, speakto, "MaxInductionStepIndex").Value?.AsString();
        if (!bool.TryParse(done, out var isDone) || !int.TryParse(current, out _) || !int.TryParse(maximum, out _))
            throw new InvalidOperationException("Induction state is not ready.");
        if (isDone) throw new InvalidOperationException("The induction is already complete.");
        if (index < 0 || index >= rows.Count) throw new ArgumentException("Choose an offered exit action.");
        var row = Record(rows[index]) ?? throw new InvalidOperationException("Action row unavailable.");
        if (Flag(row, "IsDisabled") || !Flag(row, "IsExitButton") || Flag(row, "IsPopupButton") || Flag(row, "IsOpenPanelAction", false))
            throw new InvalidOperationException("This is not the available normal end action.");
        if (!uint.TryParse(Field(row, "Event").AsString(), out var ev) || (ev != EndEvent && ev != SkipEvent) ||
            Field(row, "ActionResponseId").AsString() != "-1" || Field(row, "NewsAction").AsString() != "-1" || Field(row, "DynamicCardId").AsString() != "-1")
            throw new InvalidOperationException("The offered exit action does not match the recovered end protocol.");
        var payload = new SI.Core.Record();
        payload[0x204a3168] = TypedValue.CreateCopyFrom(npc);
        payload[0x7a637056] = TypedValue.CreateCopyFrom(Field(row, "ActionResponseId"));
        payload[0x73663370] = TypedValue.CreateCopyFrom(Field(row, "ActionResponseValue"));
        payload[0x42755170] = TypedValue.CreateCopyFrom(Field(row, "ActionID"));
        payload[0x42755176] = TypedValue.CreateCopyFrom(Field(row, "ActionProps"));
        payload[0x61636474] = TypedValue.CreateCopyFrom(Field(row, "ActionData"));
        var confirmation = Field(row, "ConfirmationDialogData", false); var ok = Field(row, "OKDialogData", false);
        if (LiveTools.GetReference(inbox, path).GetPersistentIdentity() != newsId) throw new InvalidOperationException("Inbox changed while reading.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), newsId, introId, target = target.GetPersistentIdentity(),
            revision = Revision(target.GetPersistentIdentity()), index, done, current, maximum,
            payload = NativeValueFingerprint.Compute(GameTools.MakeObjectTypedValue(payload)), action = NativeValueFingerprint.Compute(rows[index]),
            confirmation = NativeValueFingerprint.Compute(confirmation), ok = NativeValueFingerprint.Compute(ok) }));
        return new(target, ev, payload, token, Field(row, "ActionTitle").AsString(),
            confirmation != null && !confirmation.IsNull || ok != null && !ok.IsNull, confirmation, ok, newsId, introId, done, current, maximum);
    }
    public static object Read(string inbox, string path, string induction, string speakto, string actions, string primary, string groups,
        string options, string complete, string step, string maxStep)
    {
        var list = LiveTools.GetSnapshot(inbox);
        if (!list.Ready || list.Source != "human" || !string.IsNullOrEmpty(list.SourcePath) ||
            list.Identity != LiveTools.GetReference("human").GetPersistentIdentity() ||
            list.Property != InternalCommands.PropertyId("HumanPortalFilteredMessages") ||
            !int.TryParse(path, NumberStyles.None, CultureInfo.InvariantCulture, out var rowIndex) || rowIndex < 0 || path != rowIndex.ToString(CultureInfo.InvariantCulture))
            throw new ArgumentException("Use a current row of the active manager's complete inbox.");
        var news = LiveTools.GetReference(inbox, path);
        if (news.GetIl2CppType().FullName != "FM.UI.NewsItemReference") throw new ArgumentException("Expected a news row.");
        var newsId = news.GetPersistentIdentity();
        if (Channel(induction, inbox, "Induction", path).Identity != newsId) throw new InvalidOperationException("Inbox changed.");
        var intro = LiveTools.GetReference(induction);
        var introId = intro.GetPersistentIdentity();
        if (intro.GetIl2CppType().FullName != "FM.UI.InductionReference")
            throw new ArgumentException("Use the original news induction reference.");
        if (Channel(speakto, induction, "SpeakTo").Identity != introId || LiveTools.GetReference(speakto).GetIl2CppType().FullName != "FM.UI.SpeakToReference" ||
            Array.IndexOf(LiveTools.GetReference(speakto).GetPersistentIdentity().Split(','), "1398040932:13") < 0)
            throw new InvalidOperationException("Induction SpeakTo changed.");
        Channel(actions, speakto, "Actions"); Channel(primary, actions, "PrimaryNpcWithActions"); Channel(groups, primary, "Actions");
        var done = Channel(complete, speakto, "InteractionIsComplete").Value?.AsString();
        var current = Channel(step, speakto, "CurrentInductionStepIndex").Value?.AsString();
        var maximum = Channel(maxStep, speakto, "MaxInductionStepIndex").Value?.AsString();
        if (!bool.TryParse(done, out _) || !int.TryParse(current, out _) || !int.TryParse(maximum, out _)) throw new InvalidOperationException("Induction state is not ready.");
        var rows = Channel(options, groups, "ExitActions").Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
            ?? throw new InvalidOperationException("Exit actions unavailable.");
        var choices = new System.Collections.Generic.List<object>();
        for (var i = 0; i < rows.Count; i++) {
            try { var c = Prepare(inbox,path,induction,speakto,actions,primary,groups,options,complete,step,maxStep,i);
                choices.Add(new { index=i, implemented=true, label=c.Label, eventId=c.Event, choiceToken=c.Token,
                    requiresConfirmation=c.Confirmation, confirmation=LiveTools.DescribeValue(c.ConfirmationData), okDialog=LiveTools.DescribeValue(c.OkData),
                    newsIdentity=c.NewsIdentity, inductionIdentity=c.InductionIdentity, complete=c.Complete, step=c.Step, maxStep=c.MaxStep }); }
            catch (Exception e) { choices.Add(new { index=i, implemented=false, reason=e.GetBaseException().Message }); }
        }
        if (LiveTools.GetReference(inbox, path).GetPersistentIdentity() != newsId) throw new InvalidOperationException("Inbox changed while reading.");
        return new { ok=true, sessionId=LiveTools.SessionId, epoch=LiveTools.CurrentEpoch, newsIdentity=newsId, inductionIdentity=introId,
            complete=done, step=current, maxStep=maximum, actions=choices, liveVerified=false };
    }
    public static object Execute(string id, string inbox, string path, string induction, string speakto, string actions, string primary,
        string groups, string options, string complete, string step, string maxStep, int index, string token, bool acceptConfirmation)
    {
        var c = Prepare(inbox,path,induction,speakto,actions,primary,groups,options,complete,step,maxStep,index);
        if (c.Token != token) throw new InvalidOperationException("Induction or offered action changed; refresh.");
        if (c.Confirmation && !acceptConfirmation) throw new InvalidOperationException("Read and accept the game's confirmation.");
        LiveTools.RequireUnusedDraft(c.Target); LiveTools.RequireNoExternalSpeakTo();
        return ActionCommands.DispatchDomain(id, "induction_end", c.Target.GetPersistentIdentity(), token, () => {
            Touch(c.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(c.Event, c.Target, GameTools.MakeObjectTypedValue(c.Payload));
        }, null, null, "induction_end_dispatch");
    }
}
