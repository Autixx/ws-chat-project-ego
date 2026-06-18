import type { AuthenticatedUser } from "../auth/authelia.js";
import type { AppDatabase } from "../db/database.js";
import { createId, safeUserId } from "../utils/ids.js";
import { ConversationStore } from "./conversationStore.js";
import type { ChatMessage, ChatMessageKind, ChatMessageRole } from "./types.js";

type MessageRow = {
  id: string;
  conversation_id: string;
  role: ChatMessageRole;
  kind: ChatMessageKind;
  content: string;
  created_at: string;
  job_id: string | null;
  metadata_json: string | null;
};

export class MessageStore {
  private readonly conversations: ConversationStore;

  constructor(private readonly database: AppDatabase) {
    this.conversations = new ConversationStore(database);
  }

  appendMessage(message: ChatMessage): Promise<void> {
    this.database.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, user_id, role, kind, content, created_at, job_id, metadata_json)
         VALUES (@id, @conversationId, @userId, @role, @kind, @content, @createdAt, @jobId, @metadataJson)`
      )
      .run({
        id: message.id,
        conversationId: message.conversationId,
        userId: String(message.metadata?.userId ?? ""),
        role: message.role,
        kind: message.kind,
        content: message.content,
        createdAt: message.createdAt,
        jobId: message.jobId ?? null,
        metadataJson: message.metadata ? JSON.stringify(message.metadata) : null
      });
    return Promise.resolve();
  }

  updateMessageContent(message: ChatMessage, content: string): Promise<ChatMessage> {
    const updated = { ...message, content };
    this.database.db.prepare("UPDATE messages SET content = ? WHERE id = ? AND conversation_id = ?").run(content, message.id, message.conversationId);
    return Promise.resolve(updated);
  }

  updateMessageMetadata(user: AuthenticatedUser, messageId: string, metadataPatch: Record<string, unknown>): Promise<ChatMessage> {
    const row = this.database.db
      .prepare(
        `SELECT m.id, m.conversation_id, m.role, m.kind, m.content, m.created_at, m.job_id, m.metadata_json
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = ? AND c.user_id = ?`
      )
      .get(messageId, safeUserId(user.username)) as MessageRow | undefined;
    if (!row) return Promise.reject(new Error("Message not found."));
    const message = rowToMessage(row);
    const metadata = { ...(message.metadata ?? {}), ...metadataPatch };
    this.database.db.prepare("UPDATE messages SET metadata_json = ? WHERE id = ?").run(JSON.stringify(metadata), messageId);
    return Promise.resolve({ ...message, metadata });
  }

  async loadMessages(user: AuthenticatedUser, conversationId: string, limit = 200, before?: string): Promise<ChatMessage[]> {
    await this.conversations.loadConversation(user, conversationId);
    const params: unknown[] = [conversationId];
    let beforeClause = "";
    if (before) {
      const beforeRow = this.database.db.prepare("SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?").get(before, conversationId) as
        | { created_at: string }
        | undefined;
      if (beforeRow) {
        beforeClause = "AND created_at < ?";
        params.push(beforeRow.created_at);
      }
    }
    params.push(limit);
    const rows = this.database.db
      .prepare(
        `SELECT id, conversation_id, role, kind, content, created_at, job_id, metadata_json
         FROM messages
         WHERE conversation_id = ? ${beforeClause}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(...params) as MessageRow[];
    return rows.reverse().map(rowToMessage);
  }

  appendUserMessage(conversationId: string, user: AuthenticatedUser, content: string, metadata?: Record<string, unknown>): Promise<ChatMessage> {
    return this.appendRoleMessage(conversationId, user, "user", "request", content, metadata);
  }

  appendAssistantMessage(conversationId: string, user: AuthenticatedUser, content: string, metadata?: Record<string, unknown>): Promise<ChatMessage> {
    return this.appendRoleMessage(conversationId, user, "assistant", "response", content, metadata);
  }

  appendSystemMessage(conversationId: string, user: AuthenticatedUser, content: string, metadata?: Record<string, unknown>): Promise<ChatMessage> {
    return this.appendRoleMessage(conversationId, user, "system", "status", content, metadata);
  }

  appendToolMessage(conversationId: string, user: AuthenticatedUser, content: string, metadata?: Record<string, unknown>): Promise<ChatMessage> {
    return this.appendRoleMessage(conversationId, user, "tool", (metadata?.kind as ChatMessageKind) ?? "status", content, metadata);
  }

  createMessage(input: {
    conversationId: string;
    user?: AuthenticatedUser;
    role: ChatMessageRole;
    kind: ChatMessageKind;
    content: string;
    jobId?: string;
    metadata?: Record<string, unknown>;
  }): ChatMessage {
    return {
      id: createId("M"),
      conversationId: input.conversationId,
      createdAt: new Date().toISOString(),
      role: input.role,
      kind: input.kind,
      content: input.content,
      jobId: input.jobId,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.user ? { userId: safeUserId(input.user.username) } : {})
      }
    };
  }

  private async appendRoleMessage(
    conversationId: string,
    user: AuthenticatedUser,
    role: ChatMessageRole,
    kind: ChatMessageKind,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<ChatMessage> {
    await this.conversations.loadConversation(user, conversationId);
    const message = this.createMessage({ conversationId, user, role, kind, content, metadata });
    await this.appendMessage(message);
    return message;
  }
}

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    role: row.role,
    kind: row.kind,
    content: row.content,
    jobId: row.job_id ?? undefined,
    metadata: parseMetadata(row.metadata_json)
  };
}

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return { parseError: true };
  }
}
