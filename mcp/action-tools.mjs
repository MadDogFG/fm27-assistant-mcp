import { randomUUID } from "node:crypto";
import { createLiveClient, clean, scalar } from "./live-client.mjs";
import { resolveNegotiationSession } from "./negotiation-tools.mjs";

export function createActionTools(call) {
  const client = createLiveClient(call);
  async function context(args, action) {
    if (!args.source && !Number.isInteger(args.squadIndex)) throw new Error("请提供球员实时引用 source 或一线队序号 squadIndex。");
    return client.scope(async scope => {
      const resolved = await scope.resolvePlayerRef(args);
      const subject = { source: resolved.source, path: resolved.path };
      const team = resolved.team || await scope.subscribe("human", "Team");
      const contexts = { Human: { source: "human" }, Team: { source: team.handle },
        human: { source: "human" }, team: { source: team.handle }, Records: [{ $reference: subject }] };
      const offered = await scope.subscribe("game", "Actions", contexts);
      const choices = await scope.api("/api/v1/actions/offered", { offered: offered.handle });
      if (args.action === undefined) return action({ scope, offered, choices, team, subject });
      const matched = choices.actions.filter(a => a.id === args.action || a.name === args.action);
      if (matched.length !== 1) throw new Error("请选择 get_player_actions 当前返回的 action 名称或 ID。");
      const chosen = matched[0];
      const reference = await scope.subscribe("game", "Action", { ...contexts, ID: { $u32: chosen.id } });
      const items = await scope.subscribe(reference.handle, "Items", contexts);
      return action({ scope, offered, choices, chosen, reference, items, subject, team });
    });
  }

  async function contractDraft(args, perform) {
    if (!Array.isArray(args.entry) || !args.entry.length || args.entry.some(n => !Number.isInteger(n) || n < 0))
      throw new Error("先读取 PersonOfferContract 原菜单，再提供开始协商的 entry。");
    return context({ ...args, action: "PersonOfferContract" }, async ({ scope, offered, reference, items, subject }) => {
      const human = { source: "human" };
      const club = await scope.subscribe("human", "Club");
      const buyingClub = { source: club.handle };
      const contexts = { Human: human, human, BuyingClub: buyingClub, buyingclub: buyingClub, Club: buyingClub, club: buyingClub,
        Person: subject, person: subject, Player: subject, player: subject };
      const session = await scope.subscribe(subject, "ContractEditSession", contexts);
      return perform(scope, { offered: offered.handle, action: reference.handle, items: items.handle, entry: args.entry,
        session: session.handle, club: club.handle }, contexts);
    });
  }

  async function transferDraft(args, perform) {
    return context(args, async ({ scope, offered, team, subject }) => {
      const { session, club, contexts } = await resolveNegotiationSession(scope, { domain: "transfer", source: subject.source, path: subject.path });
      const teamRef = { source: team.handle };
      const allowed = await scope.subscribe(subject, "CanHumanMakeTransferOffer", { ...contexts, Team: teamRef, team: teamRef });
      return perform(scope, { session: session.handle, club: club.handle, selling: contexts.SellingClub.source,
        offered: offered.handle, allowed: allowed.handle }, contexts);
    });
  }

  async function requestDraft(scope, route, args, query, observe) {
    const result = await scope.api(`/api/v1/${route}/open-draft`, { ...query, choiceToken: args.expectedChoiceToken, id: args.operationId }, true);
    const receipt = result.receipt || result, handle = result.query?.handle;
    if (receipt.status !== "dispatched_unverified" || !handle) return receipt;
    try {
      await scope.ready(handle);
      return await observe(handle);
    } catch (error) { return { ...receipt, verificationError: String(error.message || error) }; }
    finally {
      try { await scope.api("/api/v1/live/close", { handle }, true); } catch { /* the game also expires the transient query */ }
    }
  }

  return {
    initiation: () => client.api("/api/v1/actions/initiation"),
    contractDraftPreview: args => contractDraft(args, (scope, query) => scope.api("/api/v1/contracts/draft-start-preview", query)),
    openContractDraft: async args => {
      if (!args.expectedChoiceToken || !args.operationId) throw new Error("需要原预览 token 与固定 operationId。");
      return contractDraft(args, async (scope, query, contexts) => ({
        ...await requestDraft(scope, "contracts", args, query, async () => {
          const readOnly = await scope.subscribe(query.session, "NegotiationReadOnly", contexts);
          const willing = await scope.subscribe(query.session, "IsWillingToEnterNegotiations", contexts);
          const wage = await scope.subscribe(query.session, "Wage", contexts);
          return await scope.api("/api/v1/contracts/draft-observation", { operationId: args.operationId, session: query.session,
            club: query.club, readOnly: readOnly.handle, willing: willing.handle, wage: wage.handle });
        }), operationSubmitsContract: false
      }));
    },
    transferDraftPreview: args => transferDraft(args, (scope, query) => scope.api("/api/v1/transfers/draft-start-preview", query)),
    openTransferDraft: async args => {
      if (!args.expectedChoiceToken || !args.operationId) throw new Error("需要报价草稿预览 token 与固定 operationId。");
      return transferDraft(args, async (scope, query, contexts) => ({
        ...await requestDraft(scope, "transfers", args, query, async buying => {
          const editable = await scope.subscribe(query.session, "CanMakeChangesToOffer", contexts);
          const offerType = await scope.subscribe(query.session, "TransferOfferTypeDropdownSelection", contexts);
          return scope.api("/api/v1/transfers/draft-observation", { operationId: args.operationId, session: query.session,
            club: query.club, buying, editable: editable.handle, offerType: offerType.handle });
        }), operationSubmitsOffer: false
      }));
    },
    offered: args => context(args, async ({ choices }) => choices),
    menu: args => context(args, async ({ scope, offered, chosen, reference, items }) => {
      const keys = Object.fromEntries(await Promise.all(["Text", "Event", "Disabled", "RowData", "ChildList", "ActionData"].map(async name => [name, await scope.propertyId(name)])));
      const entries = [];
      function visit(list, indices = [], labels = [], disabled = false) {
        if (list?.kind !== "list") return;
        for (const [index, outer] of (list.items || []).entries()) {
          const row = outer?.fields?.[keys.RowData] || outer;
          const fields = row?.fields || {};
          const label = clean(scalar(fields[keys.Text]) ?? scalar(outer?.fields?.[keys.Text]));
          const path = [...indices, index];
          const blocked = disabled || scalar(fields[keys.Disabled])?.toLowerCase() === "true" || scalar(outer?.fields?.[keys.Disabled])?.toLowerCase() === "true";
          const children = outer?.fields?.[keys.ChildList] || fields[keys.ChildList];
          entries.push({ entry: path, label: [...labels, label].filter(Boolean).join(" > "), disabled: blocked,
            executableLeaf: scalar(fields[keys.Event]) === "44" && Boolean(fields[keys.ActionData]) });
          visit(children, path, [...labels, label], blocked);
        }
      }
      visit(items.read.value);
      if (args.entry) {
        const preview = await scope.api("/api/v1/actions/preview", { offered: offered.handle, action: reference.handle, items: items.handle, entry: args.entry });
        return { ...preview, action: chosen.name };
      }
      return { ok: true, action: chosen, entries, truncated: hasTruncation(items.read.value),
        note: "只展示游戏原生菜单；是否可静默执行及确认要求须读取具体 entry 预览。" };
    }),
    execute: args => context(args, async ({ scope, offered, chosen, reference, items, subject }) => {
      if (!chosen.silentExecutionImplemented) throw new Error("此动作的静默执行流程尚未实现。");
      if (!Array.isArray(args.entry) || !args.entry.length || args.entry.some(n => !Number.isInteger(n) || n < 0)) throw new Error("entry 必须为菜单各层的非负整数下标数组。");
      const query = { offered: offered.handle, action: reference.handle, items: items.handle, entry: args.entry, source: subject.source, path: subject.path };
      const preview = await scope.api("/api/v1/actions/preview", query);
      if (preview.disabled) throw new Error("游戏禁用了该选项。");
      if (preview.requiresConfirmationProtocol) throw new Error("该选项需要尚未恢复的静默确认流程。");
      if (args.expectedChoiceToken && args.expectedChoiceToken !== preview.choiceToken) throw new Error("游戏的动作载荷已变化，请重新读取菜单。");
      const receipt = await scope.api("/api/v1/actions/execute", { ...query, id: args.operationId || randomUUID(),
        expectedRevision: preview.revision, expectedChoiceToken: preview.choiceToken }, true);
      return { ...receipt, action: chosen.name, note: "派发回执不证明游戏接受；必须重新读取球员或相应任务状态确认。" };
    })
  };
}

function hasTruncation(node) {
  if (!node || typeof node !== "object") return false;
  if (node.truncated) return true;
  return Object.values(node).some(value => Array.isArray(value) ? value.some(hasTruncation) : hasTruncation(value));
}
