import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertPmCanStart, forbiddenPmEnv, loadPmConfig } from "../src/pm/config.js";

test("PM config defaults to a separate service port and data area", () => {
  const config = loadPmConfig({
    NODE_ENV: "development",
    DATA_DIR: "/app/dashboard-data",
    PM_DATABASE_URL: "postgres://pm:test@postgres/projectego"
  });

  assert.equal(config.port, 19110);
  assert.equal(config.dataDir, "/app/dashboard-data");
  assert.equal(config.attachmentsDir, "/app/dashboard-data/attachments");
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
});
