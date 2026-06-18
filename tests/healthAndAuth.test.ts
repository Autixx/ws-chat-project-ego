import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { checkDatabaseHealth } from "../src/db/health.js";
import { PlaneAuthorization } from "../src/auth/planeAuthorization.js";

function baseConfig(dir: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 19100,
    dataDir: dir,
    sqlitePath: path.join(dir, "projectego-chat.sqlite"),
    devAuthBypass: true,
    trustAutheliaHeaders: false,
    authzProvider: "none",
    llmProvider: "mock",
    codexFallbackToMock: true,
    planeWorkspace: "projectego"
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

test("PlaneAuthorization allows matching member", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ user: { email: "member@example.test", username: "member" } }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  try {
    const authz = new PlaneAuthorization({ ...baseConfig(os.tmpdir()), planeBaseUrl: "https://plane.test", planeApiKey: "token", authzProvider: "plane_workspace" });
    const result = await authz.authorizeUser({ username: "member", email: "member@example.test", groups: [] });
    assert.deepEqual(result, { allowed: true });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("PlaneAuthorization denies non-member", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ user: { email: "other@example.test" } }]), { status: 200 });
  try {
    const authz = new PlaneAuthorization({ ...baseConfig(os.tmpdir()), planeBaseUrl: "https://plane.test", planeApiKey: "token", authzProvider: "plane_workspace" });
    const result = await authz.authorizeUser({ username: "member", email: "member@example.test", groups: [] });
    assert.equal(result.allowed, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("PlaneAuthorization denies unavailable Plane", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Plane unavailable");
  };
  try {
    const authz = new PlaneAuthorization({ ...baseConfig(os.tmpdir()), planeBaseUrl: "https://plane.test", planeApiKey: "token", authzProvider: "plane_workspace" });
    const result = await authz.authorizeUser({ username: "member", email: "member@example.test", groups: [] });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Plane unavailable/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
