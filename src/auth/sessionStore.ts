import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/database.js";
import { createId } from "../utils/ids.js";
import type { AuthenticatedUser } from "./authelia.js";
import type { LocalUser } from "./types.js";

const SESSION_DAYS = 30;

type UserSessionRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: string;
  disabled: number;
  created_at: string;
  updated_at: string;
};

export class SessionStore {
  constructor(
    private readonly database: AppDatabase,
    private readonly config: AppConfig
  ) {}

  async createSession(user: LocalUser, req?: IncomingMessage): Promise<string> {
    const sessionToken = randomBytes(48).toString("base64url");
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    this.database.db
      .prepare(
        `INSERT INTO sessions (id, user_id, session_hash, created_at, expires_at, user_agent, ip_hash)
         VALUES (@id, @userId, @sessionHash, @createdAt, @expiresAt, @userAgent, @ipHash)`
      )
      .run({
        id: createId("S"),
        userId: user.id,
        sessionHash: this.hashSessionToken(sessionToken),
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        userAgent: req?.headers["user-agent"] ?? null,
        ipHash: req?.socket.remoteAddress ? this.hashSessionToken(req.socket.remoteAddress) : null
      });
    return sessionToken;
  }

  async getSessionUser(sessionToken: string): Promise<LocalUser | null> {
    if (!sessionToken) return null;
    const row = this.database.db
      .prepare(
        `SELECT u.id, u.username, u.email, u.display_name, u.role, u.disabled, u.created_at, u.updated_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled = 0`
      )
      .get(this.hashSessionToken(sessionToken), new Date().toISOString()) as UserSessionRow | undefined;
    return row ? rowToLocalUser(row) : null;
  }

  async revokeSession(sessionToken: string): Promise<void> {
    if (!sessionToken) return;
    this.database.db.prepare("UPDATE sessions SET revoked_at = ? WHERE session_hash = ?").run(new Date().toISOString(), this.hashSessionToken(sessionToken));
  }

  async cleanupExpiredSessions(): Promise<void> {
    this.database.db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(new Date().toISOString());
  }

  hashSessionToken(token: string): string {
    return createHmac("sha256", this.config.sessionSecret ?? "dev-session-secret").update(token).digest("hex");
  }
}

export function localUserToAuthenticatedUser(user: LocalUser): AuthenticatedUser {
  return {
    username: user.username,
    email: user.email,
    name: user.displayName || user.username,
    groups: [user.role]
  };
}

function rowToLocalUser(row: UserSessionRow): LocalUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? undefined,
    displayName: row.display_name ?? undefined,
    role: row.role,
    disabled: Boolean(row.disabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
