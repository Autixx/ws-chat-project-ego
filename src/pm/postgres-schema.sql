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
  password_hash TEXT,
  global_role TEXT NOT NULL DEFAULT 'user' CHECK (global_role IN ('super_admin', 'admin', 'user')),
  dashboard_access BOOLEAN NOT NULL DEFAULT FALSE,
  pm_access BOOLEAN NOT NULL DEFAULT FALSE,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE core.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS global_role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS dashboard_access BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS pm_access BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS core.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_hash TEXT
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

ALTER TABLE pm.tasks
  ADD COLUMN IF NOT EXISTS search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(status, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(priority, '')), 'C')
  ) STORED;

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

CREATE TABLE IF NOT EXISTS pm.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES pm.projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES pm.tasks(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id TEXT NOT NULL,
  url TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_json JSONB NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'retrying', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  error TEXT,
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

CREATE TABLE IF NOT EXISTS pm.home_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  template_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('activity', 'changes', 'announcement', 'notes', 'timer', 'api', 'my_epics')),
  title TEXT NOT NULL,
  x INTEGER NOT NULL DEFAULT 1,
  y INTEGER NOT NULL DEFAULT 1,
  width INTEGER NOT NULL DEFAULT 4,
  height INTEGER NOT NULL DEFAULT 3,
  clickable BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (x >= 1),
  CHECK (y >= 1),
  CHECK (width >= 1),
  CHECK (height >= 1)
);

CREATE TABLE IF NOT EXISTS pm.widget_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('activity', 'changes', 'announcement', 'notes', 'timer', 'api', 'my_epics')),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_pm_tasks_search_document ON pm.tasks USING GIN(search_document);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_assignee ON pm.tasks(assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pm_task_positions_column ON pm.task_positions(column_id, position);
CREATE INDEX IF NOT EXISTS idx_pm_comments_task_created ON pm.comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pm_notifications_user_unread ON pm.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pm_webhook_deliveries_due ON pm.webhook_deliveries(next_attempt_at, created_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_pm_webhook_deliveries_status ON pm.webhook_deliveries(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_home_widgets_user ON pm.home_widgets(user_id, y, x);
CREATE INDEX IF NOT EXISTS idx_pm_widget_templates_visible ON pm.widget_templates(visibility, kind, updated_at DESC);

ALTER TABLE pm.home_widgets DROP CONSTRAINT IF EXISTS home_widgets_kind_check;
ALTER TABLE pm.home_widgets ADD CONSTRAINT home_widgets_kind_check CHECK (kind IN ('activity', 'changes', 'announcement', 'notes', 'timer', 'api', 'my_epics'));
ALTER TABLE pm.widget_templates DROP CONSTRAINT IF EXISTS widget_templates_kind_check;
ALTER TABLE pm.widget_templates ADD CONSTRAINT widget_templates_kind_check CHECK (kind IN ('activity', 'changes', 'announcement', 'notes', 'timer', 'api', 'my_epics'));
CREATE INDEX IF NOT EXISTS idx_pm_announcements_created ON pm.announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_project_created ON audit.events(project_id, created_at DESC);

-- Runtime grant sketch:
-- GRANT USAGE ON SCHEMA core, pm, audit TO projectego_pm_app;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA core, pm TO projectego_pm_app;
-- GRANT INSERT, SELECT ON audit.events TO projectego_pm_app;
-- GRANT USAGE ON SCHEMA pm, core TO projectego_dashboard_read;
-- GRANT SELECT ON ALL TABLES IN SCHEMA pm, core TO projectego_dashboard_read;
