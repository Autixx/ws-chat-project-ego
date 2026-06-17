import type { AuthenticatedUser } from "../auth/authelia.js";
import type { ChatMessage, Conversation } from "../conversations/types.js";
import type { DraftResult } from "../drafts/types.js";

export type ClientMessage =
  | { type: "conversation_create"; title?: string }
  | { type: "conversation_list" }
  | { type: "conversation_open"; conversationId: string }
  | { type: "conversation_rename"; conversationId: string; title: string }
  | { type: "conversation_archive"; conversationId: string }
  | { type: "message_send"; conversationId: string; mode: "chat" | "digest" | "tasks" | "abstract_idea"; text: string; fileName?: string }
  | { type: "digest"; conversationId?: string; text: string; fileName?: string }
  | { type: "tasks"; conversationId?: string; text: string; fileName?: string }
  | { type: "apply"; conversationId: string; jobId: string; expression: string }
  | { type: "discard"; conversationId: string; jobId: string }
  | { type: "show_unclarified"; conversationId?: string }
  | { type: "clarify"; conversationId: string; unclarifiedId: string; text: string };

export type ServerMessage =
  | { type: "connected"; user: Pick<AuthenticatedUser, "username" | "email"> }
  | { type: "conversation_created"; conversation: Conversation }
  | { type: "conversation_list"; conversations: Conversation[] }
  | { type: "conversation_opened"; conversation: Conversation; messages: ChatMessage[] }
  | { type: "conversation_renamed"; conversation: Conversation }
  | { type: "conversation_archived"; conversationId: string }
  | { type: "message_created"; message: ChatMessage }
  | { type: "assistant_message_start"; conversationId: string; messageId: string }
  | { type: "assistant_message_done"; conversationId: string; messageId: string }
  | { type: "status"; conversationId?: string; messageId?: string; jobId?: string; message: string }
  | { type: "token"; conversationId?: string; messageId?: string; jobId?: string; text: string }
  | { type: "draft_saved"; conversationId?: string; messageId?: string; jobId: string; itemsCount: number; preview: string }
  | { type: "draft_result"; conversationId?: string; messageId?: string; jobId: string; result: DraftResult }
  | { type: "apply_result"; conversationId?: string; jobId: string; appliedCount: number; keptCount: number; droppedCount: number; message: string }
  | { type: "unclarified_index"; conversationId?: string; text: string }
  | { type: "error"; message: string; details?: string };

export function parseClientMessage(raw: unknown): ClientMessage {
  if (!raw || typeof raw !== "object") throw new Error("Message must be a JSON object.");
  const msg = raw as Record<string, unknown>;

  if (msg.type === "conversation_create") {
    return { type: "conversation_create", title: typeof msg.title === "string" ? msg.title : undefined };
  }

  if (msg.type === "conversation_list") return { type: "conversation_list" };

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
      fileName: typeof msg.fileName === "string" ? msg.fileName : undefined
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
