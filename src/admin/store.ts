import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Pool } from "pg";
import { hashPassword, verifyPassword, validatePassword } from "../auth/password.js";
import type { AdminConfig } from "./config.js";

const SESSION_DAYS = 30;
export type AdminUser = {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  globalRole: "super_admin" | "admin" | "user";
  dashboardAccess: boolean;
  pmAccess: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

export class AdminStore {
  private readonly pool: Pool;

  constructor(private readonly config: AdminConfig) {
    if (!config.databaseUrl) throw new Error("ADMIN_DATABASE_URL or PM_DATABASE_URL is required.");
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ensureCoreSchema(): Promise<void> {
    await this.pool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA IF NOT EXISTS core;
      CREATE TABLE IF NOT EXISTS core.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE,
        email TEXT UNIQUE,
        display_name TEXT,
        external_subject TEXT UNIQUE,
        password_hash TEXT,
        global_role TEXT NOT NULL DEFAULT 'user' CHECK (global_role IN ('super_admin', 'admin', 'user')),
        dashboard_access BOOLEAN NOT NULL DEFAULT FALSE,
        pm_access BOOLEAN NOT NULL DEFAULT FALSE,
        disabled BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE core.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE core.users ADD COLUMN IF NOT EXISTS global_role TEXT NOT NULL DEFAULT 'user';
      ALTER TABLE core.users ADD COLUMN IF NOT EXISTS dashboard_access BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE core.users ADD COLUMN IF NOT EXISTS pm_access BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE TABLE IF NOT EXISTS core.sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
        session_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        user_agent TEXT,
        ip_hash TEXT
      );
    `);
  }

  async bootstrapSuperuser(): Promise<void> {
    await this.ensureCoreSchema();
    if (!this.config.bootstrapUsername || !this.config.bootstrapPassword) return;
    validatePassword(this.config.bootstrapPassword, this.config.bootstrapUsername, this.config.bootstrapEmail);
    const passwordHash = await hashPassword(this.config.bootstrapPassword);
    await this.pool.query(
      `
      INSERT INTO core.users (username, email, display_name, external_subject, password_hash, global_role, dashboard_access, pm_access, disabled)
      VALUES ($1, $2, $3, $4, $5, 'super_admin', true, true, false)
      ON CONFLICT (username) DO UPDATE
      SET email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          password_hash = EXCLUDED.password_hash,
          global_role = 'super_admin',
          dashboard_access = true,
          pm_access = true,
          disabled = false,
          updated_at = now()
      `,
      [normalizeUsername(this.config.bootstrapUsername), this.config.bootstrapEmail ?? null, this.config.bootstrapDisplayName ?? this.config.bootstrapUsername, `admin:${normalizeUsername(this.config.bootstrapUsername)}`, passwordHash]
    );
  }

  async login(input: { usernameOrEmail: string; password: string; req?: IncomingMessage }): Promise<{ user: AdminUser; sessionToken: string }> {
    const lookup = input.usernameOrEmail.trim().toLowerCase();
    const result = await this.pool.query(
      `
      SELECT *
      FROM core.users
      WHERE (lower(username) = $1 OR lower(email) = $1)
        AND disabled = false
        AND global_role IN ('super_admin', 'admin')
      LIMIT 1
      `,
      [lookup]
    );
    const row = result.rows[0] as Row | undefined;
    const passwordHash = row?.password_hash ? String(row.password_hash) : undefined;
    if (!row || !passwordHash || !(await verifyPassword(passwordHash, input.password))) throw new Error("Invalid username/email or password.");
    const user = mapUser(row);
    return { user, sessionToken: await this.createSession(user, input.req) };
  }

  async userBySession(sessionToken: string): Promise<AdminUser | null> {
    const result = await this.pool.query(
      `
      SELECT u.*
      FROM core.sessions s
      JOIN core.users u ON u.id = s.user_id
      WHERE s.session_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.disabled = false
        AND u.global_role IN ('super_admin', 'admin')
      LIMIT 1
      `,
      [this.hashSessionToken(sessionToken)]
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async logout(sessionToken: string): Promise<void> {
    await this.pool.query("UPDATE core.sessions SET revoked_at = now() WHERE session_hash = $1", [this.hashSessionToken(sessionToken)]);
  }

  async listUsers(): Promise<AdminUser[]> {
    const result = await this.pool.query("SELECT * FROM core.users ORDER BY lower(username) ASC LIMIT 500");
    return result.rows.map(mapUser);
  }

  async createUser(input: { username: string; email?: string; displayName?: string; password: string; globalRole?: string; dashboardAccess?: boolean; pmAccess?: boolean }): Promise<AdminUser> {
    const username = normalizeUsername(input.username);
    validatePassword(input.password, username, input.email);
    const result = await this.pool.query(
      `
      INSERT INTO core.users (username, email, display_name, external_subject, password_hash, global_role, dashboard_access, pm_access)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [username, input.email?.trim().toLowerCase() ?? null, input.displayName?.trim() || username, `core:${username}`, await hashPassword(input.password), normalizeGlobalRole(input.globalRole), Boolean(input.dashboardAccess), Boolean(input.pmAccess)]
    );
    return mapUser(result.rows[0]);
  }

  async updateUser(id: string, input: { globalRole?: string; dashboardAccess?: boolean; pmAccess?: boolean; disabled?: boolean; password?: string }): Promise<AdminUser> {
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    const result = await this.pool.query(
      `
      UPDATE core.users
      SET global_role = COALESCE($2, global_role),
          dashboard_access = COALESCE($3, dashboard_access),
          pm_access = COALESCE($4, pm_access),
          disabled = COALESCE($5, disabled),
          password_hash = COALESCE($6, password_hash),
          updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [id, input.globalRole ? normalizeGlobalRole(input.globalRole) : null, input.dashboardAccess ?? null, input.pmAccess ?? null, input.disabled ?? null, passwordHash ?? null]
    );
    if (!result.rows[0]) throw new Error("User not found.");
    return mapUser(result.rows[0]);
  }

  private async createSession(user: AdminUser, req?: IncomingMessage): Promise<string> {
    const sessionToken = randomBytes(48).toString("base64url");
    await this.pool.query(
      "INSERT INTO core.sessions (user_id, session_hash, expires_at, user_agent, ip_hash) VALUES ($1, $2, $3, $4, $5)",
      [user.id, this.hashSessionToken(sessionToken), new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000), req?.headers["user-agent"] ?? null, req?.socket.remoteAddress ? this.hashSessionToken(req.socket.remoteAddress) : null]
    );
    return sessionToken;
  }

  private hashSessionToken(token: string): string {
    return createHmac("sha256", this.config.sessionSecret ?? "dev-session-secret").update(token).digest("hex");
  }
}

function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(normalized)) throw new Error("Username must be 3-40 chars and contain only letters, numbers, dot, underscore or dash.");
  return normalized;
}

function normalizeGlobalRole(value: unknown): AdminUser["globalRole"] {
  return value === "super_admin" || value === "admin" || value === "user" ? value : "user";
}

function mapUser(row: Row): AdminUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: row.email ? String(row.email) : undefined,
    displayName: row.display_name ? String(row.display_name) : undefined,
    globalRole: normalizeGlobalRole(row.global_role),
    dashboardAccess: Boolean(row.dashboard_access),
    pmAccess: Boolean(row.pm_access),
    disabled: Boolean(row.disabled),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at)
  };
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}
