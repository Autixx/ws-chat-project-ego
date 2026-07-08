import { createHmac, randomUUID } from "node:crypto";
import type { PmEvent } from "./events.js";
import type { PmWebhookDeliveryRecord } from "./types.js";

export type PmWebhookConfig = {
  urls: string[];
  secret?: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryIntervalMs: number;
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

export type PmWebhookPersistence = {
  createWebhookDelivery(input: { deliveryId: string; url: string; eventType: string; event: Record<string, unknown>; payload: Record<string, unknown> }): Promise<PmWebhookDeliveryRecord>;
  markWebhookDeliveryAttempt(
    id: string,
    input: { delivered: boolean; attempts: number; maxAttempts: number; responseStatus?: number; error?: string; nextAttemptAt?: Date }
  ): Promise<PmWebhookDeliveryRecord>;
  listDueWebhookDeliveries(limit?: number): Promise<PmWebhookDeliveryRecord[]>;
};

export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export class PmWebhookDispatcher {
  constructor(private readonly config: PmWebhookConfig, private readonly persistence?: PmWebhookPersistence) {}

  get enabled(): boolean {
    return this.config.urls.length > 0;
  }

  async dispatch(event: PmEvent): Promise<PmWebhookDelivery[]> {
    if (!this.enabled) return [];
    const payload: PmWebhookPayload = { ...event, deliveryId: randomUUID(), service: "projectego-pm" };
    return Promise.all(
      this.config.urls.map(async (url) => {
        if (!this.persistence) return this.deliver(url, event.type, payload.deliveryId, payload);
        const record = await this.persistence.createWebhookDelivery({
          deliveryId: payload.deliveryId,
          url,
          eventType: event.type,
          event: event as unknown as Record<string, unknown>,
          payload: payload as unknown as Record<string, unknown>
        });
        return this.deliverRecord(record);
      })
    );
  }

  async retryDue(limit = 25): Promise<PmWebhookDelivery[]> {
    if (!this.persistence) return [];
    const records = await this.persistence.listDueWebhookDeliveries(limit);
    return Promise.all(records.map((record) => this.deliverRecord(record)));
  }

  private async deliverRecord(record: PmWebhookDeliveryRecord): Promise<PmWebhookDelivery> {
    const result = await this.deliver(record.url, record.eventType, record.deliveryId, record.payload as PmWebhookPayload);
    const attempts = record.attempts + 1;
    const nextAttemptAt = result.ok ? undefined : new Date(Date.now() + retryDelayMs(this.config.retryBaseMs, attempts));
    await this.persistence?.markWebhookDeliveryAttempt(record.id, {
      delivered: result.ok,
      attempts,
      maxAttempts: this.config.maxAttempts,
      responseStatus: result.status,
      error: result.error,
      nextAttemptAt
    });
    return result;
  }

  private async deliver(url: string, eventType: string, deliveryId: string, payload: PmWebhookPayload): Promise<PmWebhookDelivery> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-projectego-event": eventType,
      "x-projectego-delivery": deliveryId
    };
    if (this.config.secret) headers["x-projectego-signature"] = signWebhookBody(body, this.config.secret);
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

function retryDelayMs(baseMs: number, attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 6));
  return Math.max(1000, baseMs) * 2 ** exponent;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return response.statusText;
  }
}
