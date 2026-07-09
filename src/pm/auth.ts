import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/authelia.js";
import { verifyPassword } from "../auth/password.js";
import type { PmConfig } from "./config.js";

const SESSION_DAYS = 30;
export const PM_SESSION_COOKIE_NAME = "projectego_pm_session";

type CoreUserRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  global_role: string;
  pm_access: boolean;
  disabled: boolean;
  password_hash?: string | null;
};

export class PmCoreAuth {
  private readonly pool: Pool;

  constructor(private readonly config: PmConfig) {
    if (!config.databaseUrl) throw new Error("PM_DATABASE_URL is required for PM authentication.");
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async login(input: { usernameOrEmail: string; password: string; req?: IncomingMessage }): Promise<{ user: AuthenticatedUser; sessionToken: string }> {
    const lookup = input.usernameOrEmail.trim().toLowerCase();
    const result = await this.pool.query(
      `
      SELECT id, username, email, display_name, global_role, pm_access, disabled, password_hash
      FROM core.users
      WHERE (lower(username) = $1 OR lower(email) = $1)
        AND disabled = false
        AND (pm_access = true OR global_role IN ('super_admin', 'admin'))
      LIMIT 1
      `,
      [lookup]
    );
    const row = result.rows[0] as CoreUserRow | undefined;
    if (!row?.password_hash || !(await verifyPassword(row.password_hash, input.password))) throw new Error("Invalid username/email or password.");
    const user = rowToIdentity(row);
    return { user, sessionToken: await this.createSession(row.id, input.req) };
  }

  async userBySession(sessionToken: string): Promise<AuthenticatedUser | null> {
    const result = await this.pool.query(
      `
      SELECT u.id, u.username, u.email, u.display_name, u.global_role, u.pm_access, u.disabled
      FROM core.sessions s
      JOIN core.users u ON u.id = s.user_id
      WHERE s.session_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.disabled = false
        AND (u.pm_access = true OR u.global_role IN ('super_admin', 'admin'))
      LIMIT 1
      `,
      [this.hashSessionToken(sessionToken)]
    );
    return result.rows[0] ? rowToIdentity(result.rows[0] as CoreUserRow) : null;
  }

  async logout(sessionToken: string): Promise<void> {
    await this.pool.query("UPDATE core.sessions SET revoked_at = now() WHERE session_hash = $1", [this.hashSessionToken(sessionToken)]);
  }

  private async createSession(userId: string, req?: IncomingMessage): Promise<string> {
    const sessionToken = randomBytes(48).toString("base64url");
    await this.pool.query(
      "INSERT INTO core.sessions (user_id, session_hash, expires_at, user_agent, ip_hash) VALUES ($1, $2, $3, $4, $5)",
      [userId, this.hashSessionToken(sessionToken), new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000), req?.headers["user-agent"] ?? null, req?.socket.remoteAddress ? this.hashSessionToken(req.socket.remoteAddress) : null]
    );
    return sessionToken;
  }

  private hashSessionToken(token: string): string {
    return createHmac("sha256", process.env.PM_SESSION_SECRET ?? process.env.SESSION_SECRET ?? "dev-session-secret").update(token).digest("hex");
  }
}

export function rowToIdentity(row: CoreUserRow): AuthenticatedUser {
  return {
    username: row.username,
    email: row.email ?? undefined,
    name: row.display_name ?? undefined,
    groups: [row.global_role]
  };
}
