import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { checkDatabaseHealth } from "../src/db/health.js";

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
