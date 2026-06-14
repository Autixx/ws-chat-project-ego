import type { IncomingMessage } from "node:http";

export type AuthenticatedUser = {
  username: string;
  email?: string;
  name?: string;
  groups: string[];
};

type AuthOptions = {
  devAuthBypass: boolean;
  trustAutheliaHeaders: boolean;
};

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function getAutheliaUser(req: IncomingMessage, options: AuthOptions): AuthenticatedUser | null {
  if (options.trustAutheliaHeaders) {
    const username = firstHeader(req, "Remote-User");
    if (!username) return null;

    return {
      username,
      email: firstHeader(req, "Remote-Email"),
      name: firstHeader(req, "Remote-Name"),
      groups: (firstHeader(req, "Remote-Groups") ?? "")
        .split(",")
        .map((group) => group.trim())
        .filter(Boolean)
    };
  }

  if (options.devAuthBypass) {
    return {
      username: "local-dev",
      email: "local-dev@example.test",
      name: "Local Dev",
      groups: ["dev"]
    };
  }

  return null;
}
