using System;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Current UI ResponsibilityRow/ResponsibilityGroupRow native business events;
// actual manager-owned edit-session references, not arbitrary property writes.
public static class AdministrationCommands
{
    private static LiveTools.Snapshot Channel(string handle, string source, string property, string path = "") =>
        NegotiationActions.Channel(handle, source, property, path);
    private static bool Flag(string handle, string source, string property)
    {
        var value = Channel(handle, source, property).Value;
        return bool.TryParse(value?.AsString(), out var result) ? result : throw new InvalidOperationException("Responsibility flag unavailable: " + property);
    }
    private static InteropReference Resolve(string team, string container, string session, string tabs, string tabPath,
        string groups, string groupPath, string responsibilities, string responsibilityPath, bool individual)
    {
        var human = LiveTools.GetReference("human");
        var teamChannel = Channel(team, "human", "Team");
        if (teamChannel.Identity != human.GetPersistentIdentity()) throw new ArgumentException("Use the active manager's original team.");
        Channel(container, team, "TeamContainer");
        Channel(session, container, "TeamSettingsEditSession");
        if (LiveTools.GetReference(session).GetIl2CppType().FullName != "FM.UI.TeamSettingsEditSessionReference")
            throw new ArgumentException("A current team-settings edit session is required.");
        Channel(tabs, session, "ResponsibilitySimpleTabList");
        var tab = LiveTools.GetReference(tabs, tabPath);
        if (tab.GetIl2CppType().FullName != "FM.UI.TeamSettingsEditSessionResponsibilityTabReference") throw new ArgumentException("Select a real responsibility tab.");
        Channel(groups, tabs, "ResponsibilitySimpleGroupList", tabPath);
        var group = LiveTools.GetReference(groups, groupPath);
        if (group.GetIl2CppType().FullName != "FM.UI.TeamSettingsEditSessionResponsibilityGroupReference") throw new ArgumentException("Select a real responsibility group.");
        if (!individual) return group;
        Channel(responsibilities, groups, "ResponsibilityList", groupPath);
        var target = LiveTools.GetReference(responsibilities, responsibilityPath);
        if (target.GetIl2CppType().FullName != "FM.UI.TeamSettingsEditSessionIndividualResponsibilityReference") throw new ArgumentException("Select a real individual responsibility.");
        return target;
    }
    private sealed record Prepared(InteropReference Target, uint Event, string Before, string Requested, string Scope, string Token);
    private static Prepared Prepare(string action, string team, string container, string session, string tabs, string tabPath,
        string groups, string groupPath, string responsibilities, string responsibilityPath, string current, string editable, string takeControl)
    {
        var individual = action == "take_control" || action == "delegate";
        if (!individual && action != "group_take_control" && action != "group_recommended") throw new ArgumentException("Unknown responsibility operation.");
        var target = Resolve(team, container, session, tabs, tabPath, groups, groupPath, responsibilities, responsibilityPath, individual);
        var source = individual ? responsibilities : groups; var path = individual ? responsibilityPath : groupPath;
        var currentProperty = action == "group_recommended" ? "IsRecommendedStaffMemberInControl" : "IsUserInControl";
        bool ReadFlag(string handle, string property)
        {
            var value = Channel(handle, source, property, path);
            if (value.Identity != target.GetPersistentIdentity() || !bool.TryParse(value.Value?.AsString(), out var result)) throw new ArgumentException("Responsibility state source mismatch: " + property);
            return result;
        }
        if (!ReadFlag(editable, "CanHumanChange")) throw new InvalidOperationException("The game does not permit changing this responsibility.");
        var before = ReadFlag(current, currentProperty);
        if ((action == "take_control" || action == "group_take_control") && !before && !ReadFlag(takeControl, "CanHumanTakeControl"))
            throw new InvalidOperationException("The game does not permit taking control of this responsibility.");
        var desired = action != "delegate";
        var id = target.GetPersistentIdentity();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), settings = LiveTools.GetReference(session).GetPersistentIdentity(), target = id, action, before, desired }));
        return new Prepared(target, individual ? 141U : action == "group_take_control" ? 142U : 143U,
            before.ToString(), desired.ToString(), "responsibility_configuration." + currentProperty, token);
    }
    public static object Preview(string action, string team, string container, string session, string tabs, string tabPath,
        string groups, string groupPath, string responsibilities, string responsibilityPath, string current, string editable, string takeControl)
    {
        var p = Prepare(action, team, container, session, tabs, tabPath, groups, groupPath, responsibilities, responsibilityPath, current, editable, takeControl);
        return new { ok = true, action, targetIdentity = p.Target.GetPersistentIdentity(), before = p.Before, requested = p.Requested,
            choiceToken = p.Token, eventId = p.Event, verificationScope = p.Scope, liveVerified = false };
    }
    public static object Execute(string id, string action, string team, string container, string session, string tabs, string tabPath,
        string groups, string groupPath, string responsibilities, string responsibilityPath, string current, string editable, string takeControl, string token)
    {
        var p = Prepare(action, team, container, session, tabs, tabPath, groups, groupPath, responsibilities, responsibilityPath, current, editable, takeControl);
        if (p.Token != token) throw new InvalidOperationException("Responsibility state changed; preview again.");
        return ActionCommands.DispatchDomain(id, "responsibility." + action, p.Target.GetPersistentIdentity(), p.Token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, null), p.Before, p.Requested, p.Scope);
    }
}
