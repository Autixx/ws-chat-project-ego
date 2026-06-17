import type Database from "better-sqlite3";

const initialSchema = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  user_email TEXT,
  user_name TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  job_id TEXT,
  metadata_json TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
ON messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS draft_refs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  job_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  source TEXT NOT NULL,
  file_name TEXT,
  items_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_draft_refs_conversation
ON draft_refs(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
`;

export function runMigrations(db: Database.Database): void {
  db.exec(initialSchema);
  db.prepare("INSERT OR IGNORE INTO app_migrations (name, applied_at) VALUES (?, ?)").run("001_initial_chat_schema", new Date().toISOString());
}
