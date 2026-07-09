import type { Router } from "express";
import express from "express";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/database.js";
import { CoreAuth } from "./coreAuth.js";
import { LocalAuth } from "./localAuth.js";
import { getCookie, requireUserMiddleware } from "./requireUser.js";
import { localUserToAuthenticatedUser } from "./sessionStore.js";
import { SESSION_COOKIE_NAME, type LocalUser } from "./types.js";
import type { AuthContext } from "./requireUser.js";

export function createAuthRouter(config: AppConfig, database: AppDatabase): Router {
  const router = express.Router();
  const auth = config.authMode === "core" ? new CoreAuth(config) : new LocalAuth(database, config);
  router.use(express.json({ limit: "32kb" }));

  router.post("/api/auth/register", async (req, res) => {
    try {
      if (config.authMode !== "local") throw new Error("Registration is disabled in shared core auth mode.");
      const localAuth = auth as LocalAuth;
      const result = await localAuth.registerUser({
        username: String(req.body?.username ?? ""),
        email: typeof req.body?.email === "string" ? req.body.email : undefined,
        password: String(req.body?.password ?? ""),
        displayName: typeof req.body?.displayName === "string" ? req.body.displayName : undefined,
        inviteCode: String(req.body?.inviteCode ?? ""),
        req
      });
      setSessionCookie(res, config, result.sessionToken);
      res.json({ user: safeUser(result.user) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Registration failed." });
    }
  });

  router.post("/api/auth/login", async (req, res) => {
    try {
      const result = await auth.loginUser({
        usernameOrEmail: String(req.body?.usernameOrEmail ?? ""),
        password: String(req.body?.password ?? ""),
        req
      });
      setSessionCookie(res, config, result.sessionToken);
      res.json({ user: safeUser(result.user) });
    } catch {
      res.status(401).json({ error: "Invalid username/email or password." });
    }
  });

  router.post("/api/auth/logout", async (req, res) => {
    const token = getCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (token) await auth.logoutSession(token);
    clearSessionCookie(res, config);
    res.json({ ok: true });
  });

  router.get("/api/auth/me", requireUserMiddleware(config, database), (req, res) => {
    res.json({ user: (req as express.Request & { auth?: AuthContext }).auth?.user });
  });

  return router;
}

export function setSessionCookie(res: express.Response, config: AppConfig, sessionToken: string): void {
  res.cookie(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/"
  });
}

export function clearSessionCookie(res: express.Response, config: AppConfig): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/"
  });
}

function safeUser(user: LocalUser) {
  return localUserToAuthenticatedUser(user);
}
