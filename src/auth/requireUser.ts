import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config.js";
import { getAutheliaUser, type AuthenticatedUser } from "./authelia.js";
import { PlaneAuthorization } from "./planeAuthorization.js";

export type AuthContext = {
  user: AuthenticatedUser;
};

export async function requireUserForRequest(req: IncomingMessage, config: AppConfig): Promise<AuthenticatedUser> {
  const user = getAutheliaUser(req, {
    devAuthBypass: config.devAuthBypass,
    trustAutheliaHeaders: config.trustAutheliaHeaders
  });
  if (!user) throw new AuthError(401, "Authentication required.");

  if (config.authzProvider === "plane_workspace") {
    const authz = new PlaneAuthorization(config);
    const result = await authz.authorizeUser(user);
    if (!result.allowed) throw new AuthError(403, result.reason);
  }

  return user;
}

export function requireUserMiddleware(config: AppConfig) {
  return async (req: Request & { auth?: AuthContext }, res: Response, next: NextFunction) => {
    try {
      req.auth = { user: await requireUserForRequest(req, config) };
      next();
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}
