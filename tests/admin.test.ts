import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createAdminApp } from "../src/admin/server.js";
import type { AdminConfig } from "../src/admin/config.js";
import type { AdminStore, AdminUser } from "../src/admin/store.js";

const adminUser: AdminUser = {
  id: "user-1",
  username: "admin",
  email: "admin@example.test",
  displayName: "Admin",
  globalRole: "super_admin",
  dashboardAccess: true,
  pmAccess: true,
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const config: AdminConfig = {
  host: "127.0.0.1",
  port: 0,
  databaseUrl: "postgres://projectego_admin:test@postgres/projectego",
  sessionSecret: "test-session-secret",
  cookieSecure: false
};

test("Admin API manages shared user privileges behind admin session", async () => {
  const calls: string[] = [];
  const users = [adminUser];
  const fakeStore = {
    async bootstrapSuperuser() {
      calls.push("bootstrap");
    },
    async login(input: { usernameOrEmail: string; password: string }) {
      assert.equal(input.usernameOrEmail, "admin");
      assert.equal(input.password, "secret");
      return { user: adminUser, sessionToken: "session-token" };
    },
    async userBySession(token: string) {
      return token === "session-token" ? adminUser : null;
    },
    async logout() {},
    async listUsers() {
      return users;
    },
    async createUser(input: { username: string; dashboardAccess?: boolean; pmAccess?: boolean }) {
      const user = { ...adminUser, id: "user-2", username: input.username, dashboardAccess: Boolean(input.dashboardAccess), pmAccess: Boolean(input.pmAccess), globalRole: "user" as const };
      users.push(user);
      return user;
    },
    async updateUser(id: string, input: { dashboardAccess?: boolean; pmAccess?: boolean }) {
      const user = users.find((candidate) => candidate.id === id);
      if (!user) throw new Error("User not found.");
      user.dashboardAccess = input.dashboardAccess ?? user.dashboardAccess;
      user.pmAccess = input.pmAccess ?? user.pmAccess;
      return user;
    }
  } as unknown as AdminStore;

  const app = await createAdminApp(config, fakeStore);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const rejected = await fetch(`${baseUrl}/api/admin/users`);
    assert.equal(rejected.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernameOrEmail: "admin", password: "secret" })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie ?? "", /projectego_admin_session=session-token/);

    const create = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "projectego_admin_session=session-token" },
      body: JSON.stringify({ username: "operator", password: "secret-123", dashboardAccess: true, pmAccess: false })
    });
    assert.equal(create.status, 201);
    assert.equal((await create.json() as { user: AdminUser }).user.dashboardAccess, true);

    const update = await fetch(`${baseUrl}/api/admin/users/user-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "projectego_admin_session=session-token" },
      body: JSON.stringify({ pmAccess: true })
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json() as { user: AdminUser }).user.pmAccess, true);
    assert.deepEqual(calls, ["bootstrap"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
