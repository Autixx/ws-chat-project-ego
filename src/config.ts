import path from "node:path";

export type AppConfig = {
  host: string;
  port: number;
  dataDir: string;
  attachmentsDir?: string;
  sqlitePath: string;
  maxUploadBytes?: number;
  maxExtractedChars?: number;
  devAuthBypass: boolean;
  trustAutheliaHeaders: boolean;
  authMode: "local";
  sessionSecret?: string;
  registrationEnabled: boolean;
  registrationInviteCode?: string;
  cookieSecure: boolean;
  llmProvider: "mock" | "codex";
  codexAgentUrl?: string;
  codexAgentHealthUrl?: string;
  codexAgentToken?: string;
  codexFallbackToMock: boolean;
  planeBaseUrl?: string;
  planeHealthUrl?: string;
  planeWorkspace: string;
  planeApiKey?: string;
  n8nBaseUrl?: string;
  n8nHealthUrl?: string;
  n8nWebhookToken?: string;
  jobCallbackToken?: string;
  componentStatusIntervalMs?: number;
  componentStatusTimeoutMs?: number;
};

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config: AppConfig = {
  host: process.env.HOST ?? "127.0.0.1",
  port: numberFromEnv(process.env.PORT, 19100),
  dataDir: process.env.DATA_DIR ?? "./data",
  attachmentsDir: process.env.ATTACHMENTS_DIR ?? path.join(process.env.DATA_DIR ?? "./data", "attachments"),
  sqlitePath: process.env.SQLITE_PATH ?? path.join(process.env.DATA_DIR ?? "./data", "projectego-chat.sqlite"),
  maxUploadBytes: numberFromEnv(process.env.MAX_UPLOAD_BYTES, 1048576),
  maxExtractedChars: numberFromEnv(process.env.MAX_EXTRACTED_CHARS, 50000),
  devAuthBypass: boolFromEnv(process.env.DEV_AUTH_BYPASS, process.env.NODE_ENV !== "production"),
  trustAutheliaHeaders: boolFromEnv(process.env.TRUST_AUTHELIA_HEADERS, false),
  authMode: "local",
  sessionSecret: process.env.SESSION_SECRET,
  registrationEnabled: boolFromEnv(process.env.REGISTRATION_ENABLED, true),
  registrationInviteCode: process.env.REGISTRATION_INVITE_CODE,
  cookieSecure: boolFromEnv(process.env.COOKIE_SECURE, process.env.NODE_ENV === "production"),
  llmProvider: process.env.LLM_PROVIDER === "codex" ? "codex" : "mock",
  codexAgentUrl: process.env.CODEX_AGENT_URL,
  codexAgentHealthUrl: process.env.CODEX_AGENT_HEALTH_URL,
  codexAgentToken: process.env.CODEX_AGENT_TOKEN,
  codexFallbackToMock: boolFromEnv(process.env.CODEX_FALLBACK_TO_MOCK, true),
  planeBaseUrl: process.env.PLANE_BASE_URL,
  planeHealthUrl: process.env.PLANE_HEALTH_URL,
  planeWorkspace: process.env.PLANE_WORKSPACE ?? "projectego",
  planeApiKey: process.env.PLANE_API_KEY,
  n8nBaseUrl: process.env.N8N_BASE_URL,
  n8nHealthUrl: process.env.N8N_HEALTH_URL,
  n8nWebhookToken: process.env.N8N_WEBHOOK_TOKEN,
  jobCallbackToken: process.env.JOB_CALLBACK_TOKEN,
  componentStatusIntervalMs: numberFromEnv(process.env.COMPONENT_STATUS_INTERVAL_MS, 15000),
  componentStatusTimeoutMs: numberFromEnv(process.env.COMPONENT_STATUS_TIMEOUT_MS, 2000)
};
