import type { AuthenticatedUser } from "../auth/authelia.js";
import type { DraftResult } from "../drafts/types.js";

export type LlmTaskMode = "structured_breakdown" | "create_tasks" | "abstract_idea";

export type LlmAttachmentInput = {
  id: string;
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
};

export type LlmTaskInput = {
  mode: LlmTaskMode;
  text: string;
  source: string;
  fileName?: string;
  attachments?: LlmAttachmentInput[];
  user: AuthenticatedUser;
};

export type LlmStreamEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "result"; result: DraftResult }
  | { type: "error"; message: string }
  | { type: "done" };

export interface LlmProvider {
  runProjectEgoTask(input: LlmTaskInput): AsyncGenerator<LlmStreamEvent>;
}
