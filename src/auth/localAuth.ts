import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/database.js";
import { createId } from "../utils/ids.js";
import { hashPassword, validatePassword, verifyPassword } from "./password.js";
import { SessionStore } from "./sessionStore.js";
import type { LocalUser } from "./types.js";

type UserRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: string;
  disabled: number;
  created_at: string;
  updated_at: string;
  password_hash: string;
};

export class LocalAuth {
  private readonly sessions: SessionStore;

  constructor(
    private readonly database: AppDatabase,
    private readonly config: AppConfig
  ) {
    this.sessions = new SessionStore(database, config);
  }

  async registerUser(input: { username: string; email?: string; password: string; displayName?: string; inviteCode: string; req?: IncomingMessage }): Promise<{
    user: LocalUser;
    sessionToken: string;
  }> {
    if (!this.config.registrationEnabled) throw new Error("Registration is disabled.");
    if (!this.config.registrationInviteCode || input.inviteCode !== this.config.registrationInviteCode) throw new Error("Invalid invite code.");
    const username = normalizeUsername(input.username);
    const email = input.email?.trim().toLowerCase() || undefined;
    validatePassword(input.password, username, email);
    const now = new Date().toISOString();
    const user: LocalUser = {
      id: createId("U"),
      username,
      email,
      displayName: input.displayName?.trim() || username,
      role: "user",
      disabled: false,
      createdAt: now,
      updatedAt: now
    };
    const passwordHash = await hashPassword(input.password);
    try {
      this.database.db
        .prepare(
          `INSERT INTO users (id, username, email, password_hash, display_name, role, created_at, updated_at, disabled)
           VALUES (@id, @username, @email, @passwordHash, @displayName, @role, @createdAt, @updatedAt, 0)`
        )
        .run({
          id: user.id,
          username: user.username,
          email: user.email ?? null,
          passwordHash,
          displayName: user.displayName ?? null,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        });
    } catch {
      throw new Error("Username or email is already registered.");
    }
    return { user, sessionToken: await this.sessions.createSession(user, input.req) };
  }

  async loginUser(input: { usernameOrEmail: string; password: string; req?: IncomingMessage }): Promise<{ user: LocalUser; sessionToken: string }> {
    const row = this.database.db
      .prepare(
        `SELECT id, username, email, display_name, role, disabled, created_at, updated_at, password_hash
         FROM users
         WHERE (username = ? OR email = ?) AND disabled = 0`
      )
      .get(input.usernameOrEmail.trim().toLowerCase(), input.usernameOrEmail.trim().toLowerCase()) as UserRow | undefined;
    if (!row || !(await verifyPassword(row.password_hash, input.password))) {
      // TODO: add login rate limiting before exposing this beyond trusted deployments.
      throw new Error("Invalid username/email or password.");
    }
    const user = rowToLocalUser(row);
    return { user, sessionToken: await this.sessions.createSession(user, input.req) };
  }

  async logoutSession(sessionToken: string): Promise<void> {
    await this.sessions.revokeSession(sessionToken);
  }

  async getUserBySession(sessionToken: string): Promise<LocalUser | null> {
    return this.sessions.getSessionUser(sessionToken);
  }
}

function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(normalized)) throw new Error("Username must be 3-40 chars and contain only letters, numbers, dot, underscore or dash.");
  return normalized;
}

function rowToLocalUser(row: UserRow): LocalUser {
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
