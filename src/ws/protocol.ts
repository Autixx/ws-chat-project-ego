import type { AuthenticatedUser } from "../auth/authelia.js";
import type { AttachmentMetadata, ChatMessage, Conversation } from "../conversations/types.js";
import type { DraftResult } from "../drafts/types.js";
import type { Job, JobEvent } from "../jobs/jobStore.js";

export type ClientMessage =
  | { type: "conversation_create"; title?: string }
  | { type: "conversation_list"; includeArchived?: boolean }
  | { type: "conversation_open"; conversationId: string }
  | { type: "conversation_rename"; conversationId: string; title: string }
  | { type: "conversation_archive"; conversationId: string }
  | { type: "conversation_unarchive"; conversationId: string }
  | { type: "conversation_delete"; conversationId: string }
  | {
      type: "message_send";
      conversationId: string;
      mode: "chat" | "digest" | "tasks" | "abstract_idea";
      text: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
      attachmentUploadIds?: string[];
    }
  | { type: "draft_open"; conversationId: string; jobId: string }
  | { type: "job_list"; conversationId: string }
  | { type: "attachments_for_request"; conversationId: string; requestId: string }
  | { type: "response_decision_update"; conversationId: string; messageId: string; decisionStatus: "pending" | "applied" | "dropped" | "kept" }
  | { type: "digest"; conversationId?: string; text: string; fileName?: string }
  | { type: "tasks"; conversationId?: string; text: string; fileName?: string }
  | { type: "apply"; conversationId: string; jobId: string; expression: string }
  | { type: "discard"; conversationId: string; jobId: string }
  | { type: "show_unclarified"; conversationId?: string }
  | { type: "clarify"; conversationId: string; unclarifiedId: string; text: string };

export type ServerMessage =
  | { type: "connected"; user: Pick<AuthenticatedUser, "username" | "email"> }
  | { type: "conversation_created"; conversation: Conversation }
  | { type: "conversation_list"; conversations: Conversation[]; includeArchived?: boolean }
  | { type: "conversation_opened"; conversation: Conversation; messages: ChatMessage[]; attachments: AttachmentMetadata[]; jobs?: Job[] }
  | { type: "attachments_for_request"; conversationId: string; requestId: string; attachments: AttachmentMetadata[] }
  | { type: "job_list"; conversationId: string; jobs: Job[] }
  | { type: "job_created"; job: Job }
  | { type: "job_updated"; job: Job }
  | { type: "job_event"; jobId: string; event: JobEvent }
  | {
      type: "app_status";
      db: { status: "ok" | "error"; path?: string; quickCheck?: string; writable?: boolean; message?: string };
      llmAgent: { status: string; checkedAt?: string; latencyMs?: number; message?: string; lastError?: string };
      plane: { status: string; checkedAt?: string; latencyMs?: number; message?: string; lastError?: string };
      n8n: { status: string; checkedAt?: string; latencyMs?: number; message?: string; lastError?: string };
      jobs?: { callbackConfigured: boolean };
    }
  | { type: "conversation_renamed"; conversation: Conversation }
  | { type: "conversation_archived"; conversationId: string }
  | { type: "conversation_unarchived"; conversation: Conversation }
  | { type: "conversation_deleted"; conversationId: string }
  | { type: "message_created"; message: ChatMessage }
  | { type: "assistant_message_start"; conversationId: string; messageId: string }
  | { type: "assistant_message_done"; conversationId: string; messageId: string }
  | { type: "status"; conversationId?: string; messageId?: string; jobId?: string; message: string }
  | { type: "token"; conversationId?: string; messageId?: string; jobId?: string; text: string }
  | { type: "draft_saved"; conversationId?: string; messageId?: string; jobId: string; itemsCount: number; preview: string }
  | { type: "draft_result"; conversationId?: string; messageId?: string; jobId: string; result: DraftResult }
  | { type: "response_decision_updated"; conversationId: string; message: ChatMessage }
  | { type: "apply_result"; conversationId?: string; jobId: string; appliedCount: number; keptCount: number; droppedCount: number; message: string }
  | { type: "unclarified_index"; conversationId?: string; text: string }
  | { type: "error"; message: string; details?: string };

