import { createLiveClient } from "./live-client.mjs";

// Request the full staff-meeting advice collection (event 1397301300, target=human, data=null).
export function createStaffAdviceTools(call) {
  const client = createLiveClient(call);
  return {
    preview: args => client.scope(async scope =>
      ({ ...await scope.api("/api/v1/staff-advice/full-preview"), draftOnly: true, liveVerified: false })),
    request: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return client.scope(async scope => {
        const preview = await scope.api("/api/v1/staff-advice/full-preview");
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("经理状态变化，请重新预览。");
        return { ...await scope.api("/api/v1/staff-advice/full-execute",
          { id: args.operationId, choiceToken: args.expectedChoiceToken }, true), adviceCollected: false };
      });
    }
  };
}
