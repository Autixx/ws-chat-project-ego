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
  | "chat"
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
