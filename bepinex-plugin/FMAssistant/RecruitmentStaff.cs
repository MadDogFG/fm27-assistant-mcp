using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Mirrors the dialog's normal AnyScout/AnyAnalyst toggle and SelectedItemsBinding.
// This edits the native focus draft; final focus acceptance is a separate operation.
public static class RecruitmentStaff
{
    private sealed record Person(TypedValue Original, string Identity);
    private static (string List, string Any) Names(string kind) => kind switch {
        "scouts" => ("Scouts", "AnyScout"), "analysts" => ("Analysts", "AnyAnalyst"),
        _ => throw new ArgumentException("Choose scouts or analysts for recruitment focus staffing.")
    };
    private static List<Person> People(TypedValue value)
    {
        if (!(value?.DataType?.FullName ?? "").StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal))
            throw new InvalidOperationException("Game did not return a native person-reference list.");
        var list = value.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() ?? throw new InvalidOperationException("Native person list is unavailable.");
        var people = new List<Person>();
        for (var i = 0; i < list.Count; i++)
        {
            var original = list[i];
            var type = original?.DataType?.FullName ?? "";
            if (original == null || original.IsNull || type == "SI.Core.DynamicNumber" || type.StartsWith("System.", StringComparison.Ordinal))
                throw new InvalidOperationException("Staff candidate is not an original person reference.");
            var person = original.Get()?.TryCast<FM.UI.PersonReference>() ?? throw new InvalidOperationException("Staff candidate is not an actual PersonReference.");
            people.Add(new Person(original, person.GetPersistentIdentity()));
        }
        if (people.Select(person => person.Identity).Distinct(StringComparer.Ordinal).Count() != people.Count)
            throw new InvalidOperationException("Game returned duplicate staff references; refresh before assigning.");
        return people;
    }
    private static (bool Any, List<Person> People, string State) Current(string source, string path, string kind, string current, string any)
    {
        var names = Names(kind);
        var mode = RecruitmentCommands.FocusChannel(any, source, names.Any, path).Value;
        if (!bool.TryParse(mode?.AsString(), out var isAny)) throw new InvalidOperationException("Native staff selection mode is unavailable.");
        var people = People(RecruitmentCommands.FocusChannel(current, source, names.List, path).Value);
        return (isAny, people, RecruitmentStaffConfiguration.State(isAny, people.Select(person => person.Identity)));
    }
    public static object Read(string info, string source, string path, string kind, string current, string any, string operationId)
    {
        var target = RecruitmentCommands.Target(info, source, path);
        var state = Current(source, path, kind, current, any);
        if (!string.IsNullOrEmpty(operationId)) return ActionCommands.ObserveDomain(operationId, target.GetPersistentIdentity(), "recruitment_focus_staff." + kind, state.State);
        return new { ok = true, kind, targetIdentity = target.GetPersistentIdentity(), sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            any = state.Any, selected = state.People.Select(person => new { identity = person.Identity, value = LiveTools.DescribeValue(person.Original) }).ToArray(),
            focusSubmitted = false, verificationScope = "recruitment_focus_staff." + kind, liveVerified = false };
    }
    private static (InteropReference Target, TypedValue Payload, bool Any, bool SwitchToManual, string Before, string Requested, string Token, string[] Identities) Prepare(
        string info, string source, string path, string kind, string current, string any, string team, string container, string choices, string selection, string pathsJson)
    {
        if (selection != "any" && selection != "explicit") throw new ArgumentException("Choose any or explicit staffing.");
        var target = RecruitmentCommands.Target(info, source, path);
        var names = Names(kind);
        var before = Current(source, path, kind, current, any);
        var selected = new List<Person>();
        string candidateFingerprint = null, containerIdentity = null, teamIdentity = null;
        if (selection == "explicit")
        {
            var teamSource = Channel(team, "human", "Team");
            if (teamSource.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new InvalidOperationException("Active manager changed after the team was subscribed.");
            var teamReference = LiveTools.GetReference(team);
            if (teamReference.GetIl2CppType().FullName != "FM.UI.TeamReference") throw new ArgumentException("Use the current manager's real team.");
            teamIdentity = teamReference.GetPersistentIdentity();
            var origin = Channel(container, team, "TeamContainer");
            if (origin.Identity != teamIdentity) throw new InvalidOperationException("Team container changed during candidate resolution.");
            var containerReference = LiveTools.GetReference(container);
            var containerType = containerReference.GetIl2CppType().FullName;
            if (containerType != "FM.UI.ClubReference" && containerType != "FM.UI.NationalTeamContainerReference")
                throw new ArgumentException("Unsupported native team container for staff candidates.");
            containerIdentity = containerReference.GetPersistentIdentity();
            var candidateSource = Channel(choices, container, names.List);
            if (candidateSource.Identity != containerIdentity) throw new InvalidOperationException("Staff candidate owner changed after subscription.");
            var candidates = People(candidateSource.Value);
            using var document = JsonDocument.Parse(pathsJson);
            if (document.RootElement.ValueKind != JsonValueKind.Array) throw new ArgumentException("Select original candidate list paths, including [] for an empty manual selection.");
            foreach (var item in document.RootElement.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.String || !int.TryParse(item.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out var index) || index < 0 || index >= candidates.Count)
                    throw new ArgumentException("Staff selection must use existing native candidate list indices.");
                selected.Add(candidates[index]);
            }
            if (selected.Select(person => person.Identity).Distinct(StringComparer.Ordinal).Count() != selected.Count)
                throw new ArgumentException("Do not select the same staff member twice.");
            candidateFingerprint = NativeValueFingerprint.Compute(candidateSource.Value);
        }
        else if (!string.IsNullOrEmpty(pathsJson))
        {
            using var document = JsonDocument.Parse(pathsJson);
            if (document.RootElement.ValueKind != JsonValueKind.Array || document.RootElement.GetArrayLength() != 0)
                throw new ArgumentException("Any-staff mode does not take explicit staff selections.");
        }
        var payload = new Il2CppSystem.Collections.Generic.List<TypedValue>();
        foreach (var person in selected) payload.Add(TypedValue.CreateCopyFrom(person.Original));
        var value = GameTools.MakeObjectTypedValue(payload);
        var identities = selected.Select(person => person.Identity).ToArray();
        var requested = RecruitmentStaffConfiguration.State(selection == "any", identities);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = target.GetPersistentIdentity(), revision = Revision(target.GetPersistentIdentity()), kind, before = before.State, requested,
            candidateFingerprint, containerIdentity, teamIdentity, payload = NativeValueFingerprint.Compute(value) }));
        return (target, value, selection == "any", selection == "explicit" && before.Any, before.State, requested, token, identities);
    }
    public static object Preview(string info, string source, string path, string kind, string current, string any, string team, string container, string choices, string selection, string pathsJson)
    {
        var prepared = Prepare(info, source, path, kind, current, any, team, container, choices, selection, pathsJson);
        return new { ok = true, kind, selection, requestedIdentities = prepared.Identities, before = prepared.Before, requested = prepared.Requested,
            switchToManual = prepared.SwitchToManual, choiceToken = prepared.Token, focusSubmitted = false, nativeAtomicTransaction = false,
            operation = prepared.Any ? "normal any-person toggle clears explicit focus selections" : "normal manual-selection toggle if needed, then original person-reference list update",
            liveVerified = false };
    }
    public static object Execute(string id, string info, string source, string path, string kind, string current, string any, string team, string container, string choices, string selection, string pathsJson, string token)
    {
        var prepared = Prepare(info, source, path, kind, current, any, team, container, choices, selection, pathsJson);
        if (prepared.Token != token) throw new InvalidOperationException("Focus staff, staffing mode or candidates changed since preview.");
        LiveTools.RequireUnusedDraft(prepared.Target);
        // info (ScoutingInfo) is held by persistent UI roots; only the draft target needs exclusive isolation.
        return ActionCommands.DispatchDomain(id, "recruitment_focus_staff_" + kind, prepared.Target.GetPersistentIdentity(), token, () => {
            Touch(prepared.Target.GetPersistentIdentity());
            if (prepared.Any || prepared.SwitchToManual) LiveTools.UpdateProperty(any, TypedValue.Create(prepared.Any));
            if (!prepared.Any) LiveTools.UpdateProperty(current, prepared.Payload);
        }, prepared.Before, prepared.Requested, "recruitment_focus_staff." + kind);
    }
}
