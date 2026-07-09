export type AdminConfig = {
  host: string;
  port: number;
  databaseUrl?: string;
  sessionSecret?: string;
  cookieSecure: boolean;
  bootstrapUsername?: string;
  bootstrapPassword?: string;
  bootstrapEmail?: string;
  bootstrapDisplayName?: string;
};

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  return {
    host: env.ADMIN_HOST ?? "127.0.0.1",
    port: numberFromEnv(env.ADMIN_PORT, 19120),
    databaseUrl: env.ADMIN_DATABASE_URL ?? env.PM_DATABASE_URL,
    sessionSecret: env.ADMIN_SESSION_SECRET ?? env.SESSION_SECRET,
    cookieSecure: boolFromEnv(env.ADMIN_COOKIE_SECURE, env.NODE_ENV === "production"),
    bootstrapUsername: env.ADMIN_BOOTSTRAP_USERNAME,
    bootstrapPassword: env.ADMIN_BOOTSTRAP_PASSWORD,
    bootstrapEmail: env.ADMIN_BOOTSTRAP_EMAIL,
    bootstrapDisplayName: env.ADMIN_BOOTSTRAP_DISPLAY_NAME
  };
}
