using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Club affiliate proposal draft. Event ids and bindings come from the current build's
// ClubAffiliatesBlock asset (evidence/v77-club-affiliate-protocol.json):
// 929785399 SelectedAffiliateChange (radio selection, target AffiliateEditSession, data selectedindex),
// 1717717618 ProposeAffiliateLink (gated by CanCommitAffiliateProposal),
// 925986650 CancelAffiliateProposal.
// AffiliateEditSessionReference registers Count / CanCommitAffiliateProposal / ProposedAffiliateClubs /
// SelectedAffiliateClub. The selection index payload shape is inferred; nothing here is live-verified.
public static class ClubAffiliateCommands
{
    private static InteropReference Resolve(string session, string club)
    {
        var human = LiveTools.GetReference("human");
        var actor = NegotiationActions.Channel(club, "human", "Club");
        if (actor.Identity != human.GetPersistentIdentity()) throw new ArgumentException("Use the current manager's actual club.");
        var target = LiveTools.GetReference(session);
        var source = LiveTools.GetSnapshot(session);
        if (target.GetIl2CppType().FullName != "FM.UI.AffiliateEditSessionReference" || !source.Ready ||
            source.Property != InternalCommands.PropertyId("AffiliateEditSession") ||
            LiveTools.GetReference(source.Source, source.SourcePath).GetIl2CppType().FullName != "FM.UI.ClubReference")
            throw new ArgumentException("Resolve Club.AffiliateEditSession from the actual club reference.");
        return target;
    }
    private static LiveTools.Snapshot Channel(string handle, string session, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != session || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong affiliate session subscription: " + property);
        return snapshot;
    }
    private static int Count(LiveTools.Snapshot snapshot)
    {
        if (!int.TryParse(snapshot.Value?.AsString(), out var count) || count < 0) throw new ArgumentException("Native affiliate count is not ready.");
        return count;
    }
    public static object Read(string session, string club, string canCommit, string count, string proposed, string selected)
    {
        var target = Resolve(session, club);
        var flag = Channel(canCommit, session, "CanCommitAffiliateProposal");
        if (!bool.TryParse(flag.Value?.AsString(), out var allowed)) throw new ArgumentException("Native affiliate permission is not ready.");
        return new { ok = true, sessionIdentity = target.GetPersistentIdentity(), canCommitAffiliateProposal = allowed,
            count = Count(Channel(count, session, "Count")),
            proposedAffiliateClubs = LiveTools.DescribeValue(Channel(proposed, session, "ProposedAffiliateClubs").Value, 6),
            selectedAffiliateClub = LiveTools.DescribeValue(Channel(selected, session, "SelectedAffiliateClub").Value),
            draftOnly = true, liveVerified = false };
    }
    private static (InteropReference Target, TypedValue Payload, uint Event, string Scope, string Token) Prepare(
        string action, string session, string club, string canCommit, string count, string proposed, int index)
    {
        var target = Resolve(session, club);
        TypedValue payload = null;
        uint eventId;
        string scope;
        if (action == "select-index")
        {
            var total = Count(Channel(count, session, "Count"));
            if (index < 0 || index >= total) throw new ArgumentException("Select an index inside the current proposed affiliate list.");
            Channel(proposed, session, "ProposedAffiliateClubs");
            payload = TypedValue.Create(index); eventId = 929785399u; scope = "affiliate_proposal_selection";
        }
        else if (action == "propose")
        {
            var flag = Channel(canCommit, session, "CanCommitAffiliateProposal");
            if (!bool.TryParse(flag.Value?.AsString(), out var allowed) || !allowed)
                throw new InvalidOperationException("Game does not allow committing this affiliate proposal.");
            eventId = 1717717618u; scope = "affiliate_proposal_commit";
        }
        else if (action == "cancel-proposal") { eventId = 925986650u; scope = "affiliate_proposal_cancel"; }
        else throw new ArgumentException("Use select-index, propose or cancel-proposal.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action, identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, eventId, scope, token);
    }
    public static object Preview(string action, string session, string club, string canCommit, string count, string proposed, int index)
    {
        var p = Prepare(action, session, club, canCommit, count, proposed, index);
        return new { ok = true, action, nativeEvent = p.Event, choiceToken = p.Token, scope = p.Scope,
            payload = p.Payload == null ? null : LiveTools.DescribeValue(p.Payload), draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string action, string session, string club, string canCommit, string count, string proposed, int index, string token)
    {
        var p = Prepare(action, session, club, canCommit, count, proposed, index);
        if (token != p.Token) throw new InvalidOperationException("Affiliate proposal draft changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "affiliate_" + action, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, p.Scope);
    }
}
