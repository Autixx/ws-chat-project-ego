import path from "node:path";

export type AppConfig = {
  host: string;
  port: number;
  dataDir: string;
  sqlitePath: string;
  devAuthBypass: boolean;
  trustAutheliaHeaders: boolean;
  authMode: "local";
  sessionSecret?: string;
  registrationEnabled: boolean;
  registrationInviteCode?: string;
  cookieSecure: boolean;
  llmProvider: "mock" | "codex";
  codexAgentUrl?: string;
  codexAgentToken?: string;
  codexFallbackToMock: boolean;
  planeBaseUrl?: string;
  planeWorkspace: string;
  planeApiKey?: string;
  n8nBaseUrl?: string;
  n8nWebhookToken?: string;
  jobCallbackToken?: string;
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
  sqlitePath: process.env.SQLITE_PATH ?? path.join(process.env.DATA_DIR ?? "./data", "projectego-chat.sqlite"),
  devAuthBypass: boolFromEnv(process.env.DEV_AUTH_BYPASS, process.env.NODE_ENV !== "production"),
  trustAutheliaHeaders: boolFromEnv(process.env.TRUST_AUTHELIA_HEADERS, false),
  authMode: "local",
  sessionSecret: process.env.SESSION_SECRET,
  registrationEnabled: boolFromEnv(process.env.REGISTRATION_ENABLED, true),
  registrationInviteCode: process.env.REGISTRATION_INVITE_CODE,
  cookieSecure: boolFromEnv(process.env.COOKIE_SECURE, process.env.NODE_ENV === "production"),
  llmProvider: process.env.LLM_PROVIDER === "codex" ? "codex" : "mock",
  codexAgentUrl: process.env.CODEX_AGENT_URL,
  codexAgentToken: process.env.CODEX_AGENT_TOKEN,
  codexFallbackToMock: boolFromEnv(process.env.CODEX_FALLBACK_TO_MOCK, true),
  planeBaseUrl: process.env.PLANE_BASE_URL,
  planeWorkspace: process.env.PLANE_WORKSPACE ?? "projectego",
  planeApiKey: process.env.PLANE_API_KEY,
  n8nBaseUrl: process.env.N8N_BASE_URL,
  n8nWebhookToken: process.env.N8N_WEBHOOK_TOKEN,
  jobCallbackToken: process.env.JOB_CALLBACK_TOKEN
};
