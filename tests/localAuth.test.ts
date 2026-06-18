import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import type { AppConfig } from "../src/config.js";
import { LocalAuth } from "../src/auth/localAuth.js";
import { hashPassword, validatePassword, verifyPassword } from "../src/auth/password.js";
import { getCookie, requireUserForRequest, requireUserMiddleware } from "../src/auth/requireUser.js";
import { SESSION_COOKIE_NAME } from "../src/auth/types.js";
import { openDatabase } from "../src/db/database.js";

function baseConfig(dir: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 19100,
    dataDir: dir,
    sqlitePath: path.join(dir, "projectego-chat.sqlite"),
    devAuthBypass: true,
    trustAutheliaHeaders: false,
    authMode: "local",
    sessionSecret: "test-session-secret",
    registrationEnabled: true,
    registrationInviteCode: "invite",
    cookieSecure: false,
    llmProvider: "mock",
    codexFallbackToMock: true,
    planeWorkspace: "projectego"
  };
}

function authFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "projectego-auth-"));
  const config = baseConfig(dir);
  const database = openDatabase(config);
  const auth = new LocalAuth(database, config);
  return {
    dir,
    config,
    database,
    auth,
    cleanup: () => {
      database.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("password hashing and verification uses non-plaintext hash", async () => {
  const hash = await hashPassword("LongPassword123");
  assert.notEqual(hash, "LongPassword123");
  assert.equal(await verifyPassword(hash, "LongPassword123"), true);
  assert.equal(await verifyPassword(hash, "wrong"), false);
  assert.throws(() => validatePassword("short", "tester"), /at least 10/);
});

test("registration succeeds with valid invite code", async () => {
  const f = authFixture();
  try {
    const result = await f.auth.registerUser({ username: "tester", email: "tester@example.test", password: "LongPassword123", inviteCode: "invite" });
    assert.equal(result.user.username, "tester");
    assert.ok(result.sessionToken);
  } finally {
    f.cleanup();
  }
});

test("registration rejects invalid invite code", async () => {
  const f = authFixture();
  try {
    await assert.rejects(
      f.auth.registerUser({ username: "tester", email: "tester@example.test", password: "LongPassword123", inviteCode: "bad" }),
      /Invalid invite code/
    );
  } finally {
    f.cleanup();
  }
});

test("login succeeds and failure uses generic error", async () => {
  const f = authFixture();
  try {
    await f.auth.registerUser({ username: "tester", email: "tester@example.test", password: "LongPassword123", inviteCode: "invite" });
    const login = await f.auth.loginUser({ usernameOrEmail: "tester@example.test", password: "LongPassword123" });
    assert.equal(login.user.username, "tester");
    await assert.rejects(f.auth.loginUser({ usernameOrEmail: "tester@example.test", password: "wrong" }), /Invalid username\/email or password/);
  } finally {
    f.cleanup();
  }
});

test("session creation lookup and logout revocation", async () => {
  const f = authFixture();
  try {
    const registered = await f.auth.registerUser({ username: "tester", password: "LongPassword123", inviteCode: "invite" });
    assert.equal((await f.auth.getUserBySession(registered.sessionToken))?.username, "tester");
    await f.auth.logoutSession(registered.sessionToken);
    assert.equal(await f.auth.getUserBySession(registered.sessionToken), null);
  } finally {
    f.cleanup();
  }
});

test("requireUserForRequest rejects missing session", async () => {
  const f = authFixture();
  try {
    const req = new http.IncomingMessage(null as never);
    await assert.rejects(requireUserForRequest(req, f.config, f.database), /Authentication required/);
  } finally {
    f.cleanup();
  }
});

test("protected upload and download-style endpoints reject unauthenticated request", async () => {
  const f = authFixture();
  const app = express();
  app.post("/api/uploads", requireUserMiddleware(f.config, f.database), (_req, res) => res.json({ ok: true }));
  app.get("/api/attachments/:attachmentId", requireUserMiddleware(f.config, f.database), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const port = typeof address === "object" && address ? address.port : 0;
    const upload = await fetch(`http://127.0.0.1:${port}/api/uploads`, { method: "POST" });
    const download = await fetch(`http://127.0.0.1:${port}/api/attachments/ATT-test`);
    assert.equal(upload.status, 401);
    assert.equal(download.status, 401);
  } finally {
    server.close();
    f.cleanup();
  }
});

test("getCookie extracts session cookie", () => {
  assert.equal(getCookie(`${SESSION_COOKIE_NAME}=abc; other=1`, SESSION_COOKIE_NAME), "abc");
});
