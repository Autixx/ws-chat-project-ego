-- ProjectEGO PM PostgreSQL source-of-truth schema.
-- Apply with a migration runner or psql as an admin role. Runtime services should
-- use restricted roles and must not share Dashboard/agent secrets.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS pm;
CREATE SCHEMA IF NOT EXISTS agent;
CREATE SCHEMA IF NOT EXISTS automation;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS core.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  display_name TEXT,
  external_subject TEXT UNIQUE,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pm.project_members (
  project_id UUID NOT NULL REFERENCES pm.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'project_owner', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS pm.epics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES pm.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  position NUMERIC(20, 6) NOT NULL DEFAULT 1000,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pm.boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES pm.projects(id) ON DELETE CASCADE,
  epic_id UUID REFERENCES pm.epics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  board_type TEXT NOT NULL CHECK (board_type IN ('kanban', 'scrum')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pm.board_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES pm.boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status_key TEXT NOT NULL,
  position NUMERIC(20, 6) NOT NULL DEFAULT 1000,
  wip_limit INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm.sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES pm.projects(id) ON DELETE CASCADE,
  epic_id UUID REFERENCES pm.epics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pm.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES pm.projects(id) ON DELETE CASCADE,
  epic_id UUID REFERENCES pm.epics(id) ON DELETE SET NULL,
  sprint_id UUID REFERENCES pm.sprints(id) ON DELETE SET NULL,
  parent_task_id UUID REFERENCES pm.tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
  assignee_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
  creator_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pm.task_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES pm.tasks(id) ON DELETE CASCADE,
  board_id UUID REFERENCES pm.boards(id) ON DELETE CASCADE,
  column_id UUID REFERENCES pm.board_columns(id) ON DELETE SET NULL,
  sprint_id UUID REFERENCES pm.sprints(id) ON DELETE CASCADE,
  backlog_scope TEXT NOT NULL DEFAULT 'project',
  position NUMERIC(20, 6) NOT NULL DEFAULT 1000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm.task_dependencies (
  blocking_task_id UUID NOT NULL REFERENCES pm.tasks(id) ON DELETE CASCADE,
  blocked_task_id UUID NOT NULL REFERENCES pm.tasks(id) ON DELETE CASCADE,
  created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocking_task_id, blocked_task_id),
  CHECK (blocking_task_id <> blocked_task_id)
);

CREATE TABLE IF NOT EXISTS pm.labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES pm.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS pm.task_labels (
  task_id UUID NOT NULL REFERENCES pm.tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES pm.labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS pm.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES pm.tasks(id) ON DELETE CASCADE,
  author_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pm.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES pm.tasks(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
  original_file_name TEXT NOT NULL,
  stored_file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm.saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES pm.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filter_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation.service_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'n8n', 'agent')),
  actor_id TEXT,
  project_id UUID,
  task_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pm_tasks_project_updated ON pm.tasks(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_assignee ON pm.tasks(assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pm_task_positions_column ON pm.task_positions(column_id, position);
CREATE INDEX IF NOT EXISTS idx_pm_comments_task_created ON pm.comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_project_created ON audit.events(project_id, created_at DESC);

-- Runtime grant sketch:
-- GRANT USAGE ON SCHEMA core, pm, audit TO projectego_pm_app;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA core, pm TO projectego_pm_app;
-- GRANT INSERT, SELECT ON audit.events TO projectego_pm_app;
-- GRANT USAGE ON SCHEMA pm, core TO projectego_dashboard_read;
-- GRANT SELECT ON ALL TABLES IN SCHEMA pm, core TO projectego_dashboard_read;
