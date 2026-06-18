import type { AuthenticatedUser } from "../auth/authelia.js";
import type { ConversationStore } from "../conversations/conversationStore.js";
import type { DraftStore } from "../drafts/draftStore.js";
import type { DraftResult } from "../drafts/types.js";

export type DraftOpenPayloads = {
  saved: {
    type: "draft_saved";
    conversationId: string;
    jobId: string;
    itemsCount: number;
    preview: string;
  };
  result: {
    type: "draft_result";
    conversationId: string;
    jobId: string;
    result: DraftResult;
  };
};

export async function openReferencedDraft(input: {
  conversations: ConversationStore;
  drafts: DraftStore;
  user: AuthenticatedUser;
  conversationId: string;
  jobId: string;
}): Promise<DraftOpenPayloads> {
  await input.conversations.loadConversation(input.user, input.conversationId);
  if (!(await input.conversations.hasDraftRef(input.user, input.conversationId, input.jobId))) {
    throw new Error("Draft is not referenced by this conversation.");
  }
  const loaded = await input.drafts.loadDraftWithPreview(input.jobId, input.user);
  return {
    saved: {
      type: "draft_saved",
      conversationId: input.conversationId,
      jobId: loaded.draft.jobId,
      itemsCount: loaded.draft.result.items.length,
      preview: loaded.preview
    },
    result: {
      type: "draft_result",
      conversationId: input.conversationId,
      jobId: loaded.draft.jobId,
      result: loaded.draft.result
    }
  };
}
