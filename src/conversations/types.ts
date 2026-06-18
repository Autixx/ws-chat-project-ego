export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  user: {
    username: string;
    email?: string;
    name?: string;
  };
  archived?: boolean;
};

export type ChatMessageRole = "user" | "assistant" | "system" | "tool";

export type ChatMessageKind =
  | "request"
  | "response"
  | "status"
  | "token"
  | "draft"
  | "apply_result"
  | "unclarified_index"
  | "error";

export type ChatMessage = {
  id: string;
  conversationId: string;
  createdAt: string;
  role: ChatMessageRole;
  kind: ChatMessageKind;
  content: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
};

export type ResponseDecisionStatus = "pending" | "applied" | "dropped" | "kept";

export type AttachmentMetadata = {
  id: string;
  conversationId: string;
  messageId?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
};
