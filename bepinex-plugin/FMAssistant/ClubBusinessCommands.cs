using System;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// ArrangeFriendlyBlock's original dropdown selection events. Normal candidate
// records only: no invented opponent IDs, match-rule numbers or fixture writes.
public static class ClubBusinessCommands
{
    private static string Property(string kind) => kind == "opponent" ? "TeamOpponent" : kind == "rules" ? "MatchRules" :
        throw new ArgumentException("Use opponent or rules.");
    private static InteropReference Target(string team, string friendly)
    {
        var human = LiveTools.GetReference("human");
        if (NegotiationActions.Channel(team, "human", "Team").Identity != human.GetPersistentIdentity())
            throw new ArgumentException("Use the active manager's actual team.");
        var owner = LiveTools.GetReference(team);
        var source = NegotiationActions.Channel(friendly, team, "ArrangeFriendly");
        if (source.Identity != owner.GetPersistentIdentity()) throw new ArgumentException("Friendly source belongs to another team.");
        var target = LiveTools.GetReference(friendly);
        if (target.GetIl2CppType().FullName != "FM.UI.ArrangeFriendlyReference") throw new ArgumentException("Use an original friendly arrangement reference.");
        return target;
    }
    private static TypedValue Choice(string choices, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select an original candidate path from the returned native dropdown data.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++)
        {
            var parent = NegotiationActions.Record(LiveTools.GetValue(choices, string.Join('/', parts.Take(i))));
            if (parent != null && parent.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) &&
                (!bool.TryParse(disabled.AsString(), out var off) || off)) throw new InvalidOperationException("Game disabled this choice or its parent.");
        }
        var option = LiveTools.GetValue(choices, path);
        var row = NegotiationActions.Record(option) ?? throw new ArgumentException("Choose the native dropdown record, not a numeric ID.");
        if (row.TryGetValue(InternalCommands.PropertyId("RowData"), out var data)) option = data;
        row = NegotiationActions.Record(option) ?? throw new ArgumentException("Native choice data unavailable.");
        if (row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var value) &&
            (!bool.TryParse(value.AsString(), out var choiceDisabled) || choiceDisabled)) throw new InvalidOperationException("Game disabled this choice.");
        if (row.TryGetValue(InternalCommands.PropertyId("ChildList"), out var children) && children != null && !children.IsNull)
        {
            var childList = children.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (childList == null || childList.Count != 0) throw new ArgumentException("Choose an actual opponent/rule leaf, not a dropdown category.");
        }
        NegotiationActions.Field(row, "PropertyValue");
        return TypedValue.CreateCopyFrom(option);
    }
    private static (InteropReference Target, TypedValue Payload, string Token) Prepare(string kind, string team, string friendly, string choices, string path)
    {
        var target = Target(team, friendly);
        var snapshot = NegotiationActions.Channel(choices, friendly, Property(kind));
        if (snapshot.Identity != target.GetPersistentIdentity()) throw new ArgumentException("Friendly choices belong to another draft.");
        var payload = Choice(choices, path);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, kind,
            team = LiveTools.GetReference(team).GetPersistentIdentity(), friendly = target.GetPersistentIdentity(),
            candidates = NativeValueFingerprint.Compute(snapshot.Value), payload = NativeValueFingerprint.Compute(payload) }));
        return (target, payload, token);
    }
    public static object Read(string kind, string team, string friendly, string choices)
    {
        var target = Target(team, friendly);
        var data = NegotiationActions.Channel(choices, friendly, Property(kind));
        if (data.Identity != target.GetPersistentIdentity()) throw new ArgumentException("Friendly choices belong to another draft.");
        return new { ok = true, kind, choices = LiveTools.DescribeValue(data.Value, 8), targetIdentity = target.GetPersistentIdentity(), liveVerified = false };
    }
    public static object Preview(string kind, string team, string friendly, string choices, string optionPath)
    {
        var p = Prepare(kind, team, friendly, choices, optionPath);
        return new { ok = true, kind, choiceToken = p.Token, payload = LiveTools.DescribeValue(p.Payload),
            eventId = kind == "opponent" ? (uint)InteropEventIDs.EventFmxSelectTeam : (uint)InteropEventIDs.EventFmxSetMatchRules,
            draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string kind, string team, string friendly, string choices, string optionPath, string token)
    {
        var p = Prepare(kind, team, friendly, choices, optionPath);
        if (p.Token != token) throw new InvalidOperationException("Friendly candidate or selection changed; refresh the preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "friendly_selection." + kind, p.Target.GetPersistentIdentity(), token, () =>
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(kind == "opponent" ? (uint)InteropEventIDs.EventFmxSelectTeam : (uint)InteropEventIDs.EventFmxSetMatchRules,
                p.Target, p.Payload), null, null, "friendly_selection_dispatch_only");
    }
    private static (InteropReference Target, Il2CppSystem.Collections.Generic.List<GameDate> Dates, TypedValue Current) Dates(string team, string friendly, string available, string current)
    {
        var target = Target(team, friendly);
        var choices = NegotiationActions.Channel(available, friendly, "AvailableDates");
        var date = NegotiationActions.Channel(current, friendly, "Date");
        if (choices.Identity != target.GetPersistentIdentity() || date.Identity != target.GetPersistentIdentity() || date.Value?.DataType?.FullName != "FM.GamePlugin.GameDate")
            throw new ArgumentException("Friendly date or available-date list belongs to another draft or is unavailable.");
        // Exact same conversion used by BindDateSelectorFromLimitedTypedListDynamicData.
        var dates = FM.UI.VisualFunctions.GameDateFunctions.GetGameDatesFromTypedList(choices.Value)
            ?? throw new InvalidOperationException("Native friendly date list is not ready.");
        return (target, dates, date.Value);
    }
    private static (InteropReference Target, TypedValue Date, string Before, string Desired, string Token) DateChoice(string team, string friendly, string available, string current, int index)
    {
        var p = Dates(team, friendly, available, current);
        if (index < 0 || index >= p.Dates.Count) throw new ArgumentException("Choose an original available friendly date index.");
        var values = new List<string>();
        for (var i = 0; i < p.Dates.Count; i++) values.Add(p.Dates[i].Data1.ToString(CultureInfo.InvariantCulture));
        var date = TypedValue.Create(p.Dates[index]);
        var before = NativeValueFingerprint.Compute(p.Current); var desired = NativeValueFingerprint.Compute(date);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = p.Target.GetPersistentIdentity(), index, before, desired, availableDates = values }));
        return (p.Target, date, before, desired, token);
    }
    public static object DatesRead(string team, string friendly, string available, string current, string operationId)
    {
        var p = Dates(team, friendly, available, current);
        if (!string.IsNullOrEmpty(operationId)) return ActionCommands.ObserveDomain(operationId, p.Target.GetPersistentIdentity(), "friendly_date_draft", NativeValueFingerprint.Compute(p.Current));
        var dates = new List<object>();
        for (var i = 0; i < p.Dates.Count; i++) dates.Add(new { index = i, date = GameDate.ToDateTime(p.Dates[i]).ToString("yyyy-MM-dd"),
            packed = p.Dates[i].Data1.ToString(CultureInfo.InvariantCulture) });
        return new { ok = true, dates, current = LiveTools.DescribeValue(p.Current), targetIdentity = p.Target.GetPersistentIdentity(), liveVerified = false };
    }
    public static object DatePreview(string team, string friendly, string available, string current, int index)
    {
        var p = DateChoice(team, friendly, available, current, index);
        return new { ok = true, index, choiceToken = p.Token, before = p.Before, requested = p.Desired,
            date = GameDate.ToDateTime(p.Date.Get<GameDate>()).ToString("yyyy-MM-dd"), draftOnly = true, liveVerified = false };
    }
    public static object DateExecute(string id, string team, string friendly, string available, string current, int index, string token)
    {
        var p = DateChoice(team, friendly, available, current, index);
        if (token != p.Token) throw new InvalidOperationException("Available dates or the friendly arrangement changed; refresh preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "friendly.date", p.Target.GetPersistentIdentity(), token,
            () => LiveTools.UpdateProperty(current, p.Date), p.Before, p.Desired, "friendly_date_draft");
    }
}
