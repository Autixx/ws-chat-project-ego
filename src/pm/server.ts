import express from "express";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { AuthenticatedUser } from "../auth/authelia.js";
import { getCookie } from "../auth/requireUser.js";
import { PM_SESSION_COOKIE_NAME, PmCoreAuth } from "./auth.js";
import { assertPmCanStart, forbiddenPmEnv, loadPmConfig, PM_FORBIDDEN_ENV_KEYS, type PmConfig } from "./config.js";
import { PmEventHub } from "./events.js";
import { PmWebhookDispatcher } from "./webhookDispatcher.js";
import { PmStore } from "./postgresStore.js";
import { createPmAutomationRouter } from "./automationRoutes.js";
import { createPmRouter } from "./routes.js";
import { runPmMigrations } from "./migrate.js";

type PmIdentityRequest = express.Request & { pmIdentity?: AuthenticatedUser };

export function createPmApp(pmConfig: PmConfig, store?: PmStore, events = new PmEventHub()): express.Express {
  const pmApp = express();
  const pmPublicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "pm");
  const pmAuth = store && pmConfig.databaseUrl && !pmConfig.devAuthBypass ? new PmCoreAuth(pmConfig) : undefined;
  pmApp.disable("x-powered-by");
  pmApp.use(express.json({ limit: "256kb" }));

  pmApp.get("/health", async (_req, res) => {
    const forbidden = forbiddenPmEnv();
    const databaseHealth = store ? await store.health() : { ok: false, message: "PM_DATABASE_URL is not configured." };
    res.status(forbidden.length === 0 && databaseHealth.ok ? 200 : 503).json({
      status: forbidden.length === 0 && databaseHealth.ok ? "ok" : "misconfigured",
      service: "projectego-pm",
      databaseConfigured: Boolean(pmConfig.databaseUrl),
      databaseReachable: databaseHealth.ok,
      databaseMessage: databaseHealth.message,
      forbiddenEnvPresent: forbidden
    });
  });

  const webhooks = new PmWebhookDispatcher(pmConfig.webhooks, store);
  if (store) {
    pmApp.use("/api/pm/automation", createPmAutomationRouter(store, events, { pmConfig, webhooks }));
  }

  if (pmAuth) {
    pmApp.post("/api/pm/auth/login", async (req, res) => {
      try {
        const result = await pmAuth.login({ usernameOrEmail: String(req.body?.usernameOrEmail ?? ""), password: String(req.body?.password ?? ""), req });
        setPmCookie(res, result.sessionToken);
        res.json({ user: result.user });
      } catch {
        res.status(401).json({ error: "Invalid username/email or password." });
      }
    });
    pmApp.post("/api/pm/auth/logout", async (req, res) => {
      const token = getCookie(req.headers.cookie, PM_SESSION_COOKIE_NAME);
      if (token) await pmAuth.logout(token);
      clearPmCookie(res);
      res.json({ ok: true });
    });
  }

  pmApp.use("/api/pm", requirePmIdentity(pmConfig, pmAuth));

  pmApp.get("/api/pm/security-boundary", (_req, res) => {
    res.json({
      service: "projectego-pm",
      forbiddenEnvKeys: PM_FORBIDDEN_ENV_KEYS,
      forbiddenEnvPresent: forbiddenPmEnv(),
      agentAccess: false,
      dashboardChatAccess: false,
      automationSecretAccess: false
    });
  });

  pmApp.get("/api/pm/architecture", (_req, res) => {
    res.json({
      dataSource: "postgresql",
      schemas: ["core", "pm", "agent", "automation", "audit"],
      websocketPath: "/pm/ws",
      apiBoundary: "PM endpoints stay under /api/pm and do not expose Dashboard agent functions."
    });
  });

  if (store) {
    pmApp.use("/api/pm", createPmRouter(store, events, { attachmentsDir: pmConfig.attachmentsDir, maxAttachmentBytes: pmConfig.maxAttachmentBytes, pmConfig, webhooks }));
  } else {
    pmApp.use("/api/pm", (_req, res) => {
      res.status(503).json({ error: "PM_DATABASE_URL is required before PM API can serve project data." });
    });
  }

  pmApp.use(express.static(pmPublicDir, { extensions: ["html"] }));
  pmApp.get("*", (_req, res) => {
    res.sendFile(path.join(pmPublicDir, "index.html"));
  });

  return pmApp;
}

