import type { AuthenticatedUser } from "../auth/authelia.js";
import type { ConversationStore } from "../conversations/conversationStore.js";
import type { MessageStore } from "../conversations/messageStore.js";
import type { DraftItem, StoredDraft } from "../drafts/types.js";
import { draftItemId, mapDraftItemForN8n, type N8nApplyPayload } from "../integrations/n8nApplyClient.js";
import type { Job, JobEvent, JobStore } from "./jobStore.js";

export type DraftApplyEntry = {
  itemNumber: number;
  itemIndex: number;
  item: DraftItem;
};

export type DraftApplyJobResult = {
  job: Job;
  event: JobEvent;
  payload: N8nApplyPayload;
  selectedDraftItemIds: string[];
};

export async function createDraftApplyJob(input: {
  conversations: ConversationStore;
  messages: MessageStore;
  jobs: JobStore;
  user: AuthenticatedUser;
  conversationId: string;
  draft: StoredDraft;
  applyEntries: DraftApplyEntry[];
  selection: Record<string, unknown>;
  backendConfigured: boolean;
}): Promise<DraftApplyJobResult> {
  const draftRef = await input.conversations.loadDraftRef(input.user, input.conversationId, input.draft.jobId);
  const draftMessage = draftRef.messageId ? await input.messages.loadMessage(input.user, input.conversationId, draftRef.messageId) : undefined;
  const requestMessageId = typeof draftMessage?.metadata?.responseToRequestId === "string" ? draftMessage.metadata.responseToRequestId : undefined;
  const responseMessageId = draftRef.messageId ?? input.draft.jobId;
  const selectedDraftItemIds = input.applyEntries.map((entry) => draftItemId(responseMessageId, entry.itemIndex, persistedDraftItemId(entry.item)));
  const job = await input.jobs.createJob({
    conversationId: input.conversationId,
    requestMessageId,
    responseMessageId: draftRef.messageId,
    draftJobId: input.draft.jobId,
    status: "queued",
    source: "n8n_apply",
    statusSource: "createDraftApplyJob",
    metadata: {
      backend: "n8n",
      selectedDraftItemIds,
      selection: input.selection,
      source: {
        provider: "codex",
        codexAgentJobId: input.draft.jobId,
        mode: input.draft.mode
      },
      backendConfigured: input.backendConfigured
    }
  });
  const event = await input.jobs.appendJobEvent(job.id, "created", {
    message: "n8n apply job created.",
    selectedDraftItemIds
  });
  const payload: N8nApplyPayload = {
    jobId: job.id,
    conversationId: input.conversationId,
    requestMessageId,
    responseMessageId: draftRef.messageId,
    source: {
      provider: "codex",
      codexAgentJobId: input.draft.jobId,
      mode: input.draft.mode
    },
    items: input.applyEntries.map((entry) => mapDraftItemForN8n(responseMessageId, entry.itemIndex, entry.item))
  };
  return { job, event, payload, selectedDraftItemIds };
}

function persistedDraftItemId(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (typeof record.draftItemId === "string") return record.draftItemId;
  if (typeof record.id === "string") return record.id;
  return undefined;
}
