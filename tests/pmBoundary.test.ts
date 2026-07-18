import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { resolveAttachmentPath, sanitizePmFileName, storePmTaskAttachment, validatePmAttachmentFile } from "../src/pm/attachmentService.js";
import { assertPmCanStart, forbiddenPmEnv, loadPmConfig } from "../src/pm/config.js";
import { buildPmInviteEmail } from "../src/pm/mailer.js";
import { canManageProject, canViewProject, canWriteProject, requireProjectRole } from "../src/pm/permissions.js";
import { createPmApp } from "../src/pm/server.js";
import { PmWebhookDispatcher, signWebhookBody, type PmWebhookPersistence } from "../src/pm/webhookDispatcher.js";
import type { PmWebhookDeliveryRecord } from "../src/pm/types.js";

test("PM config defaults to a separate service port and data area", () => {
  const config = loadPmConfig({
    NODE_ENV: "development",
    DATA_DIR: "/app/dashboard-data",
    PM_DATABASE_URL: "postgres://pm:test@postgres/projectego"
  });

  assert.equal(config.port, 19110);
  assert.equal(config.dataDir, "/app/dashboard-data");
  assert.equal(config.attachmentsDir, "/app/dashboard-data/attachments");
  assert.equal(config.maxAttachmentBytes, 25 * 1024 * 1024);
  assert.equal(config.autoMigrate, true);
  assert.equal(config.databaseUrl, "postgres://pm:test@postgres/projectego");
});

test("PM config supports signed outgoing webhooks and SMTP without Dashboard secrets", () => {
  const config = loadPmConfig({
    NODE_ENV: "development",
    PM_WEBHOOK_URLS: "https://n8n.example.test/webhook/pm, https://audit.example.test/pm",
    PM_WEBHOOK_SECRET: "pm-webhook-secret",
    PM_WEBHOOK_TIMEOUT_MS: "2500",
    PM_WEBHOOK_MAX_ATTEMPTS: "4",
    PM_WEBHOOK_RETRY_BASE_MS: "1000",
    PM_WEBHOOK_RETRY_INTERVAL_MS: "750",
    SMTP_HOST: "mail.project-ego.online",
    SMTP_PORT: "587",
    SMTP_FROM: "pm@project-ego.online",
    SMTP_TLS: "false"
  });

  assert.deepEqual(config.webhooks.urls, ["https://n8n.example.test/webhook/pm", "https://audit.example.test/pm"]);
  assert.equal(config.webhooks.secret, "pm-webhook-secret");
  assert.equal(config.webhooks.timeoutMs, 2500);
  assert.equal(config.webhooks.maxAttempts, 4);
  assert.equal(config.webhooks.retryBaseMs, 1000);
  assert.equal(config.webhooks.retryIntervalMs, 750);
  assert.equal(config.smtp?.host, "mail.project-ego.online");
  assert.equal(config.smtp?.from, "pm@project-ego.online");
  assert.equal(config.smtp?.tls, false);
  assert.match(signWebhookBody("{\"type\":\"task.created\"}", "secret"), /^sha256=[a-f0-9]{64}$/);
});

