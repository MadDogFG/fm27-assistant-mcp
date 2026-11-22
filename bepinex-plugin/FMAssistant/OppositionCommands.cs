using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using SI.Core;

namespace FMAssistant;

public static class OppositionCommands
{
    private sealed record Recipe(string Kind, string Value, string Options);
    private static readonly Recipe[] Recipes = {
        new("marking", "OppositionPlayerMarking", "OppositionPlayerMarkingOptions"),
        new("pressing", "OppositionPlayerPressingTrigger", "OppositionPlayerPressingTriggerOptions"),
        new("tackling", "OppositionPlayerTackling", "OppositionPlayerTacklingOptions"),
        new("show-foot", "OppositionPlayerShowOnToFoot", "OppositionPlayerShowOnToFootOptions"),
        new("personalised", "OppositionPlayerPersonalisedInstructionsUsed", null)
    };
    private sealed record Prepared(string Target, LiveTools.Snapshot Current, TypedValue Payload, string Before, string Requested, string Token, string Scope, string OpponentIdentity, string OpponentSource);
    private static string Target(string team, string tactic)
    {
        var root = NegotiationActions.Channel(team, "human", "Team");
        if (root.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the active manager's actual team.");
        var target = LiveTools.GetReference(tactic);
        if (target.GetIl2CppType().FullName == "FM.UI.MatchTacticReference") MatchCommands.RequireCurrentTactic(tactic);
        else { NegotiationActions.Channel(tactic, team, "Tactic"); if (target.GetIl2CppType().FullName != "FM.UI.TeamTacticReference") throw new ArgumentException("Use the actual team or current-match tactic."); }
        return target.GetPersistentIdentity();
    }
    private static Dictionary<string, string> Channels(string text) => JsonSerializer.Deserialize<Dictionary<string, string>>(text)
        ?? throw new ArgumentException("Original opposition subscription channels are required.");
    private static string Selection(TypedValue value)
    {
        var record = NegotiationActions.Record(value);
        return record == null ? value?.AsString() : NegotiationActions.Field(record, "PropertyValue").AsString();
    }
    private static Prepared Prepare(string team, string tactic, string instructions, string rows, string rowPath, string mode, string kind, string channels, string optionPath)
    {
        var recipe = Recipes.SingleOrDefault(item => item.Kind == kind) ?? throw new ArgumentException("Unknown opposition instruction kind.");
        var identity = Target(team, tactic); var handles = Channels(channels);
        string Handle(string name) => handles.TryGetValue(name, out var result) ? result : throw new ArgumentException("Missing opposition channel: " + name);
        var valid = NegotiationActions.Channel(Handle("valid"), tactic, "NextOppositionTacticIsValid");
        if (!bool.TryParse(valid.Value?.AsString(), out var isValid) || !isValid) throw new InvalidOperationException("Game has no valid next opposition tactic.");
        NegotiationActions.Channel(instructions, tactic, "NextOppositionInstructions");
        // The native instruction factory is IDataReference; its type name is not
        // a per-opponent identity. Bind the actual Team references returned by
        // both the original instruction factory and current tactic instead.
        NegotiationActions.Channel(Handle("opponent"), instructions, "Team");
        var opponent = LiveTools.GetReference(Handle("opponent"));
        NegotiationActions.Channel(Handle("nextOpponent"), tactic, "NextOppositionInstructionsTeam");
        var nextOpponent = LiveTools.GetReference(Handle("nextOpponent"));
        if (opponent.GetIl2CppType().FullName != "FM.UI.TeamReference" ||
            nextOpponent.GetIl2CppType().FullName != "FM.UI.TeamReference" ||
            opponent.GetPersistentIdentity() != nextOpponent.GetPersistentIdentity())
            throw new InvalidOperationException("Original instruction rows and current next-opponent tactic belong to different teams.");
        string fixture = null;
        if (handles.TryGetValue("fixture", out var fixtureHandle))
            fixture = NativeValueFingerprint.Compute(NegotiationActions.Channel(fixtureHandle, team, "NextMatchInformation").Value);
        var opponentSource = DispatchJournal.Fingerprint(LiveTools.JsonText(new { opponent = opponent.GetPersistentIdentity(), fixture }));
        var property = mode == "players" ? "OppositionPredictedLineupInstructions" : mode == "positions" ? "OppositionAllPositionsInstructions" : throw new ArgumentException("Unknown opposition target list.");
        var rowList = NegotiationActions.Channel(rows, instructions, property);
        var rowsFingerprint = NativeValueFingerprint.Compute(rowList.Value);
        var rowFingerprint = NativeValueFingerprint.Compute(LiveTools.GetValue(rows, rowPath));
        var index = NegotiationActions.Channel(Handle("index"), rows, "Index", rowPath);
        var position = NegotiationActions.Channel(Handle("position"), rows, "Position", rowPath);
        var current = NegotiationActions.Channel(Handle("current"), tactic, recipe.Value);
        if (current.Identity != identity) throw new ArgumentException("Opposition setter source changed.");
        LiveTools.Snapshot options = null;
        if (recipe.Options != null)
        {
            options = NegotiationActions.Channel(Handle("options"), tactic, recipe.Options);
            if (options.Identity != identity) throw new ArgumentException("Opposition choices source changed.");
        }
        void Context(string name, TypedValue original)
        {
            var actual = current.Contexts.Where(pair => pair.Key.Equals(name, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (actual.Length != 1 || actual[0].Value != original.AsString()) throw new ArgumentException("Opposition setter has wrong row context: " + name);
        }
        Context("teamselectionindex", index.Value);
        // The per-player personalised toggle can be keyed by selection index alone.
        // Position-based instructions still require their native position context.
        if (kind != "personalised" || mode != "players" ||
            current.Contexts.Keys.Any(key => key.Equals("positionmask", StringComparison.OrdinalIgnoreCase)))
            Context("positionmask", position.Value);
        if (options != null)
        {
            foreach (var pair in options.ContextDescriptions)
            {
                if (current.ContextDescriptions.TryGetValue(pair.Key, out var same))
                {
                    if (same != pair.Value) throw new ArgumentException("Opposition choices and setter have different context: " + pair.Key);
                    continue;
                }
                // A context-free options list is valid; an options-only manager
                // or team context must still be the actual owner, never another UI subject.
                var expected = pair.Key.Equals("human", StringComparison.OrdinalIgnoreCase) ? LiveTools.GetReference("human").GetPersistentIdentity() :
                    pair.Key.Equals("team", StringComparison.OrdinalIgnoreCase) ? LiveTools.GetReference(team).GetPersistentIdentity() : null;
                using var description = JsonDocument.Parse(pair.Value);
                // A null context value is described as JSON null; it never carries a source reference.
                if (expected == null || description.RootElement.ValueKind != JsonValueKind.Object ||
                    description.RootElement.GetProperty("kind").GetString() != "reference" ||
                    description.RootElement.GetProperty("identity").GetString() != expected)
                    throw new ArgumentException("Opposition choices contain an unmatched source context: " + pair.Key);
            }
        }
        foreach (var context in current.ContextDescriptions.Where(pair => pair.Key.Equals("selectedobjectlist", StringComparison.OrdinalIgnoreCase)))
        {
            using var description = JsonDocument.Parse(context.Value);
            var root = description.RootElement;
            // The single-target setter is only valid with an empty/null selection list.
            // A null context value is serialized as JSON null, not as {"kind":"null"}.
            if (root.ValueKind == JsonValueKind.Null) continue;
            if (root.ValueKind != JsonValueKind.Object) continue;
            var contextKind = root.GetProperty("kind").GetString();
            if (contextKind != "null" && !(contextKind == "list" && root.GetProperty("count").GetInt32() == 0))
                throw new ArgumentException("Single-target opposition commands cannot affect another selected object list.");
        }
        TypedValue payload;
        if (recipe.Options == null)
        {
            if (!bool.TryParse(optionPath, out var enabled) || current.Value?.DataType?.FullName != "System.Boolean")
                throw new ArgumentException("Personalised instructions require one of the UI's boolean choices.");
            payload = TypedValue.Create(enabled);
        }
        else payload = NativeChoiceTree.Leaf(Handle("options"), optionPath);
        var before = Selection(current.Value); var desired = Selection(payload);
        var rowKey = NativeValueFingerprint.Compute(index.Value) + ":" + NativeValueFingerprint.Compute(position.Value);
        var scope = "opposition_instruction_draft." + kind + "." + DispatchJournal.Fingerprint(opponentSource + ":" + rowKey);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), tactic = identity, opponentSource, rowsFingerprint, rowFingerprint, mode, kind, rowKey,
            before = NativeValueFingerprint.Compute(current.Value), payload = NativeValueFingerprint.Compute(payload) }));
        return new(identity, current, payload, before, desired, token, scope, opponent.GetPersistentIdentity(), opponentSource);
    }
    public static object Preview(string team, string tactic, string instructions, string rows, string rowPath, string mode, string kind, string channels, string optionPath)
    {
        var p = Prepare(team, tactic, instructions, rows, rowPath, mode, kind, channels, optionPath);
        return new { ok = true, kind, before = p.Before, requested = p.Requested, choiceToken = p.Token,
            opponentIdentity = p.OpponentIdentity, opponentSourceFingerprint = p.OpponentSource,
            option = LiveTools.DescribeValue(p.Payload), verificationScope = p.Scope, liveVerified = false };
    }
    public static object Execute(string id, string team, string tactic, string instructions, string rows, string rowPath, string mode, string kind, string channels, string optionPath, string token)
    {
        var p = Prepare(team, tactic, instructions, rows, rowPath, mode, kind, channels, optionPath);
        if (p.Token != token) throw new InvalidOperationException("Opposition target, setting or option changed; preview again.");
        return ActionCommands.DispatchDomain(id, "opposition_instruction." + kind, p.Target, token,
            () => LiveTools.UpdateProperty(Channels(channels)["current"], TypedValue.CreateCopyFrom(p.Payload)), p.Before, p.Requested, p.Scope);
    }
}
