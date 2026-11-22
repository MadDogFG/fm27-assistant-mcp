using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// The UI's SpeakToActionEvent first runs panel/news handling and then sends this six-field
// native payload. We send only the recovered business event for a currently offered action.
public static class NegotiationActions
{
    private static readonly Dictionary<string, long> Revisions = new();
    internal static void Touch(string identity) => Revisions[identity] = Revision(identity) + 1;
    internal static long Revision(string identity) => Revisions.TryGetValue(identity, out var revision) ? revision : 0;
    private static readonly HashSet<string> Buckets = new() { "RequiredActions", "OptionalActions", "AdviceActions", "ExitActions" };
    internal static SI.Core.Record Record(TypedValue value)
    {
        var type = value?.DataType?.FullName ?? "";
        return value == null || value.IsNull || type == "SI.Core.DynamicNumber" || type == "FM.GamePlugin.GameDate" || type.StartsWith("System.")
            ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    internal static TypedValue Field(SI.Core.Record record, string name, bool required = true)
    {
        if (record != null && record.TryGetValue(InternalCommands.PropertyId(name), out var value)) return value;
        if (required) throw new ArgumentException("Native negotiation action is missing " + name);
        return TypedValue.Null;
    }
    internal static bool Flag(SI.Core.Record record, string name, bool required = true)
    {
        var value = Field(record, name, required);
        if (!required && (value == null || value.IsNull)) return false;
        if (!bool.TryParse(value?.AsString(), out var flag)) throw new ArgumentException("Native action flag is invalid: " + name);
        return flag;
    }
    internal static LiveTools.Snapshot Channel(string handle, string source, string property, string path = "")
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != source || (snapshot.SourcePath ?? "") != path ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong negotiation action subscription: " + property);
        return snapshot;
    }
    internal static InteropReference Target(string domain, string session, string club)
    {
        if (domain == "contract") return ContractCommands.Target(session, club);
        if (domain == "promises") return PreContractCommands.Target(session, club);
        if (domain != "transfer") throw new ArgumentException("Unknown negotiation domain.");
        var target = LiveTools.GetReference(session);
        var source = LiveTools.GetSnapshot(session);
        if (!source.Ready || source.Property != InternalCommands.PropertyId("TransferOfferEditSession") ||
            target.GetIl2CppType().FullName != "FM.UI.TransferOfferEditSessionReference" ||
            LiveTools.GetReference(source.Source, source.SourcePath).GetIl2CppType().FullName != "FM.UI.PersonReference")
            throw new ArgumentException("Resolve a transfer offer session from the actual player reference.");
        var human = LiveTools.GetReference("human");
        var clubSource = LiveTools.GetSnapshot(club);
        if (!clubSource.Ready || clubSource.Source != "human" || !string.IsNullOrEmpty(clubSource.SourcePath) ||
            clubSource.Property != InternalCommands.PropertyId("Club") || clubSource.Identity != human.GetPersistentIdentity())
            throw new ArgumentException("Use the active manager's actual club.");
        ContractCommands.Context(source, 0x50625059, human.GetPersistentIdentity());
        var identity = LiveTools.GetReference(club).GetPersistentIdentity();
        bool Party(uint key) { try { ContractCommands.Context(source, key, identity); return true; } catch (ArgumentException) { return false; } }
        if (!Party(0x43627963) && !Party(0x43736c63)) throw new ArgumentException("The active club is not a party to this transfer negotiation.");
        return target;
    }
    private static (InteropReference Target, TypedValue Npc, Il2CppSystem.Collections.Generic.List<TypedValue> Rows) Offered(
        string domain, string session, string club, string speakto, string actions, string primary, string groups, string options, string bucket)
    {
        var target = Target(domain, session, club);
        Channel(speakto, session, "SpeakTo");
        if (LiveTools.GetReference(speakto).GetIl2CppType().FullName != "FM.UI.SpeakToReference") throw new ArgumentException("A native SpeakTo reference is required.");
        Channel(actions, speakto, "Actions");
        Channel(primary, actions, "PrimaryNpcWithActions");
        var npc = Field(Record(LiveTools.GetSnapshot(primary).Value), "NPC");
        var type = npc?.DataType?.FullName ?? "";
        if (npc == null || npc.IsNull || type == "SI.Core.DynamicNumber" || type.StartsWith("System.Int") || type.StartsWith("System.UInt") ||
            npc.Get()?.TryCast<FM.UI.PersonReference>() == null) throw new ArgumentException("Negotiation has no actual counterparty person reference.");
        Channel(groups, primary, "Actions");
        if (!Buckets.Contains(bucket)) throw new ArgumentException("Unknown negotiation action list.");
        var list = Channel(options, groups, bucket).Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
            ?? throw new ArgumentException("Game has not returned this negotiation action list.");
        return (target, npc, list);
    }
    private static (uint Event, SI.Core.Record Payload, string Token, string Label, bool Confirmation) Prepare(
        string domain, string session, string club, string speakto, string actions, string primary, string groups, string options, string bucket, int index)
    {
        var offered = Offered(domain, session, club, speakto, actions, primary, groups, options, bucket);
        if (index < 0 || index >= offered.Rows.Count) throw new ArgumentException("Select an existing native negotiation action.");
        var row = Record(offered.Rows[index]) ?? throw new ArgumentException("Negotiation action is not a record.");
        if (Flag(row, "IsDisabled")) throw new InvalidOperationException("Game disabled this negotiation action.");
        if (!Flag(row, "IsSimpleButton") || Flag(row, "IsPopupButton")) throw new InvalidOperationException("Choose a concrete business action; popup/navigation protocols require separate handling.");
        if (Flag(row, "IsExitButton", false) || Flag(row, "IsContinueMatchFlowButton", false) || Flag(row, "IsOpenPanelAction", false))
            throw new InvalidOperationException("This action includes a separate page or match-flow transition.");
        foreach (var property in new[] { "NewsAction", "DynamicCardId" })
        {
            var field = Field(row, property, false);
            if (field != null && !field.IsNull && int.TryParse(field.AsString(), out var action) && action >= 0)
                throw new InvalidOperationException("This action first runs an additional news/card workflow.");
        }
        var eventId = uint.Parse(Field(row, "Event").AsString(), CultureInfo.InvariantCulture);
        if (domain != "transfer" ? eventId != 20 && eventId != 41 : eventId != 32)
            throw new InvalidOperationException("The silent protocol for this negotiation event has not been recovered yet.");
        var payload = new SI.Core.Record();
        payload[0x204a3168] = TypedValue.CreateCopyFrom(offered.Npc);
        payload[0x7a637056] = TypedValue.CreateCopyFrom(Field(row, "ActionResponseId"));
        payload[0x73663370] = TypedValue.CreateCopyFrom(Field(row, "ActionResponseValue"));
        payload[0x42755170] = TypedValue.CreateCopyFrom(Field(row, "ActionID"));
        payload[0x42755176] = TypedValue.CreateCopyFrom(Field(row, "ActionProps"));
        payload[0x61636474] = TypedValue.CreateCopyFrom(Field(row, "ActionData"));
        var confirmation = Field(row, "ConfirmationDialogData", false);
        var ok = Field(row, "OKDialogData", false);
        var requiresConfirmation = confirmation != null && !confirmation.IsNull || ok != null && !ok.IsNull;
        var label = Field(row, "ActionTitle").AsString();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = offered.Target.GetPersistentIdentity(), draftRevision = Revision(offered.Target.GetPersistentIdentity()), domain, bucket, eventId,
            payload = NativeValueFingerprint.Compute(GameTools.MakeObjectTypedValue(payload)), label,
            confirmation = NativeValueFingerprint.Compute(confirmation), ok = NativeValueFingerprint.Compute(ok) }));
        return (eventId, payload, token, label, requiresConfirmation);
    }
    public static object Describe(string domain, string session, string club, string speakto, string actions, string primary, string groups, string options, string bucket)
    {
        var offered = Offered(domain, session, club, speakto, actions, primary, groups, options, bucket);
        var rows = new List<object>();
        for (var index = 0; index < offered.Rows.Count; index++)
        {
            var row = Record(offered.Rows[index]);
            try
            {
                var prepared = Prepare(domain, session, club, speakto, actions, primary, groups, options, bucket, index);
                rows.Add(new { index, eventId = prepared.Event, label = prepared.Label, choiceToken = prepared.Token,
                    actionResponseValue = prepared.Payload[0x73663370].AsString(),
                    silentExecutionImplemented = true, requiresConfirmation = prepared.Confirmation,
                    confirmation = LiveTools.DescribeValue(Field(row, "ConfirmationDialogData", false)), okDialog = LiveTools.DescribeValue(Field(row, "OKDialogData", false)) });
            }
            catch (Exception error)
            {
                rows.Add(new { index, label = Field(row, "ActionTitle", false)?.AsString(), silentExecutionImplemented = false, reason = error.GetBaseException().Message });
            }
        }
        var origin = LiveTools.GetSnapshot(session);
        return new { ok = true, domain, bucket, targetIdentity = offered.Target.GetPersistentIdentity(), sessionId = LiveTools.SessionId,
            epoch = LiveTools.CurrentEpoch, personIdentity = LiveTools.GetReference(origin.Source, origin.SourcePath).GetPersistentIdentity(),
            clubIdentity = LiveTools.GetReference(club).GetPersistentIdentity(), actions = rows, liveVerified = false };
    }
    public static object Execute(string id, string domain, string session, string club, string speakto, string actions, string primary, string groups, string options, string bucket, int index, string token, bool acceptConfirmation)
    {
        var prepared = Prepare(domain, session, club, speakto, actions, primary, groups, options, bucket, index);
        if (prepared.Token != token) throw new InvalidOperationException("Negotiation action or agent's draft changed since preview.");
        if (prepared.Confirmation && !acceptConfirmation) throw new InvalidOperationException("Read the game's confirmation metadata and explicitly choose acceptConfirmation for this action.");
        var target = Target(domain, session, club);
        LiveTools.RequireUnusedDraft(target);
        LiveTools.RequireUnusedDraft(LiveTools.GetReference(speakto));
        // The game's QuickActionComplete callback can close its shared quick-action panel
        // without checking this event's subject. Do not disturb another player's conversation.
        LiveTools.RequireNoExternalSpeakTo();
        var identity = target.GetPersistentIdentity();
        void Dispatch()
        {
            Touch(identity);
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(prepared.Event, LiveTools.GetReference(speakto), GameTools.MakeObjectTypedValue(prepared.Payload));
        }
        if (domain == "transfer") return ActionCommands.DispatchOnce(id, "transfer_negotiation_action", identity, token, "negotiation_action_dispatch",
            () => new ContinueRequestGuard.Preflight(prepared.Token, false, true, null), Dispatch);
        return ActionCommands.DispatchDomain(id, domain + "_negotiation_action", identity,
            LiveTools.JsonText(new { token, prepared.Event, acceptConfirmation }), Dispatch, null, null, "negotiation_action_dispatch");
    }
}
