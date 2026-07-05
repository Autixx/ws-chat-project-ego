import type { PmRole } from "./types.js";

export class PmPermissionError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

const roleRank: Record<PmRole, number> = {
  viewer: 1,
  member: 2,
  project_owner: 3,
  admin: 4
};

export function normalizeRole(value: unknown): PmRole {
  if (value === "admin" || value === "project_owner" || value === "member" || value === "viewer") return value;
  return "viewer";
}

export function roleAtLeast(role: PmRole | undefined, required: PmRole): boolean {
  if (!role) return false;
  return roleRank[role] >= roleRank[required];
}

export function requireProjectRole(role: PmRole | undefined, required: PmRole): void {
  if (!roleAtLeast(role, required)) throw new PmPermissionError(role ? 403 : 404, "Project not found or access denied.");
}

export function canManageProject(role: PmRole | undefined): boolean {
  return roleAtLeast(role, "project_owner");
}

export function canWriteProject(role: PmRole | undefined): boolean {
  return roleAtLeast(role, "member");
}

export function canViewProject(role: PmRole | undefined): boolean {
  return roleAtLeast(role, "viewer");
}