export function parseClientMessage(raw: unknown): ClientMessage {
  if (!raw || typeof raw !== "object") throw new Error("Message must be a JSON object.");
  const msg = raw as Record<string, unknown>;

  if (msg.type === "conversation_create") {
    return { type: "conversation_create", title: typeof msg.title === "string" ? msg.title : undefined };
  }

  if (msg.type === "conversation_list") return { type: "conversation_list", includeArchived: Boolean(msg.includeArchived) };

  if (msg.type === "conversation_open") {
    if (typeof msg.conversationId !== "string") throw new Error("conversation_open requires conversationId.");
    return { type: "conversation_open", conversationId: msg.conversationId };
  }

  if (msg.type === "conversation_rename") {
    if (typeof msg.conversationId !== "string" || typeof msg.title !== "string") {
      throw new Error("conversation_rename requires conversationId and title.");
    }
    return { type: "conversation_rename", conversationId: msg.conversationId, title: msg.title };
  }

  if (msg.type === "conversation_archive") {
    if (typeof msg.conversationId !== "string") throw new Error("conversation_archive requires conversationId.");
    return { type: "conversation_archive", conversationId: msg.conversationId };
  }

  if (msg.type === "conversation_unarchive") {
    if (typeof msg.conversationId !== "string") throw new Error("conversation_unarchive requires conversationId.");
    return { type: "conversation_unarchive", conversationId: msg.conversationId };
  }

  if (msg.type === "conversation_delete") {
    if (typeof msg.conversationId !== "string") throw new Error("conversation_delete requires conversationId.");
    return { type: "conversation_delete", conversationId: msg.conversationId };
  }

  if (msg.type === "message_send") {
    if (typeof msg.conversationId !== "string" || typeof msg.text !== "string" || msg.text.trim().length === 0) {
      throw new Error("message_send requires conversationId and text.");
    }
    if (!["chat", "digest", "tasks", "abstract_idea"].includes(String(msg.mode))) {
      throw new Error("Unsupported message_send mode.");
    }
    return {
      type: "message_send",
      conversationId: msg.conversationId,
      mode: msg.mode as "chat" | "digest" | "tasks" | "abstract_idea",
      text: msg.text,
      fileName: typeof msg.fileName === "string" ? msg.fileName : undefined,
      fileSize: typeof msg.fileSize === "number" ? msg.fileSize : undefined,
      mimeType: typeof msg.mimeType === "string" ? msg.mimeType : undefined,
      attachmentUploadIds: Array.isArray(msg.attachmentUploadIds) ? msg.attachmentUploadIds.filter((id): id is string => typeof id === "string") : undefined
    };
  }

  if (msg.type === "draft_open") {
    if (typeof msg.conversationId !== "string" || typeof msg.jobId !== "string") {
      throw new Error("draft_open requires conversationId and jobId.");
    }
    return { type: "draft_open", conversationId: msg.conversationId, jobId: msg.jobId };
  }

  if (msg.type === "job_list") {
    if (typeof msg.conversationId !== "string") throw new Error("job_list requires conversationId.");
    return { type: "job_list", conversationId: msg.conversationId };
  }

  if (msg.type === "attachments_for_request") {
    if (typeof msg.conversationId !== "string" || typeof msg.requestId !== "string") {
      throw new Error("attachments_for_request requires conversationId and requestId.");
    }
    return { type: "attachments_for_request", conversationId: msg.conversationId, requestId: msg.requestId };
  }

  if (msg.type === "response_decision_update") {
    if (
      typeof msg.conversationId !== "string" ||
      typeof msg.messageId !== "string" ||
      !["pending", "applied", "dropped", "kept"].includes(String(msg.decisionStatus))
    ) {
      throw new Error("response_decision_update requires conversationId, messageId and valid decisionStatus.");
    }
    return {
      type: "response_decision_update",
      conversationId: msg.conversationId,
      messageId: msg.messageId,
      decisionStatus: msg.decisionStatus as "pending" | "applied" | "dropped" | "kept"
    };
  }

  if (msg.type === "digest" || msg.type === "tasks") {
    if (typeof msg.text !== "string" || msg.text.trim().length === 0) {
      throw new Error("Text is required.");
    }
    return {
      type: msg.type,
      conversationId: typeof msg.conversationId === "string" ? msg.conversationId : undefined,
      text: msg.text,
      fileName: typeof msg.fileName === "string" ? msg.fileName : undefined
    };
  }

  if (msg.type === "apply") {
    if (typeof msg.conversationId !== "string" || typeof msg.jobId !== "string" || typeof msg.expression !== "string") {
      throw new Error("Apply requires conversationId, jobId and expression.");
    }
    return { type: "apply", conversationId: msg.conversationId, jobId: msg.jobId, expression: msg.expression };
  }

  if (msg.type === "discard") {
    if (typeof msg.conversationId !== "string" || typeof msg.jobId !== "string") throw new Error("Discard requires conversationId and jobId.");
    return { type: "discard", conversationId: msg.conversationId, jobId: msg.jobId };
  }

  if (msg.type === "show_unclarified") {
    return { type: "show_unclarified", conversationId: typeof msg.conversationId === "string" ? msg.conversationId : undefined };
  }

  if (msg.type === "clarify") {
    if (typeof msg.conversationId !== "string" || typeof msg.unclarifiedId !== "string" || typeof msg.text !== "string") {
      throw new Error("Clarify requires conversationId, unclarifiedId and text.");
    }
    return { type: "clarify", conversationId: msg.conversationId, unclarifiedId: msg.unclarifiedId, text: msg.text };
  }

  throw new Error("Unsupported message type.");
}
