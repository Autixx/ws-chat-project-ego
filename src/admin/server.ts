import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAdminConfig, type AdminConfig } from "./config.js";
import { AdminStore, type AdminUser } from "./store.js";

const ADMIN_COOKIE = "projectego_admin_session";

type AdminRequest = express.Request & { adminUser?: AdminUser };

export async function createAdminApp(config: AdminConfig, store: AdminStore): Promise<express.Express> {
  await store.bootstrapSuperuser();
  const app = express();
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "admin");
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "projectego-admin" }));

  app.post("/api/admin/login", async (req, res) => {
    try {
      const result = await store.login({ usernameOrEmail: String(req.body?.usernameOrEmail ?? ""), password: String(req.body?.password ?? ""), req });
      setAdminCookie(res, config, result.sessionToken);
      res.json({ user: result.user });
    } catch {
      res.status(401).json({ error: "Invalid username/email or password." });
    }
  });

  app.post("/api/admin/logout", requireAdmin(store), async (req, res) => {
    const token = getCookie(req.headers.cookie, ADMIN_COOKIE);
    if (token) await store.logout(token);
    clearAdminCookie(res, config);
    res.json({ ok: true });
  });

  app.get("/api/admin/me", requireAdmin(store), (req: AdminRequest, res) => res.json({ user: req.adminUser }));
  app.get("/api/admin/users", requireAdmin(store), async (_req, res, next) => {
    try {
      res.json({ users: await store.listUsers() });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/admin/users", requireAdmin(store), async (req, res, next) => {
    try {
      res.status(201).json({ user: await store.createUser(req.body ?? {}) });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/admin/users/:userId", requireAdmin(store), async (req, res, next) => {
    try {
      res.json({ user: await store.updateUser(req.params.userId, req.body ?? {}) });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(publicDir, { extensions: ["html"] }));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof Error && /not found/i.test(error.message) ? 404 : 400).json({ error: error instanceof Error ? error.message : String(error) });
  });
  return app;
}

export async function startAdminServer(config = loadAdminConfig()): Promise<void> {
  if (!config.databaseUrl) throw new Error("ADMIN_DATABASE_URL or PM_DATABASE_URL is required.");
  if (process.env.NODE_ENV === "production" && !config.sessionSecret) throw new Error("ADMIN_SESSION_SECRET or SESSION_SECRET is required in production.");
  const store = new AdminStore(config);
  const app = await createAdminApp(config, store);
  const server = createServer(app);
  server.listen(config.port, config.host, () => console.log(`ProjectEGO Admin listening on http://${config.host}:${config.port}`));
}

function requireAdmin(store: AdminStore) {
  return async (req: AdminRequest, res: express.Response, next: express.NextFunction) => {
    try {
      const token = getCookie(req.headers.cookie, ADMIN_COOKIE);
      if (!token) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      const user = await store.userBySession(token);
      if (!user) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      req.adminUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function setAdminCookie(res: express.Response, config: AdminConfig, sessionToken: string): void {
  res.cookie(ADMIN_COOKIE, sessionToken, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/" });
}

function clearAdminCookie(res: express.Response, config: AdminConfig): void {
  res.clearCookie(ADMIN_COOKIE, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/" });
}

function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

const isEntrypoint = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isEntrypoint) await startAdminServer();
