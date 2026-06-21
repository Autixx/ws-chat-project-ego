import type { AppConfig } from "../config.js";

export function isValidAgentAttachmentAuthorization(config: AppConfig, authorization: string | undefined): boolean {
  return Boolean(config.agentAttachmentToken) && authorization === `Bearer ${config.agentAttachmentToken}`;
}
