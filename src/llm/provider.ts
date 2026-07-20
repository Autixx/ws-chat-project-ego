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

export type DraftAttachment = Omit<LlmAttachmentInput, "kind"> & { kind: "image" };

export type SourceFileInfo = {
  fileName: string;
  kind: "text" | "image" | "unsupported";
  mimeType?: string;
  sizeBytes?: number;
  included_in_text?: boolean;
  included_as_attachment?: boolean;
  attachment_id?: string;
  skipped?: boolean;
  reason?: string;
};

export type DraftWarning = {
  code: string;
  message: string;
  fileName?: string;
};

export type LlmTaskInput = {
  mode: LlmTaskMode;
  text: string;
  source: string;
  fileName?: string;
  attachments?: LlmAttachmentInput[];
  sourceFiles?: SourceFileInfo[];
  warnings?: DraftWarning[];
  clientRequestId?: string;
  threadId?: string;
  user: AuthenticatedUser;
};

export type DashboardDraftRequest = {
  client_request_id: string;
  thread_id: string;
  mode: LlmTaskMode;
  source: "dashboard";
  text: string;
  attachments: DraftAttachment[];
  source_files: SourceFileInfo[];
  warnings: DraftWarning[];
};

export type CodexTrace = {
  clientRequestId: string;
  threadId: string;
  source: string;
  mode: LlmTaskMode;
  inputText: string;
  status: string;
  codexJobId?: string;
  codexInternalSessionId?: string;
  codexSessionId?: string;
  sessionTurnCount?: number;
  sessionRotated?: boolean;
  result?: unknown;
  warnings?: unknown[];
  error?: string;
  completedAt?: string;
};

export type LlmStreamEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "result"; result: DraftResult; trace?: CodexTrace }
  | { type: "error"; message: string; trace?: CodexTrace }
  | { type: "done" };

export interface LlmProvider {
  runProjectEgoTask(input: LlmTaskInput): AsyncGenerator<LlmStreamEvent>;
}