export async function startPmServer(pmConfig = loadPmConfig()): Promise<void> {
  assertPmCanStart(pmConfig);
  await fs.mkdir(pmConfig.attachmentsDir, { recursive: true });
  await fs.mkdir(path.join(pmConfig.attachmentsDir, "tmp"), { recursive: true });
  if (pmConfig.databaseUrl && pmConfig.autoMigrate) {
    await runPmMigrations(pmConfig.databaseUrl, process.env.PM_SCHEMA_PATH);
    console.log("ProjectEGO PM migrations applied.");
  }

  const eventHub = new PmEventHub();
  const store = pmConfig.databaseUrl ? new PmStore(pmConfig.databaseUrl) : undefined;
  const pmAuth = store && pmConfig.databaseUrl && !pmConfig.devAuthBypass ? new PmCoreAuth(pmConfig) : undefined;
  const app = createPmApp(pmConfig, store, eventHub);
  const server = createServer(app);
  const wsServer = new WebSocketServer({ noServer: true });
  const webhooks = new PmWebhookDispatcher(pmConfig.webhooks, store);
  const webhookRetryTimer =
    store && webhooks.enabled
      ? setInterval(() => {
          void webhooks.retryDue().then((deliveries) => {
            for (const delivery of deliveries) {
              if (!delivery.ok) console.warn("PM webhook retry failed", delivery);
            }
          });
        }, pmConfig.webhooks.retryIntervalMs)
      : undefined;
  webhookRetryTimer?.unref();

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/pm/ws") {
      socket.destroy();
      return;
    }

    const user = await resolvePmIdentity(req, pmConfig, pmAuth);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(req, socket, head, (client) => {
      eventHub.add(client);
      client.send(
        JSON.stringify({
          type: "presence.updated",
          createdAt: new Date().toISOString(),
          payload: { username: user.username, connected: true }
        })
      );
    });
  });

  server.listen(pmConfig.port, pmConfig.host, () => {
    console.log(`ProjectEGO PM listening on http://${pmConfig.host}:${pmConfig.port}`);
  });
}

function requirePmIdentity(pmConfig: PmConfig, pmAuth?: PmCoreAuth) {
  return async (req: PmIdentityRequest, res: express.Response, next: express.NextFunction) => {
    const user = await resolvePmIdentity(req, pmConfig, pmAuth);
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    req.pmIdentity = user;
    next();
  };
}

async function resolvePmIdentity(req: express.Request | import("node:http").IncomingMessage, pmConfig: PmConfig, pmAuth?: PmCoreAuth): Promise<AuthenticatedUser | null> {
  const token = getCookie(req.headers.cookie, PM_SESSION_COOKIE_NAME);
  if (token && pmAuth) return pmAuth.userBySession(token);
  if (pmConfig.devAuthBypass) {
    return { username: "local-dev", email: "local-dev@example.test", name: "Local Dev", groups: ["dev"] };
  }
  return null;
}

function setPmCookie(res: express.Response, sessionToken: string): void {
  res.cookie(PM_SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.PM_COOKIE_SECURE === "true" || process.env.COOKIE_SECURE === "true",
    path: "/"
  });
}

function clearPmCookie(res: express.Response): void {
  res.clearCookie(PM_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.PM_COOKIE_SECURE === "true" || process.env.COOKIE_SECURE === "true",
    path: "/"
  });
}

const isEntrypoint = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isEntrypoint) await startPmServer();
