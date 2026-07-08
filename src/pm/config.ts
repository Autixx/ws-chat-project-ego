export type PmConfig = {
  host: string;
  port: number;
  databaseUrl?: string;
  publicBaseUrl?: string;
  dataDir: string;
  attachmentsDir: string;
  maxAttachmentBytes: number;
  autoMigrate: boolean;
  devAuthBypass: boolean;
  trustAutheliaHeaders: boolean;
  automationToken?: string;
  webhooks: {
    urls: string[];
    secret?: string;
    timeoutMs: number;
    maxAttempts: number;
    retryBaseMs: number;
    retryIntervalMs: number;
  };
  smtp?: {
    host?: string;
    port: number;
    username?: string;
    password?: string;
    from?: string;
    tls: boolean;
  };
};

export const PM_FORBIDDEN_ENV_KEYS = [
  "CODEX_AGENT_TOKEN",
  "AGENT_ATTACHMENT_TOKEN",
  "JOB_CALLBACK_TOKEN",
  "N8N_WEBHOOK_TOKEN",
  "PLANE_API_KEY",
  "DASHBOARD_INTERNAL_BASE_URL"
] as const;

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function forbiddenPmEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return PM_FORBIDDEN_ENV_KEYS.filter((key) => Boolean(env[key]));
}

export function loadPmConfig(env: NodeJS.ProcessEnv = process.env): PmConfig {
  const dataDir = env.PM_DATA_DIR ?? env.DATA_DIR ?? "./pm-data";
  return {
    host: env.PM_HOST ?? env.HOST ?? "127.0.0.1",
    port: numberFromEnv(env.PM_PORT ?? env.PORT, 19110),
    databaseUrl: env.PM_DATABASE_URL,
    publicBaseUrl: env.PM_PUBLIC_BASE_URL,
    dataDir,
    attachmentsDir: env.PM_ATTACHMENTS_DIR ?? `${dataDir}/attachments`,
    maxAttachmentBytes: numberFromEnv(env.PM_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024),
    autoMigrate: boolFromEnv(env.PM_AUTO_MIGRATE, true),
    devAuthBypass: boolFromEnv(env.PM_DEV_AUTH_BYPASS, env.NODE_ENV !== "production"),
    trustAutheliaHeaders: boolFromEnv(env.PM_TRUST_AUTHELIA_HEADERS ?? env.TRUST_AUTHELIA_HEADERS, false),
    automationToken: env.PM_AUTOMATION_TOKEN,
    webhooks: {
      urls: csvFromEnv(env.PM_WEBHOOK_URLS),
      secret: env.PM_WEBHOOK_SECRET,
      timeoutMs: numberFromEnv(env.PM_WEBHOOK_TIMEOUT_MS, 5000),
      maxAttempts: numberFromEnv(env.PM_WEBHOOK_MAX_ATTEMPTS, 6),
      retryBaseMs: numberFromEnv(env.PM_WEBHOOK_RETRY_BASE_MS, 30000),
      retryIntervalMs: numberFromEnv(env.PM_WEBHOOK_RETRY_INTERVAL_MS, 15000)
    },
    smtp: {
      host: env.SMTP_HOST,
      port: numberFromEnv(env.SMTP_PORT, 587),
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
      tls: boolFromEnv(env.SMTP_TLS, true)
    }
  };
}

function csvFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function assertPmCanStart(config: PmConfig, env: NodeJS.ProcessEnv = process.env): void {
  const forbidden = forbiddenPmEnv(env);
  if (forbidden.length > 0) {
    throw new Error(`PM service must not receive Dashboard/agent secrets: ${forbidden.join(", ")}`);
  }

  if (env.NODE_ENV === "production" && !config.databaseUrl) {
    throw new Error("PM_DATABASE_URL is required for ProjectEGO PM in production.");
  }
}
