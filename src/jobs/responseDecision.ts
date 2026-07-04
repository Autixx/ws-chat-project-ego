import type { AuthenticatedUser } from "../auth/authelia.js";
import type { ChatMessage, ResponseDecisionStatus } from "../conversations/types.js";
import type { ConversationStore } from "../conversations/conversationStore.js";
import type { MessageStore } from "../conversations/messageStore.js";
import type { Job, JobEvent, JobStore } from "./jobStore.js";

export type ResponseDecisionResult = {
  message: ChatMessage;
  job?: Job;
  event?: JobEvent;
};

export async function updateResponseDecision(input: {
  conversations: ConversationStore;
  messages: MessageStore;
  jobs: JobStore;
  user: AuthenticatedUser;
  conversationId: string;
  messageId: string;
  decisionStatus: ResponseDecisionStatus;
}): Promise<ResponseDecisionResult> {
  await input.conversations.loadConversation(input.user, input.conversationId);
  const message = await input.messages.updateMessageMetadata(input.user, input.conversationId, input.messageId, { decisionStatus: input.decisionStatus });
  if (input.decisionStatus !== "applied") return { message };

  const existingJob = (await input.jobs.listJobsForConversation(input.user, input.conversationId)).find((job) => job.responseMessageId === input.messageId);
  if (existingJob) return { message, job: existingJob };

  const job = await input.jobs.createJob({
    conversationId: input.conversationId,
    requestMessageId: typeof message.metadata?.responseToRequestId === "string" ? message.metadata.responseToRequestId : undefined,
    responseMessageId: message.id,
    draftJobId: typeof message.metadata?.jobId === "string" ? message.metadata.jobId : undefined,
    status: "not_started",
    source: "response_apply",
    statusSource: "updateResponseDecision",
    metadata: {
      backend: "none",
      backendConfigured: false,
      decisionStatus: "applied"
    }
  });
  const event = await input.jobs.appendJobEvent(job.id, "created", { message: "Execution job created from Apply decision. No backend workflow is configured yet." });
  return { message, job, event };
}
