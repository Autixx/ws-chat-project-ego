import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  for (const table of ["pm.projects", "pm.epics", "pm.boards", "pm.sprints", "pm.tasks", "pm.task_dependencies", "pm.comments", "pm.attachments", "pm.notifications", "pm.webhook_deliveries", "audit.events"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace(".", "\\.")}`));
  }

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
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("PM README documents Kanban board API", () => {
  const readme = readFileSync(path.resolve("README.md"), "utf8");
  const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
  const compose = readFileSync(path.resolve("docker-compose.yml"), "utf8");
  assert.match(readme, /POST `?\/api\/pm\/projects\/:projectId\/boards\/kanban\/default`?/);
  assert.match(readme, /GET `?\/api\/pm\/boards\/:boardId`?/);
  assert.match(readme, /drag-and-drop task movement/);
  assert.match(readme, /GET `?\/api\/pm\/projects\/:projectId\/sprints`?/);
  assert.match(readme, /POST `?\/api\/pm\/tasks\/:taskId\/sprint`?/);
  assert.match(readme, /backlog and sprint planning/);
  assert.match(readme, /GET `?\/api\/pm\/notifications`?/);
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
  assert.match(readme, /PM_WEBHOOK_MAX_ATTEMPTS/);
  assert.match(readme, /SMTP_HOST/);
  assert.match(readme, /PM_AUTOMATION_TOKEN/);
  assert.match(readme, /GET `?\/api\/pm\/automation\/status`?/);
  assert.match(readme, /POST `?\/api\/pm\/automation\/projects\/:projectId\/tasks`?/);
  assert.match(readme, /PM_BOOTSTRAP_USERNAME/);
  assert.match(readme, /PM_AUTO_MIGRATE=true/);
  assert.match(compose, /PM_AUTO_MIGRATE: "true"/);
  assert.match(readme, /PM_TEST_DATABASE_URL/);
  assert.match(readme, /TrueNAS PM first-run order/);
  assert.match(readme, /Remote-User/);
  assert.match(compose, /projectego-pm:/);
  assert.match(compose, /PM_DATABASE_URL: postgres:\/\/projectego_admin:/);
});

test("PM invite email keeps authentication in the existing identity provider", () => {
  const mail = buildPmInviteEmail({
    to: "member@example.test",
    inviterName: "Tris",
    projectName: "ProjectEGO",
    publicBaseUrl: "https://pm.project-ego.online"
  });

  assert.equal(mail.to, "member@example.test");
  assert.match(mail.subject, /ProjectEGO/);
  assert.match(mail.text, /https:\/\/pm\.project-ego\.online\//);
  assert.match(mail.text, /identity provider/);
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
