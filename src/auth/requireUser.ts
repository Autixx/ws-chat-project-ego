import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/database.js";
import type { AuthenticatedUser } from "./authelia.js";
import { CoreAuth } from "./coreAuth.js";
import { LocalAuth } from "./localAuth.js";
import { localUserToAuthenticatedUser } from "./sessionStore.js";
import { SESSION_COOKIE_NAME } from "./types.js";

export type AuthContext = {
  user: AuthenticatedUser;
};

const coreAuthByDatabaseUrl = new Map<string, CoreAuth>();

export async function requireUserForRequest(req: IncomingMessage, config: AppConfig, database: AppDatabase): Promise<AuthenticatedUser> {
  const token = getCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (!token) throw new AuthError(401, "Authentication required.");
  const auth = config.authMode === "core" ? getCoreAuth(config) : new LocalAuth(database, config);
  const user = await auth.getUserBySession(token);
  if (!user) throw new AuthError(401, "Authentication required.");
  return localUserToAuthenticatedUser(user);
}

export function requireUserMiddleware(config: AppConfig, database: AppDatabase) {
  return async (req: Request & { auth?: AuthContext }, res: Response, next: NextFunction) => {
    try {
      req.auth = { user: await requireUserForRequest(req, config, database) };
      next();
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Authentication failed." });
    }
  };
}

export function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function getCoreAuth(config: AppConfig): CoreAuth {
  const key = config.coreDatabaseUrl ?? "";
  const existing = coreAuthByDatabaseUrl.get(key);
  if (existing) return existing;
  const created = new CoreAuth(config);
  coreAuthByDatabaseUrl.set(key, created);
  return created;
}
