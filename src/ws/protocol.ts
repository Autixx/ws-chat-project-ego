import type { AuthenticatedUser } from "../auth/authelia.js";
import type { DraftResult } from "../drafts/types.js";

export type ClientMessage =
  | { type: "digest"; text: string; fileName?: string }
  | { type: "tasks"; text: string; fileName?: string }
  | { type: "apply"; jobId: string; expression: string }
  | { type: "discard"; jobId: string }
  | { type: "show_unclarified" }
  | { type: "clarify"; unclarifiedId: string; text: string };

export type ServerMessage =
  | { type: "connected"; user: Pick<AuthenticatedUser, "username" | "email"> }
  | { type: "status"; jobId: string; message: string }
  | { type: "token"; jobId: string; text: string }
  | { type: "draft_saved"; jobId: string; itemsCount: number; preview: string }
  | { type: "draft_result"; jobId: string; result: DraftResult }
  | { type: "apply_result"; jobId: string; appliedCount: number; keptCount: number; droppedCount: number; message: string }
  | { type: "unclarified_index"; text: string }
  | { type: "error"; message: string; details?: string };

export function parseClientMessage(raw: unknown): ClientMessage {
  if (!raw || typeof raw !== "object") throw new Error("Message must be a JSON object.");
  const msg = raw as Record<string, unknown>;

  if (msg.type === "digest" || msg.type === "tasks") {
    if (typeof msg.text !== "string" || msg.text.trim().length === 0) {
      throw new Error("Text is required.");
    }
    return {
      type: msg.type,
      text: msg.text,
      fileName: typeof msg.fileName === "string" ? msg.fileName : undefined
    };
  }

  if (msg.type === "apply") {
    if (typeof msg.jobId !== "string" || typeof msg.expression !== "string") {
      throw new Error("Apply requires jobId and expression.");
    }
    return { type: "apply", jobId: msg.jobId, expression: msg.expression };
  }

  if (msg.type === "discard") {
    if (typeof msg.jobId !== "string") throw new Error("Discard requires jobId.");
    return { type: "discard", jobId: msg.jobId };
  }

  if (msg.type === "show_unclarified") return { type: "show_unclarified" };

  if (msg.type === "clarify") {
    if (typeof msg.unclarifiedId !== "string" || typeof msg.text !== "string") {
      throw new Error("Clarify requires unclarifiedId and text.");
    }
    return { type: "clarify", unclarifiedId: msg.unclarifiedId, text: msg.text };
  }

  throw new Error("Unsupported message type.");
}
