import type { AuthenticatedUser } from "./authelia.js";
import type { AppConfig } from "../config.js";

export type AuthorizationResult = { allowed: true } | { allowed: false; reason: string };

type PlaneMember = {
  email?: string;
  username?: string;
  user?: {
    email?: string;
    username?: string;
  };
};

export class PlaneAuthorization {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.planeBaseUrl && this.config.planeWorkspace && this.config.planeApiKey);
  }

  async authorizeUser(user: AuthenticatedUser): Promise<AuthorizationResult> {
    if (!this.isConfigured()) {
      return { allowed: false, reason: "Plane workspace authorization is not configured." };
    }

    try {
      const url = new URL(`/api/v1/workspaces/${encodeURIComponent(this.config.planeWorkspace)}/members/`, this.config.planeBaseUrl);
      const response = await fetch(url, {
        headers: {
          "x-api-key": this.config.planeApiKey ?? "",
          authorization: `Bearer ${this.config.planeApiKey ?? ""}`
        }
      });
      if (!response.ok) {
        return { allowed: false, reason: `Plane membership check failed with HTTP ${response.status}.` };
      }
      const body = (await response.json()) as unknown;
      const members = normalizeMembers(body);
      const userEmail = user.email?.toLowerCase();
      const username = user.username.toLowerCase();
      const allowed = members.some((member) => {
        const memberEmail = (member.email ?? member.user?.email)?.toLowerCase();
        const memberUsername = (member.username ?? member.user?.username)?.toLowerCase();
        return (userEmail && memberEmail === userEmail) || memberUsername === username;
      });
      return allowed ? { allowed: true } : { allowed: false, reason: "User is not a member of the configured Plane workspace." };
    } catch (error) {
      return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

function normalizeMembers(body: unknown): PlaneMember[] {
  if (Array.isArray(body)) return body as PlaneMember[];
  if (body && typeof body === "object") {
    const record = body as { results?: unknown; members?: unknown };
    if (Array.isArray(record.results)) return record.results as PlaneMember[];
    if (Array.isArray(record.members)) return record.members as PlaneMember[];
  }
  return [];
}
