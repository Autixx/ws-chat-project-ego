import express from "express";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { WebSocketServer } from "ws";
import { getAutheliaUser, type AuthenticatedUser } from "../auth/authelia.js";
import { assertPmCanStart, forbiddenPmEnv, loadPmConfig, PM_FORBIDDEN_ENV_KEYS, type PmConfig } from "./config.js";
import { PmEventHub } from "./events.js";

type PmAuthedRequest = express.Request & { pmUser?: AuthenticatedUser };

const config = loadPmConfig();
assertPmCanStart(config);
await fs.mkdir(config.attachmentsDir, { recursive: true });

const app = createPmApp(config);
const server = createServer(app);
const eventHub = new PmEventHub();
const wsServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/pm/ws") {
    socket.destroy();
    return;
  }

  const user = getAutheliaUser(req, {
    devAuthBypass: config.devAuthBypass,
    trustAutheliaHeaders: config.trustAutheliaHeaders
  });
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

server.listen(config.port, config.host, () => {
  console.log(`ProjectEGO PM listening on http://${config.host}:${config.port}`);
});

export function createPmApp(pmConfig: PmConfig): express.Express {
  const pmApp = express();
  pmApp.disable("x-powered-by");
  pmApp.use(express.json({ limit: "256kb" }));

  pmApp.get("/health", (_req, res) => {
    const forbidden = forbiddenPmEnv();
    res.status(forbidden.length === 0 && pmConfig.databaseUrl ? 200 : 503).json({
      status: forbidden.length === 0 && pmConfig.databaseUrl ? "ok" : "misconfigured",
      service: "projectego-pm",
      databaseConfigured: Boolean(pmConfig.databaseUrl),
      forbiddenEnvPresent: forbidden
    });
  });

  pmApp.use("/api/pm", requirePmUser(pmConfig));

  pmApp.get("/api/pm/me", (req: PmAuthedRequest, res) => {
    res.json({ user: req.pmUser });
  });

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

  return pmApp;
}

function requirePmUser(pmConfig: PmConfig) {
  return (req: PmAuthedRequest, res: express.Response, next: express.NextFunction) => {
    const user = getAutheliaUser(req, {
      devAuthBypass: pmConfig.devAuthBypass,
      trustAutheliaHeaders: pmConfig.trustAutheliaHeaders
    });
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    req.pmUser = user;
    next();
  };
}
