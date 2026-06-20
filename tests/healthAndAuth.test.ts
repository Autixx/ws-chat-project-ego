import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { checkDatabaseHealth } from "../src/db/health.js";
import { ComponentStatusMonitor } from "../src/status/componentStatus.js";

function baseConfig(dir: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 19100,
    dataDir: dir,
    sqlitePath: path.join(dir, "projectego-chat.sqlite"),
    devAuthBypass: true,
    trustAutheliaHeaders: false,
    authMode: "local",
    registrationEnabled: true,
    cookieSecure: false,
    llmProvider: "mock",
    codexFallbackToMock: true,
    planeWorkspace: "projectego"
  };
}

function configWith(overrides: Partial<AppConfig>): AppConfig {
  return {
    ...baseConfig(path.join(os.tmpdir(), "projectego-status")),
    componentStatusTimeoutMs: 10,
    ...overrides
  };
}

function okFetch(status = 200): typeof fetch {
  return async () => new Response(status === 204 ? null : "", { status });
}

function failingFetch(error = new Error("network down")): typeof fetch {
  return async () => {
    throw error;
  };
}

test("checkDatabaseHealth returns ok for valid DB", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "projectego-health-"));
  const database = openDatabase(baseConfig(dir));
  try {
    const health = checkDatabaseHealth(database);
    assert.equal(health.status, "ok");
    assert.equal(health.quickCheck, "ok");
    assert.equal(health.writable, true);
  } finally {
    database.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkDatabaseHealth reports quick_check error", () => {
  const fake = {
    path: path.join(os.tmpdir(), "fake.sqlite"),
    db: {
      prepare(sql: string) {
        return {
          get() {
            if (sql === "SELECT 1 AS value") return { value: 1 };
            return { quick_check: "database disk image is malformed" };
          }
        };
      }
    }
  };

  const health = checkDatabaseHealth(fake as never);
  assert.equal(health.status, "error");
  assert.match(health.message ?? "", /quick_check/);
});

test("LLM-agent is misconfigured when codex provider has no agent URL", async () => {
  const monitor = new ComponentStatusMonitor(configWith({ llmProvider: "codex", codexAgentUrl: undefined }), okFetch());
  await monitor.poll();
  const status = monitor.snapshot({ path: "fake.sqlite", db: { prepare: () => ({ get: () => ({ value: 1 }) }) } as never });

  assert.equal(status.components.llmAgent.status, "misconfigured");
});

test("LLM-agent is reachable on 2xx and auth/method statuses", async () => {
  for (const httpStatus of [200, 204, 401, 403, 405]) {
    const monitor = new ComponentStatusMonitor(configWith({ llmProvider: "codex", codexAgentUrl: "http://agent.test" }), okFetch(httpStatus));
    await monitor.poll();
    const snapshot = monitor.snapshot(validFakeDb());
    assert.equal(snapshot.components.llmAgent.status, "reachable");
  }
});

test("LLM-agent is unreachable on network error", async () => {
  const monitor = new ComponentStatusMonitor(configWith({ llmProvider: "codex", codexAgentUrl: "http://agent.test" }), failingFetch());
  await monitor.poll();
  assert.equal(monitor.snapshot(validFakeDb()).components.llmAgent.status, "unreachable");
});

test("n8n is unconfigured when URL or token is missing", async () => {
  const monitor = new ComponentStatusMonitor(configWith({ n8nBaseUrl: "http://n8n.test", n8nWebhookToken: undefined }), okFetch());
  await monitor.poll();
  assert.equal(monitor.snapshot(validFakeDb()).components.n8n.status, "unconfigured");
});

test("n8n is unreachable when configured probe fails", async () => {
  const monitor = new ComponentStatusMonitor(configWith({ n8nBaseUrl: "http://n8n.test", n8nWebhookToken: "token" }), failingFetch());
  await monitor.poll();
  assert.equal(monitor.snapshot(validFakeDb()).components.n8n.status, "unreachable");
});

test("Plane unreachable does not make dashboard health fail", async () => {
  const monitor = new ComponentStatusMonitor(configWith({ planeBaseUrl: "http://plane.test" }), failingFetch());
  await monitor.poll();
  const snapshot = monitor.snapshot(validFakeDb());
  assert.equal(snapshot.components.plane.status, "unreachable");
  assert.equal(snapshot.status, "ok");
});

test("DB error still makes dashboard health error", async () => {
  const monitor = new ComponentStatusMonitor(configWith({ planeBaseUrl: "http://plane.test" }), okFetch());
  await monitor.poll();
  const snapshot = monitor.snapshot(invalidFakeDb());
  assert.equal(snapshot.status, "error");
});

function validFakeDb() {
  return {
    path: path.join(os.tmpdir(), "fake.sqlite"),
    db: {
      prepare(sql: string) {
        return {
          get() {
            if (sql === "SELECT 1 AS value") return { value: 1 };
            return { quick_check: "ok" };
          }
        };
      }
    }
  } as never;
}

function invalidFakeDb() {
  return {
    path: path.join(os.tmpdir(), "fake.sqlite"),
    db: {
      prepare(sql: string) {
        return {
          get() {
            if (sql === "SELECT 1 AS value") return { value: 1 };
            return { quick_check: "database disk image is malformed" };
          }
        };
      }
    }
  } as never;
}
