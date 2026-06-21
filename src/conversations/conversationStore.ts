import type { AuthenticatedUser } from "../auth/authelia.js";
import type { AppDatabase } from "../db/database.js";
import { createId, safeUserId } from "../utils/ids.js";
import type { AttachmentMetadata, Conversation } from "./types.js";

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  username: string;
  user_email: string | null;
  user_name: string | null;
  archived: number;
};

type AttachmentRow = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};

export class ConversationStore {
  constructor(private readonly database: AppDatabase) {}

  createConversation(user: AuthenticatedUser, optionalTitle?: string): Promise<Conversation> {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: createId("C"),
      title: optionalTitle?.trim() || "New conversation",
      createdAt: now,
      updatedAt: now,
      user: {
        username: user.username,
        email: user.email,
        name: user.name
      }
    };
    this.database.db
      .prepare(
        `INSERT INTO conversations (id, user_id, username, user_email, user_name, title, created_at, updated_at, archived)
         VALUES (@id, @userId, @username, @userEmail, @userName, @title, @createdAt, @updatedAt, 0)`
      )
      .run({
        id: conversation.id,
        userId: safeUserId(user.username),
        username: user.username,
        userEmail: user.email ?? null,
        userName: user.name ?? null,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      });
    return Promise.resolve(conversation);
  }

  listConversations(user: AuthenticatedUser, includeArchived = false): Promise<Conversation[]> {
    const archivedClause = includeArchived ? "" : "AND archived = 0";
    const rows = this.database.db
      .prepare(
        `SELECT id, title, created_at, updated_at, username, user_email, user_name, archived
         FROM conversations
         WHERE user_id = ? ${archivedClause}
         ORDER BY updated_at DESC`
      )
      .all(safeUserId(user.username)) as ConversationRow[];
    return Promise.resolve(rows.map(rowToConversation));
  }

  loadConversation(user: AuthenticatedUser, conversationId: string): Promise<Conversation> {
    const row = this.database.db
      .prepare(
        `SELECT id, title, created_at, updated_at, username, user_email, user_name, archived
         FROM conversations
         WHERE id = ? AND user_id = ?`
      )
      .get(conversationId, safeUserId(user.username)) as ConversationRow | undefined;
    if (!row) return Promise.reject(new Error("Conversation not found."));
    return Promise.resolve(rowToConversation(row));
  }

  async renameConversation(user: AuthenticatedUser, conversationId: string, title: string): Promise<Conversation> {
    await this.loadConversation(user, conversationId);
    const normalizedTitle = title.trim().slice(0, 64) || "New conversation";
    this.database.db
      .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(normalizedTitle, new Date().toISOString(), conversationId, safeUserId(user.username));
    return this.loadConversation(user, conversationId);
  }

  async archiveConversation(user: AuthenticatedUser, conversationId: string): Promise<void> {
    await this.loadConversation(user, conversationId);
    this.database.db
      .prepare("UPDATE conversations SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(new Date().toISOString(), conversationId, safeUserId(user.username));
  }

  async unarchiveConversation(user: AuthenticatedUser, conversationId: string): Promise<Conversation> {
    await this.loadConversation(user, conversationId);
    this.database.db
      .prepare("UPDATE conversations SET archived = 0, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(new Date().toISOString(), conversationId, safeUserId(user.username));
    return this.loadConversation(user, conversationId);
  }

  async deleteConversation(user: AuthenticatedUser, conversationId: string): Promise<AttachmentMetadata[]> {
    await this.loadConversation(user, conversationId);
    const attachments = await this.listAttachments(user, conversationId);
    this.database.db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(conversationId, safeUserId(user.username));
    return attachments;
  }

  async touchConversation(user: AuthenticatedUser, conversationId: string): Promise<void> {
    await this.loadConversation(user, conversationId);
    this.database.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?")
      .run(new Date().toISOString(), conversationId, safeUserId(user.username));
  }

  async insertDraftRef(
    user: AuthenticatedUser,
    input: { conversationId: string; messageId?: string; jobId: string; mode: string; source: string; fileName?: string; itemsCount: number }
  ): Promise<void> {
    await this.loadConversation(user, input.conversationId);
    this.database.db
      .prepare(
        `INSERT INTO draft_refs (id, conversation_id, message_id, job_id, created_at, mode, source, file_name, items_count)
         VALUES (@id, @conversationId, @messageId, @jobId, @createdAt, @mode, @source, @fileName, @itemsCount)`
      )
      .run({
        id: createId("DREF"),
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        jobId: input.jobId,
        createdAt: new Date().toISOString(),
        mode: input.mode,
        source: input.source,
        fileName: input.fileName ?? null,
        itemsCount: input.itemsCount
      });
  }

  async hasDraftRef(user: AuthenticatedUser, conversationId: string, jobId: string): Promise<boolean> {
    await this.loadConversation(user, conversationId);
    const row = this.database.db
      .prepare("SELECT 1 FROM draft_refs WHERE conversation_id = ? AND job_id = ? LIMIT 1")
      .get(conversationId, jobId) as { 1: number } | undefined;
    return Boolean(row);
  }

  async insertAttachment(
    user: AuthenticatedUser,
    input: { id?: string; conversationId: string; messageId?: string; fileName: string; mimeType?: string; sizeBytes?: number; storagePath: string }
  ): Promise<AttachmentMetadata> {
    await this.loadConversation(user, input.conversationId);
    const id = input.id ?? createId("ATT");
    const createdAt = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT INTO attachments (id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, created_at)
         VALUES (@id, @conversationId, @messageId, @fileName, @mimeType, @sizeBytes, @storagePath, @createdAt)`
      )
      .run({
        id,
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        fileName: input.fileName,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? 0,
        storagePath: input.storagePath,
        createdAt
      });
    return {
      id,
      conversationId: input.conversationId,
      messageId: input.messageId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes ?? 0,
      storagePath: input.storagePath,
      createdAt
    };
  }

  async listAttachments(user: AuthenticatedUser, conversationId: string, requestId?: string): Promise<AttachmentMetadata[]> {
    await this.loadConversation(user, conversationId);
    const params: unknown[] = [conversationId];
    const requestClause = requestId ? "AND message_id = ?" : "";
    if (requestId) params.push(requestId);
    const rows = this.database.db
      .prepare(
        `SELECT id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, created_at
         FROM attachments
         WHERE conversation_id = ? ${requestClause}
         ORDER BY created_at ASC`
      )
      .all(...params) as AttachmentRow[];
    return rows.map(rowToAttachment);
  }

  async loadAttachmentForUser(user: AuthenticatedUser, attachmentId: string): Promise<AttachmentMetadata> {
    const row = this.database.db
      .prepare(
        `SELECT a.id, a.conversation_id, a.message_id, a.file_name, a.mime_type, a.size_bytes, a.storage_path, a.created_at
         FROM attachments a
         JOIN conversations c ON c.id = a.conversation_id
         WHERE a.id = ? AND c.user_id = ?`
      )
      .get(attachmentId, safeUserId(user.username)) as AttachmentRow | undefined;
    if (!row) throw new Error("Attachment not found.");
    return rowToAttachment(row);
  }

  async loadAttachmentById(attachmentId: string): Promise<AttachmentMetadata> {
    const row = this.database.db
      .prepare(
        `SELECT id, conversation_id, message_id, file_name, mime_type, size_bytes, storage_path, created_at
         FROM attachments
         WHERE id = ?`
      )
      .get(attachmentId) as AttachmentRow | undefined;
    if (!row) throw new Error("Attachment not found.");
    return rowToAttachment(row);
  }
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: {
      username: row.username,
      email: row.user_email ?? undefined,
      name: row.user_name ?? undefined
    },
    archived: Boolean(row.archived)
  };
}

function rowToAttachment(row: AttachmentRow): AttachmentMetadata {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id ?? undefined,
    fileName: row.file_name,
    mimeType: row.mime_type ?? undefined,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    createdAt: row.created_at
  };
}