test("PM webhook dispatcher persists failed delivery and retries it", async () => {
  let attempts = 0;
  const server = http.createServer((_req, res) => {
    attempts += 1;
    res.statusCode = attempts === 1 ? 503 : 204;
    res.end(attempts === 1 ? "temporary outage" : "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const records: PmWebhookDeliveryRecord[] = [];
    const persistence: PmWebhookPersistence = {
      async createWebhookDelivery(input) {
        const record: PmWebhookDeliveryRecord = {
          id: `row-${records.length + 1}`,
          deliveryId: input.deliveryId,
          url: input.url,
          eventType: input.eventType,
          event: input.event,
          payload: input.payload,
          status: "pending",
          attempts: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        records.push(record);
        return record;
      },
      async markWebhookDeliveryAttempt(id, input) {
        const record = records.find((item) => item.id === id);
        assert.ok(record);
        record.attempts = input.attempts;
        record.responseStatus = input.responseStatus;
        record.error = input.error;
        record.status = input.delivered ? "delivered" : input.attempts >= input.maxAttempts ? "dead" : "retrying";
        record.nextAttemptAt = input.nextAttemptAt?.toISOString();
        record.updatedAt = new Date().toISOString();
        return record;
      },
      async listDueWebhookDeliveries() {
        return records.filter((record) => record.status === "pending" || record.status === "retrying");
      },
      async getWebhookDelivery(id) {
        const record = records.find((item) => item.id === id);
        assert.ok(record);
        return record;
      }
    };
    const dispatcher = new PmWebhookDispatcher(
      { urls: [`http://127.0.0.1:${address.port}/hook`], timeoutMs: 1000, maxAttempts: 3, retryBaseMs: 1000, retryIntervalMs: 1000 },
      persistence
    );

    const [failed] = await dispatcher.dispatch({ type: "task.created", createdAt: new Date().toISOString(), payload: { taskId: "task-1" } });
    assert.equal(failed.ok, false);
    assert.equal(records[0].status, "retrying");
    assert.equal(records[0].attempts, 1);

    const [retried] = await dispatcher.retryDue();
    assert.equal(retried.ok, true);
    assert.equal(records[0].status, "delivered");
    assert.equal(records[0].attempts, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM webhook dispatcher retries one persisted delivery by id", async () => {
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls += 1;
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const record: PmWebhookDeliveryRecord = {
      id: "delivery-row-1",
      deliveryId: "delivery-public-1",
      url: `http://127.0.0.1:${address.port}/hook`,
      eventType: "task.created",
      event: { type: "task.created" },
      payload: { type: "task.created", deliveryId: "delivery-public-1", service: "projectego-pm", createdAt: new Date().toISOString(), payload: { taskId: "task-1" } },
      status: "dead",
      attempts: 6,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const persistence: PmWebhookPersistence = {
      async createWebhookDelivery() {
        return record;
      },
      async markWebhookDeliveryAttempt(id, input) {
        assert.equal(id, record.id);
        record.status = input.delivered ? "delivered" : "dead";
        record.attempts = input.attempts;
        record.responseStatus = input.responseStatus;
        return record;
      },
      async listDueWebhookDeliveries() {
        return [];
      },
      async getWebhookDelivery(id) {
        assert.equal(id, record.id);
        return record;
      }
    };
    const dispatcher = new PmWebhookDispatcher({ urls: [record.url], timeoutMs: 1000, maxAttempts: 8, retryBaseMs: 1000, retryIntervalMs: 1000 }, persistence);

    const result = await dispatcher.retryDelivery(record.id);
    assert.equal(result.ok, true);
    assert.equal(record.status, "delivered");
    assert.equal(record.attempts, 7);
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM rejects Dashboard and agent secrets in its runtime environment", () => {
  const env = {
    NODE_ENV: "production",
    PM_DATABASE_URL: "postgres://pm:test@postgres/projectego",
    CODEX_AGENT_TOKEN: "agent-secret",
    JOB_CALLBACK_TOKEN: "callback-secret",
    N8N_WEBHOOK_TOKEN: "n8n-secret"
  };

  assert.deepEqual(forbiddenPmEnv(env), ["CODEX_AGENT_TOKEN", "JOB_CALLBACK_TOKEN", "N8N_WEBHOOK_TOKEN"]);
  assert.throws(() => assertPmCanStart(loadPmConfig(env), env), /CODEX_AGENT_TOKEN, JOB_CALLBACK_TOKEN, N8N_WEBHOOK_TOKEN/);
});

test("PM requires PostgreSQL DSN in production", () => {
  const env = { NODE_ENV: "production" };

  assert.throws(() => assertPmCanStart(loadPmConfig(env), env), /PM_DATABASE_URL is required/);
});

test("PM PostgreSQL schema defines required logical boundaries", () => {
  const schema = readFileSync(path.resolve("src/pm/postgres-schema.sql"), "utf8");

  for (const schemaName of ["core", "pm", "agent", "automation", "audit"]) {
    assert.match(schema, new RegExp(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`));
  }

  for (const table of ["core.users", "core.sessions", "pm.projects", "pm.epics", "pm.boards", "pm.sprints", "pm.tasks", "pm.task_dependencies", "pm.comments", "pm.attachments", "pm.notifications", "pm.webhook_deliveries", "audit.events"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace(".", "\\.")}`));
  }

  assert.match(schema, /dashboard_access BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(schema, /pm_access BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(schema, /actor_type TEXT NOT NULL CHECK \(actor_type IN \('user', 'system', 'n8n', 'agent'\)\)/);
  assert.match(schema, /storage_path TEXT NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS pm\.board_columns/);
  assert.match(schema, /search_document tsvector GENERATED ALWAYS AS/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_pm_tasks_search_document ON pm\.tasks USING GIN\(search_document\)/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_pm_webhook_deliveries_due/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS idx_pm_task_positions_column/);
});

test("PM role checks keep viewer read-only and member writable", () => {
  assert.equal(canViewProject("viewer"), true);
  assert.equal(canWriteProject("viewer"), false);
  assert.equal(canWriteProject("member"), true);
  assert.equal(canManageProject("member"), false);
  assert.equal(canManageProject("project_owner"), true);
  assert.throws(() => requireProjectRole("viewer", "member"), /access denied/);
});

test("PM API reports project endpoints unavailable without PM_DATABASE_URL", async () => {
  const app = createPmApp(loadPmConfig({ NODE_ENV: "development", PM_DEV_AUTH_BYPASS: "true" }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/pm/projects`);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /PM_DATABASE_URL is required/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM automation API uses PM_AUTOMATION_TOKEN instead of user auth", async () => {
  const calls: string[] = [];
  const fakeStore = {
    async ensureAutomationUser(name: string) {
      calls.push(`actor:${name}`);
      return { id: "automation-user", username: "projectego_automation_n8n", displayName: "ProjectEGO automation: n8n" };
    },
    async health() {
      return { ok: true };
    },
    async createTask(_actor: unknown, input: Record<string, unknown>) {
      calls.push(`create:${input.projectId}:${input.title}`);
      return {
        id: "task-1",
        projectId: input.projectId,
        title: input.title,
        description: "",
        status: "todo",
        priority: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };
    }
  };
  const app = createPmApp(loadPmConfig({ NODE_ENV: "development", PM_AUTOMATION_TOKEN: "pm-auto-secret", PM_DEV_AUTH_BYPASS: "false" }), fakeStore as never);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/pm/automation/projects/project-1/tasks`;

    const unauthorized = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "From n8n" }) });
    assert.equal(unauthorized.status, 401);

    const created = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer pm-auto-secret" },
      body: JSON.stringify({ title: "From n8n" })
    });
    assert.equal(created.status, 201);
    assert.deepEqual(calls, ["actor:n8n", "create:project-1:From n8n"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM automation API creates tasks directly on explicit and default boards", async () => {
  const calls: string[] = [];
  const fakeStore = {
    async ensureAutomationUser(name: string) {
      calls.push(`actor:${name}`);
      return { id: "automation-user", username: "projectego_automation_n8n", displayName: "ProjectEGO automation: n8n" };
    },
    async health() {
      return { ok: true };
    },
    async loadBoard(boardId: string) {
      calls.push(`loadBoard:${boardId}`);
      return { id: boardId, projectId: "project-1", name: "Roadmap", boardType: "kanban", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
    },
    async ensureDefaultKanbanBoard(_actor: unknown, projectId: string) {
      calls.push(`defaultBoard:${projectId}`);
      return {
        board: { id: "board-default", projectId, name: "Project Kanban", boardType: "kanban", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
        columns: []
      };
    },
    async listBoardColumns(boardId: string) {
      calls.push(`columns:${boardId}`);
      return [{ id: `${boardId}-todo`, boardId, name: "Todo", statusKey: "todo", position: 1000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    },
    async createTask(_actor: unknown, input: Record<string, unknown>) {
      calls.push(`create:${input.projectId}:${input.title}`);
      return {
        id: `task-${calls.filter((call) => call.startsWith("create:")).length}`,
        projectId: input.projectId,
        title: input.title,
        description: "",
        status: "todo",
        priority: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };
    },
    async moveTask(_actor: unknown, input: Record<string, unknown>) {
      calls.push(`move:${input.taskId}:${input.boardId}:${input.columnId}`);
      return {
        task: {
          id: input.taskId,
          projectId: "project-1",
          title: "Created on board",
          description: "",
          status: input.status,
          priority: "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 2
        },
        position: {
          taskId: input.taskId,
          boardId: input.boardId,
          columnId: input.columnId,
          backlogScope: "project",
          position: input.position
        }
      };
    }
  };
  const app = createPmApp(loadPmConfig({ NODE_ENV: "development", PM_AUTOMATION_TOKEN: "pm-auto-secret", PM_DEV_AUTH_BYPASS: "false" }), fakeStore as never);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api/pm/automation`;
    const headers = { "content-type": "application/json", authorization: "Bearer pm-auto-secret" };

    const explicit = await fetch(`${base}/boards/board-1/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Created on board" })
    });
    assert.equal(explicit.status, 201);
    assert.equal((await explicit.json()).position.boardId, "board-1");

    const viaDefault = await fetch(`${base}/projects/project-1/boards/default/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Created on default board" })
    });
    assert.equal(viaDefault.status, 201);
    assert.equal((await viaDefault.json()).position.boardId, "board-default");

    assert.deepEqual(calls, [
      "actor:n8n",
      "loadBoard:board-1",
      "columns:board-1",
      "create:project-1:Created on board",
      "move:task-1:board-1:board-1-todo",
      "actor:n8n",
      "defaultBoard:project-1",
      "columns:board-default",
      "create:project-1:Created on default board",
      "move:task-2:board-default:board-default-todo"
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM automation API lists projects with boards for n8n routing", async () => {
  const calls: string[] = [];
  const fakeStore = {
    async ensureAutomationUser(name: string) {
      calls.push(`actor:${name}`);
      return { id: "automation-user", username: "projectego_automation_n8n", displayName: "ProjectEGO automation: n8n" };
    },
    async health() {
      return { ok: true };
    },
    async listProjects(userId: string, includeArchived: boolean) {
      calls.push(`projects:${userId}:${includeArchived}`);
      return [
        { id: "project-1", key: "DASH", name: "Dashboard", description: "", ownerId: "automation-user", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
        { id: "project-2", key: "PM", name: "PM", description: "", ownerId: "automation-user", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 }
      ];
    },
    async listBoards(projectId: string) {
      calls.push(`boards:${projectId}`);
      return [{ id: `${projectId}-board`, projectId, name: "Project Kanban", boardType: "kanban", isDefault: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 }];
    }
  };
  const app = createPmApp(loadPmConfig({ NODE_ENV: "development", PM_AUTOMATION_TOKEN: "pm-auto-secret", PM_DEV_AUTH_BYPASS: "false" }), fakeStore as never);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/pm/automation/projects/boards`, {
      headers: { authorization: "Bearer pm-auto-secret" }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.projects.length, 2);
    assert.equal(body.projects[0].path, "/DASH");
    assert.equal(body.projects[0].apiCreateTaskPath, "/api/pm/automation/projects/project-1/tasks");
    assert.equal(body.projects[0].defaultBoardTaskPath, "/api/pm/automation/projects/project-1/boards/default/tasks");
    assert.equal(body.projects[0].boards[0].id, "project-1-board");
    assert.equal(body.projects[0].boards[0].path, "/DASH/project-1-board");
    assert.equal(body.projects[0].boards[0].taskPathTemplate, "/DASH/project-1-board/{taskId}");
    assert.equal(body.projects[0].boards[0].apiCreateTaskPath, "/api/pm/automation/boards/project-1-board/tasks");
    const routingResponse = await fetch(`http://127.0.0.1:${address.port}/api/pm/automation/routing-map`, {
      headers: { authorization: "Bearer pm-auto-secret" }
    });
    assert.equal(routingResponse.status, 200);
    const routingBody = await routingResponse.json();
    assert.equal(routingBody.projects[1].boards[0].path, "/PM/project-2-board");
    assert.deepEqual(calls, [
      "actor:n8n",
      "projects:automation-user:true",
      "boards:project-1",
      "boards:project-2",
      "actor:n8n",
      "projects:automation-user:true",
      "boards:project-1",
      "boards:project-2"
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM API hard deletes projects tasks and boards with attachment files", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "projectego-pm-hard-delete-"));
  const attachmentsDir = path.join(root, "attachments");
  mkdirSync(attachmentsDir, { recursive: true });
  const taskDir = path.join(attachmentsDir, "task-1");
  const boardTaskDir = path.join(attachmentsDir, "task-board");
  const projectTaskDir = path.join(attachmentsDir, "task-project");
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(boardTaskDir, { recursive: true });
  mkdirSync(projectTaskDir, { recursive: true });
  const taskFile = path.join(taskDir, "PMATT_task.txt");
  const boardFile = path.join(boardTaskDir, "PMATT_board.txt");
  const projectFile = path.join(projectTaskDir, "PMATT_project.txt");
  writeFileSync(taskFile, "task");
  writeFileSync(boardFile, "board");
  writeFileSync(projectFile, "project");
  const calls: string[] = [];
  const makeTask = (id: string) => ({
    id,
    projectId: "project-1",
    title: id,
    description: "",
    status: "todo",
    priority: "medium",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  });
  const makeAttachment = (id: string, taskId: string, storagePath: string) => ({
    id,
    taskId,
    uploaderId: "pm-user-1",
    originalFileName: `${id}.txt`,
    storedFileName: path.basename(storagePath),
    mimeType: "text/plain",
    sizeBytes: 4,
    storagePath,
    createdAt: new Date().toISOString()
  });
  const fakeStore = {
    async ensureUser() {
      return { id: "pm-user-1", username: "operator", displayName: "Operator" };
    },
    async health() {
      return { ok: true };
    },
    async getProjectRole(userId: string, projectId: string) {
      calls.push(`role:${userId}:${projectId}`);
      return "project_owner";
    },
    async loadTask(taskId: string) {
      calls.push(`loadTask:${taskId}`);
      return makeTask(taskId);
    },
    async hardDeleteTask(_user: unknown, taskId: string) {
      calls.push(`hardTask:${taskId}`);
      return { task: makeTask(taskId), attachments: [makeAttachment("att-task", taskId, taskFile)] };
    },
    async loadBoard(boardId: string) {
      calls.push(`loadBoard:${boardId}`);
      return { id: boardId, projectId: "project-1", name: "Board", boardType: "kanban", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
    },
    async hardDeleteBoard(_user: unknown, boardId: string) {
      calls.push(`hardBoard:${boardId}`);
      return {
        board: { id: boardId, projectId: "project-1", name: "Board", boardType: "kanban", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
        taskIds: ["task-board"],
        attachments: [makeAttachment("att-board", "task-board", boardFile)]
      };
    },
    async hardDeleteProject(_user: unknown, projectId: string) {
      calls.push(`hardProject:${projectId}`);
      return {
        project: { id: projectId, key: "TEST", name: "Test", description: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
        boardIds: ["board-project"],
        taskIds: ["task-project"],
        attachments: [makeAttachment("att-project", "task-project", projectFile)]
      };
    }
  };
  const app = createPmApp(loadPmConfig({ NODE_ENV: "development", PM_DEV_AUTH_BYPASS: "true", PM_ATTACHMENTS_DIR: attachmentsDir }), fakeStore as never);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const taskResponse = await fetch(`${baseUrl}/api/pm/tasks/task-1/permanent`, { method: "DELETE" });
    assert.equal(taskResponse.status, 200);
    const taskBody = await taskResponse.json();
    assert.equal(taskBody.deletedAttachments, 1);
    assert.equal(existsSync(taskFile), false);

    const boardResponse = await fetch(`${baseUrl}/api/pm/boards/board-1/permanent`, { method: "DELETE" });
    assert.equal(boardResponse.status, 200);
    const boardBody = await boardResponse.json();
    assert.deepEqual(boardBody.deletedTaskIds, ["task-board"]);
    assert.equal(boardBody.deletedAttachments, 1);
    assert.equal(existsSync(boardFile), false);

    const projectResponse = await fetch(`${baseUrl}/api/pm/projects/project-1/permanent`, { method: "DELETE" });
    assert.equal(projectResponse.status, 200);
    const projectBody = await projectResponse.json();
    assert.deepEqual(projectBody.deletedBoardIds, ["board-project"]);
    assert.deepEqual(projectBody.deletedTaskIds, ["task-project"]);
    assert.equal(projectBody.deletedAttachments, 1);
    assert.equal(existsSync(projectFile), false);
    assert.deepEqual(calls, [
      "loadTask:task-1",
      "role:pm-user-1:project-1",
      "hardTask:task-1",
      "loadBoard:board-1",
      "role:pm-user-1:project-1",
      "hardBoard:board-1",
      "role:pm-user-1:project-1",
      "hardProject:project-1"
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(root, { recursive: true, force: true });
  }
});

test("PM API lists webhook deliveries and retries one delivery", async () => {
  let webhookCalls = 0;
  const webhookServer = http.createServer((_req, res) => {
    webhookCalls += 1;
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const webhookAddress = webhookServer.address();
  assert.ok(webhookAddress && typeof webhookAddress === "object");
  const delivery: PmWebhookDeliveryRecord = {
    id: "delivery-row-1",
    deliveryId: "delivery-public-1",
    url: `http://127.0.0.1:${webhookAddress.port}/hook`,
    eventType: "task.created",
    event: { type: "task.created" },
    payload: { type: "task.created", deliveryId: "delivery-public-1", service: "projectego-pm", createdAt: new Date().toISOString(), payload: { taskId: "task-1" } },
    status: "dead",
    attempts: 6,
    error: "workflow disabled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const calls: string[] = [];
  const fakeStore = {
    async ensureUser() {
      return { id: "pm-user-1", username: "operator", displayName: "Operator" };
    },
    async health() {
      return { ok: true };
    },
    async listWebhookDeliveries(filters: { status?: string }) {
      calls.push(`list:${filters.status || "all"}`);
      return filters.status && filters.status !== delivery.status ? [] : [delivery];
    },
    async summarizeWebhookDeliveries() {
      return { pending: 0, retrying: 0, delivered: 2, dead: 1 };
    },
    async getWebhookDelivery(id: string) {
      assert.equal(id, delivery.id);
      return delivery;
    },
    async markWebhookDeliveryAttempt(id: string, input: { delivered: boolean; attempts: number; responseStatus?: number; error?: string }) {
      assert.equal(id, delivery.id);
      delivery.status = input.delivered ? "delivered" : "retrying";
      delivery.attempts = input.attempts;
      delivery.responseStatus = input.responseStatus;
      delivery.error = input.error;
      return delivery;
    }
  };
  const app = createPmApp(
    loadPmConfig({ NODE_ENV: "development", PM_DEV_AUTH_BYPASS: "true", PM_WEBHOOK_URLS: delivery.url }),
    fakeStore as never
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const listResponse = await fetch(`${baseUrl}/api/pm/webhook-deliveries?status=dead`);
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json() as { deliveries: PmWebhookDeliveryRecord[]; summary: Record<string, number> };
    assert.equal(listBody.deliveries[0].id, delivery.id);
    assert.equal(listBody.summary.dead, 1);
    assert.deepEqual(calls, ["list:dead"]);

    const retryResponse = await fetch(`${baseUrl}/api/pm/webhook-deliveries/${delivery.id}/retry`, { method: "POST" });
    assert.equal(retryResponse.status, 202);
    const retryBody = await retryResponse.json() as { delivery: PmWebhookDeliveryRecord; result: { ok: boolean; status: number } };
    assert.equal(retryBody.result.ok, true);
    assert.equal(retryBody.delivery.status, "delivered");
    assert.equal(retryBody.delivery.attempts, 7);
    assert.equal(webhookCalls, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await new Promise<void>((resolve, reject) => webhookServer.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM operator status reports database schema and integration configuration", async () => {
  const fakeStore = {
    async ensureUser() {
      return { id: "pm-user-1", username: "operator", displayName: "Operator" };
    },
    async health() {
      return { ok: true, message: "ok" };
    },
    async listSchemaMigrations() {
      return ["001_pm_initial_schema"];
    },
    async getBootstrapStatus() {
      return { bootstrapped: true, ownerCount: 1, projectCount: 1, userCount: 2 };
    },
    async summarizeWebhookDeliveries() {
      return { pending: 1, retrying: 2, delivered: 3, dead: 4 };
    }
  };
  const app = createPmApp(
    loadPmConfig({
      NODE_ENV: "development",
      PM_DEV_AUTH_BYPASS: "true",
      PM_DATABASE_URL: "postgres://pm:test@postgres/projectego",
      PM_WEBHOOK_URLS: "https://n8n.example.test/webhook/pm",
      PM_AUTOMATION_TOKEN: "pm-auto-secret",
      SMTP_HOST: "mail.project-ego.online",
      SMTP_FROM: "pm@project-ego.online"
    }),
    fakeStore as never
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/pm/operator/status`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      bootstrap: { bootstrapped: boolean; tokenConfigured: boolean };
      database: { reachable: boolean; schemaApplied: boolean; schemaMigrations: string[] };
      webhooks: { configured: boolean; summary: Record<string, number> };
      smtp: { configured: boolean };
      automation: { configured: boolean };
    };
    assert.equal(body.database.reachable, true);
    assert.equal(body.bootstrap.bootstrapped, true);
    assert.equal(body.bootstrap.tokenConfigured, false);
    assert.equal(body.database.schemaApplied, true);
    assert.deepEqual(body.database.schemaMigrations, ["001_pm_initial_schema"]);
    assert.equal(body.webhooks.configured, true);
    assert.equal(body.webhooks.summary.dead, 4);
    assert.equal(body.smtp.configured, true);
    assert.equal(body.automation.configured, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM bootstrap API requires token and creates first owner once", async () => {
  let bootstrapped = false;
  const calls: string[] = [];
  const fakeStore = {
    async ensureUser() {
      return { id: "pm-user-1", username: "tris", displayName: "Tris" };
    },
    async health() {
      return { ok: true };
    },
    async getBootstrapStatus() {
      return { bootstrapped, ownerCount: bootstrapped ? 1 : 0, projectCount: bootstrapped ? 1 : 0, userCount: 1 };
    },
    async bootstrapInitialOwner(user: { id: string; username: string }, input: { projectKey: string; projectName: string }) {
      calls.push(`${user.username}:${input.projectKey}:${input.projectName}`);
      bootstrapped = true;
      return {
        status: { bootstrapped: true, ownerCount: 1, projectCount: 1, userCount: 1 },
        user,
        role: "project_owner",
        project: { id: "project-1", key: input.projectKey, name: input.projectName, description: "", role: "project_owner", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      };
    }
  };
  const app = createPmApp(
    loadPmConfig({
      NODE_ENV: "development",
      PM_DEV_AUTH_BYPASS: "true",
      PM_BOOTSTRAP_TOKEN: "bootstrap-secret",
      PM_BOOTSTRAP_USERNAME: "tris",
      PM_BOOTSTRAP_PROJECT_KEY: "EGO",
      PM_BOOTSTRAP_PROJECT_NAME: "ProjectEGO"
    }),
    fakeStore as never
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const statusResponse = await fetch(`${baseUrl}/api/pm/bootstrap/status`);
    assert.equal(statusResponse.status, 200);
    const statusBody = await statusResponse.json() as { bootstrapped: boolean; tokenConfigured: boolean; expectedUsername: string };
    assert.equal(statusBody.bootstrapped, false);
    assert.equal(statusBody.tokenConfigured, true);
    assert.equal(statusBody.expectedUsername, "tris");

    const unauthorized = await fetch(`${baseUrl}/api/pm/bootstrap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(unauthorized.status, 401);

    const created = await fetch(`${baseUrl}/api/pm/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer bootstrap-secret" },
      body: JSON.stringify({})
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { project: { key: string }; status: { bootstrapped: boolean } };
    assert.equal(createdBody.status.bootstrapped, true);
    assert.equal(createdBody.project.key, "EGO");
    assert.deepEqual(calls, ["tris:EGO:ProjectEGO"]);

    const repeated = await fetch(`${baseUrl}/api/pm/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer bootstrap-secret" },
      body: JSON.stringify({})
    });
    assert.equal(repeated.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM service serves browser shell separately from Dashboard", async () => {
  const app = createPmApp(loadPmConfig({ NODE_ENV: "development", PM_DEV_AUTH_BYPASS: "true" }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ProjectEGO PM/);
  assert.match(html, /\/pm\.js/);
  assert.match(html, /pmLoginForm/);
  assert.match(html, /pmLogoutBtn/);
  assert.match(html, /projectSidebarToggle/);
  assert.match(html, /taskSidebarToggle/);
  assert.match(html, /boardForm/);
  assert.match(html, /theme-swatch/);
  assert.match(html, /bootstrapForm/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM README documents Kanban board API", () => {
  const readme = readFileSync(path.resolve("README.md"), "utf8");
  const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
  const compose = readFileSync(path.resolve("docker-compose.yml"), "utf8");
  assert.match(readme, /POST `?\/api\/pm\/projects\/:projectId\/boards\/kanban\/default`?/);
  assert.match(readme, /POST `?\/api\/pm\/projects\/:projectId\/boards\/kanban`?/);
  assert.match(readme, /multiple named Kanban boards per project/);
  assert.match(readme, /GET `?\/api\/pm\/boards\/:boardId`?/);
  assert.match(readme, /DELETE `?\/api\/pm\/boards\/:boardId\/permanent`?/);
  assert.match(readme, /drag-and-drop task movement/);
  assert.match(readme, /GET `?\/api\/pm\/projects\/:projectId\/sprints`?/);
  assert.match(readme, /POST `?\/api\/pm\/tasks\/:taskId\/sprint`?/);
  assert.match(readme, /backlog and sprint planning/);
  assert.match(readme, /GET `?\/api\/pm\/notifications`?/);
  assert.match(readme, /GET `?\/api\/pm\/webhook-deliveries`?/);
  assert.match(readme, /POST `?\/api\/pm\/webhook-deliveries\/:deliveryId\/retry`?/);
  assert.match(readme, /GET `?\/api\/pm\/bootstrap\/status`?/);
  assert.match(readme, /POST `?\/api\/pm\/bootstrap`?/);
  assert.match(readme, /GET `?\/api\/pm\/operator\/status`?/);
  assert.match(readme, /@username/);
  assert.match(readme, /POST `?\/api\/pm\/projects\/:projectId\/members`?/);
  assert.match(readme, /POST `?\/api\/pm\/tasks\/:taskId\/assignee`?/);
  assert.match(readme, /task assignee picker/);
  assert.match(readme, /GET `?\/api\/pm\/projects\/:projectId\/labels`?/);
  assert.match(readme, /PATCH `?\/api\/pm\/projects\/:projectId\/labels\/:labelId`?/);
  assert.match(readme, /POST `?\/api\/pm\/tasks\/:taskId\/labels`?/);
  assert.match(readme, /project labels with edit\/delete and task label assignment\/removal/);
  assert.match(readme, /GET `?\/api\/pm\/projects\/:projectId\/filters`?/);
  assert.match(readme, /PATCH `?\/api\/pm\/projects\/:projectId\/filters\/:filterId`?/);
  assert.match(readme, /DELETE `?\/api\/pm\/projects\/:projectId\/filters\/:filterId`?/);
  assert.match(readme, /label filtering and user-scoped saved task filters with update\/delete/);
  assert.match(readme, /saved filters automatically drop deleted label references/);
  assert.match(readme, /database-backed task search across ID, title, and description/);
  assert.doesNotMatch(readme, /No database-backed full-text search yet/);
  assert.match(readme, /POST `?\/api\/pm\/tasks\/:taskId\/archive`?/);
  assert.match(readme, /DELETE `?\/api\/pm\/tasks\/:taskId`?/);
  assert.match(readme, /DELETE `?\/api\/pm\/tasks\/:taskId\/permanent`?/);
  assert.match(readme, /task due dates with overdue highlighting/);
  assert.match(readme, /GET `?\/api\/pm\/tasks\/:taskId\/dependencies`?/);
  assert.match(readme, /DELETE `?\/api\/pm\/tasks\/:taskId\/dependencies\/:blockingTaskId`?/);
  assert.match(readme, /task dependency management/);
  assert.equal(packageJson.scripts["pm:bootstrap"], "node dist/pm/bootstrap.js");
  assert.equal(packageJson.scripts["test:pm:postgres"], "tsx --test tests/pmPostgres.integration.test.ts");
  assert.match(readme, /POST `?\/api\/pm\/projects\/:projectId\/invites`?/);
  assert.match(readme, /PM_WEBHOOK_URLS/);
  assert.match(readme, /X-ProjectEGO-Signature/);
  assert.match(readme, /pm\.webhook_deliveries/);
  assert.match(readme, /Webhooks operator panel/);
  assert.match(readme, /PM shell Ops panel/);
  assert.match(readme, /Dashboard visual system/);
  assert.match(readme, /first-run bootstrap form/);
  assert.match(readme, /PM_WEBHOOK_MAX_ATTEMPTS/);
  assert.match(readme, /SMTP_HOST/);
  assert.match(readme, /PM_AUTOMATION_TOKEN/);
  assert.match(readme, /GET `?\/api\/pm\/automation\/status`?/);
  assert.match(readme, /GET `?\/api\/pm\/automation\/projects\/boards`?/);
  assert.match(readme, /POST `?\/api\/pm\/automation\/projects\/:projectId\/tasks`?/);
  assert.match(readme, /POST `?\/api\/pm\/automation\/boards\/:boardId\/tasks`?/);
  assert.match(readme, /POST `?\/api\/pm\/automation\/projects\/:projectId\/boards\/default\/tasks`?/);
  assert.match(readme, /PM_BOOTSTRAP_USERNAME/);
  assert.match(readme, /PM_BOOTSTRAP_TOKEN/);
  assert.match(readme, /PM_AUTO_MIGRATE=true/);
  assert.match(compose, /PM_AUTO_MIGRATE: "true"/);
  assert.match(compose, /PM_BOOTSTRAP_TOKEN:/);
  assert.match(readme, /PM_TEST_DATABASE_URL/);
  assert.match(readme, /TrueNAS PM first-run order/);
  assert.match(readme, /POST `?\/api\/pm\/auth\/login`?/);
  assert.match(readme, /projectego_pm_session/);
  assert.match(readme, /ProjectEGO Admin/);
  assert.match(readme, /AUTH_MODE=core/);
  assert.match(readme, /CORE_DATABASE_URL/);
  assert.match(readme, /ADMIN_BOOTSTRAP_USERNAME/);
  assert.doesNotMatch(readme, /PM uses Authelia as the identity source/);
  assert.match(compose, /projectego-pm:/);
  assert.match(compose, /projectego-admin:/);
  assert.match(compose, /AUTH_MODE: core/);
  assert.match(compose, /CORE_DATABASE_URL: postgres:\/\/projectego_admin:/);
  assert.match(compose, /PM_DATABASE_URL: postgres:\/\/projectego_admin:/);
});

test("PM invite email points users to ProjectEGO PM account access", () => {
  const mail = buildPmInviteEmail({
    to: "member@example.test",
    inviterName: "Tris",
    projectName: "ProjectEGO",
    publicBaseUrl: "https://pm.project-ego.online"
  });

  assert.equal(mail.to, "member@example.test");
  assert.match(mail.subject, /ProjectEGO/);
  assert.match(mail.text, /https:\/\/pm\.project-ego\.online\//);
  assert.match(mail.text, /ProjectEGO PM account/);
  assert.match(mail.text, /grant PM access/);
  assert.doesNotMatch(mail.text, /password/i);
});

test("PM attachment validation accepts supported files and rejects unsafe inputs", () => {
  for (const name of ["note.txt", "design.png", "demo.mp4", "archive.zip"]) {
    assert.doesNotThrow(() => validatePmAttachmentFile(name, 128, 1024));
  }

  assert.throws(() => validatePmAttachmentFile("run.exe", 128, 1024), /Unsupported attachment extension/);
  assert.throws(() => validatePmAttachmentFile("large.txt", 2048, 1024), /exceeds/);
  assert.equal(sanitizePmFileName("../Пример file.txt"), "Пример file.txt");
});

test("PM task attachment storage uses internal names and path safety", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "projectego-pm-"));
  try {
    const tempPath = path.join(root, "upload.tmp");
    writeFileSync(tempPath, "hello");
    const stored = await storePmTaskAttachment({
      attachmentsDir: path.join(root, "attachments"),
      taskId: "task-1",
      tempPath,
      originalName: "example image.png",
      mimeType: "image/png",
      sizeBytes: 5,
      maxBytes: 1024
    });

    assert.equal(stored.originalFileName, "example image.png");
    assert.match(stored.storedFileName, /^PMATT_[a-f0-9]{20}\.png$/);
    assert.equal(path.basename(stored.storagePath), stored.storedFileName);
    assert.ok(stored.storagePath.includes(`${path.sep}attachments${path.sep}task-1${path.sep}`));
    assert.equal(resolveAttachmentPath(path.join(root, "attachments"), stored.storagePath), stored.storagePath);
    assert.throws(() => resolveAttachmentPath(path.join(root, "attachments"), path.join(root, "outside.txt")), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
