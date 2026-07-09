import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { verifyPassword } from "./password.js";
import type { LocalUser } from "./types.js";

const SESSION_DAYS = 30;

type CoreUserRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  global_role: string;
  dashboard_access: boolean;
  disabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  password_hash?: string | null;
};

export class CoreAuth {
  private readonly pool: Pool;

  constructor(private readonly config: AppConfig) {
    if (!config.coreDatabaseUrl) throw new Error("CORE_DATABASE_URL or PM_DATABASE_URL is required for AUTH_MODE=core.");
    this.pool = new Pool({ connectionString: config.coreDatabaseUrl });
  }

  async loginUser(input: { usernameOrEmail: string; password: string; req?: IncomingMessage }): Promise<{ user: LocalUser; sessionToken: string }> {
    const lookup = input.usernameOrEmail.trim().toLowerCase();
    const result = await this.pool.query(
      `
      SELECT id, username, email, display_name, global_role, dashboard_access, disabled, created_at, updated_at, password_hash
      FROM core.users
      WHERE (lower(username) = $1 OR lower(email) = $1)
        AND disabled = false
        AND dashboard_access = true
      LIMIT 1
      `,
      [lookup]
    );
    const row = result.rows[0] as CoreUserRow | undefined;
    if (!row?.password_hash || !(await verifyPassword(row.password_hash, input.password))) throw new Error("Invalid username/email or password.");
    const user = rowToLocalUser(row);
    return { user, sessionToken: await this.createSession(user, input.req) };
  }

  async getUserBySession(sessionToken: string): Promise<LocalUser | null> {
    if (!sessionToken) return null;
    const result = await this.pool.query(
      `
      SELECT u.id, u.username, u.email, u.display_name, u.global_role, u.dashboard_access, u.disabled, u.created_at, u.updated_at
      FROM core.sessions s
      JOIN core.users u ON u.id = s.user_id
      WHERE s.session_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.disabled = false
        AND u.dashboard_access = true
      LIMIT 1
      `,
      [this.hashSessionToken(sessionToken)]
    );
    return result.rows[0] ? rowToLocalUser(result.rows[0] as CoreUserRow) : null;
  }

  async logoutSession(sessionToken: string): Promise<void> {
    await this.pool.query("UPDATE core.sessions SET revoked_at = now() WHERE session_hash = $1", [this.hashSessionToken(sessionToken)]);
  }

  private async createSession(user: LocalUser, req?: IncomingMessage): Promise<string> {
    const sessionToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.pool.query(
      `
      INSERT INTO core.sessions (user_id, session_hash, expires_at, user_agent, ip_hash)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [user.id, this.hashSessionToken(sessionToken), expiresAt, req?.headers["user-agent"] ?? null, req?.socket.remoteAddress ? this.hashSessionToken(req.socket.remoteAddress) : null]
    );
    return sessionToken;
  }

  private hashSessionToken(token: string): string {
    return createHmac("sha256", this.config.sessionSecret ?? "dev-session-secret").update(token).digest("hex");
  }
}

function rowToLocalUser(row: CoreUserRow): LocalUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: row.email ?? undefined,
    displayName: row.display_name ?? undefined,
    role: row.global_role,
    disabled: Boolean(row.disabled),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at)
  };
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
