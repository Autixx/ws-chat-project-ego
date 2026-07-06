import { createHmac, randomUUID } from "node:crypto";
import type { PmEvent } from "./events.js";

export type PmWebhookConfig = {
  urls: string[];
  secret?: string;
  timeoutMs: number;
};

export type PmWebhookDelivery = {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
};

export type PmWebhookPayload = PmEvent & {
  deliveryId: string;
  service: "projectego-pm";
};

export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export class PmWebhookDispatcher {
  constructor(private readonly config: PmWebhookConfig) {}

  get enabled(): boolean {
    return this.config.urls.length > 0;
  }

  async dispatch(event: PmEvent): Promise<PmWebhookDelivery[]> {
    if (!this.enabled) return [];
    const payload: PmWebhookPayload = { ...event, deliveryId: randomUUID(), service: "projectego-pm" };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-projectego-event": event.type,
      "x-projectego-delivery": payload.deliveryId
    };
    if (this.config.secret) headers["x-projectego-signature"] = signWebhookBody(body, this.config.secret);
    return Promise.all(this.config.urls.map((url) => this.deliver(url, body, headers)));
  }

  private async deliver(url: string, body: string, headers: Record<string, string>): Promise<PmWebhookDelivery> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
      return { url, ok: response.ok, status: response.status, error: response.ok ? undefined : await safeResponseText(response) };
    } catch (error) {
      return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return response.statusText;
  }
}
