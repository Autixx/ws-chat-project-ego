import type { AppConfig } from "../config.js";

export class N8nClient {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.n8nBaseUrl && this.config.n8nWebhookToken);
  }
}
