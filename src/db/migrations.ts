import type Database from "better-sqlite3";
import path from "node:path";

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
  original_file_name TEXT,
  stored_file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  request_message_id TEXT,
  response_message_id TEXT,
  draft_job_id TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_message TEXT,
  metadata_json TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(request_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY(response_message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_conversation_updated
ON jobs(conversation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_created
ON job_events(job_id, created_at ASC);

CREATE TABLE IF NOT EXISTS app_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
`;

export function runMigrations(db: Database.Database): void {
  db.exec(initialSchema);
  db.prepare("INSERT OR IGNORE INTO app_migrations (name, applied_at) VALUES (?, ?)").run("001_initial_chat_schema", new Date().toISOString());
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(session_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);
  db.prepare("INSERT OR IGNORE INTO app_migrations (name, applied_at) VALUES (?, ?)").run("002_local_auth", new Date().toISOString());
  db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  request_message_id TEXT,
  response_message_id TEXT,
  draft_job_id TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_message TEXT,
  metadata_json TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(request_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY(response_message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_conversation_updated
ON jobs(conversation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_created
ON job_events(job_id, created_at ASC);
`);
  db.prepare("INSERT OR IGNORE INTO app_migrations (name, applied_at) VALUES (?, ?)").run("003_job_execution_tracking", new Date().toISOString());
  addColumnIfMissing(db, "attachments", "original_file_name", "TEXT");
  addColumnIfMissing(db, "attachments", "stored_file_name", "TEXT");
  const attachmentRows = db
    .prepare("SELECT id, file_name, storage_path, original_file_name, stored_file_name FROM attachments WHERE original_file_name IS NULL OR stored_file_name IS NULL")
    .all() as Array<{ id: string; file_name: string; storage_path: string; original_file_name: string | null; stored_file_name: string | null }>;
  const updateAttachmentNames = db.prepare("UPDATE attachments SET original_file_name = ?, stored_file_name = ? WHERE id = ?");
  for (const row of attachmentRows) {
    updateAttachmentNames.run(row.original_file_name ?? row.file_name, row.stored_file_name ?? path.basename(row.storage_path), row.id);
  }
  db.prepare("INSERT OR IGNORE INTO app_migrations (name, applied_at) VALUES (?, ?)").run("004_attachment_original_stored_names", new Date().toISOString());
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
