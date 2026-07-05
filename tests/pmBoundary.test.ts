import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { resolveAttachmentPath, sanitizePmFileName, storePmTaskAttachment, validatePmAttachmentFile } from "../src/pm/attachmentService.js";
import { assertPmCanStart, forbiddenPmEnv, loadPmConfig } from "../src/pm/config.js";
import { canManageProject, canViewProject, canWriteProject, requireProjectRole } from "../src/pm/permissions.js";
import { createPmApp } from "../src/pm/server.js";

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
  assert.equal(config.databaseUrl, "postgres://pm:test@postgres/projectego");
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

  for (const table of ["pm.projects", "pm.epics", "pm.boards", "pm.sprints", "pm.tasks", "pm.task_dependencies", "pm.comments", "pm.attachments", "audit.events"]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace(".", "\\.")}`));
  }

  assert.match(schema, /actor_type TEXT NOT NULL CHECK \(actor_type IN \('user', 'system', 'n8n', 'agent'\)\)/);
  assert.match(schema, /storage_path TEXT NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS pm\.board_columns/);
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
  assert.match(readme, /POST `?\/api\/pm\/projects\/:projectId\/boards\/kanban\/default`?/);
  assert.match(readme, /GET `?\/api\/pm\/boards\/:boardId`?/);
  assert.match(readme, /drag-and-drop task movement/);
  assert.match(readme, /GET `?\/api\/pm\/projects\/:projectId\/sprints`?/);
  assert.match(readme, /POST `?\/api\/pm\/tasks\/:taskId\/sprint`?/);
  assert.match(readme, /backlog and sprint planning/);
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
