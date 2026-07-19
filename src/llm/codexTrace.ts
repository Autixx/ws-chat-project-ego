import { randomUUID } from "node:crypto";

export const DEFAULT_CODEX_THREAD_ID = "projectego-intake";
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export function generateCodexClientRequestId(): string {
  return `dash_${randomUUID()}`;
}

export function isValidCodexClientRequestId(value: string): boolean {
  return CLIENT_REQUEST_ID_PATTERN.test(value) && value.startsWith("dash_");
}

export function normalizeCodexClientRequestId(value?: string): string {
  if (value && isValidCodexClientRequestId(value)) return value;
  return generateCodexClientRequestId();
}

export function normalizeCodexThreadId(value?: string): string {
  const normalized = value?.trim();
  if (normalized && CLIENT_REQUEST_ID_PATTERN.test(normalized)) return normalized;
  return DEFAULT_CODEX_THREAD_ID;
}
