import type { AppConfig } from "../config.js";
import type { DraftItem } from "../drafts/types.js";

export type N8nApplyItem = {
  draftItemId: string;
  index: number;
  title: string;
  type: string;
  project: string;
  module: string;
  summary: string;
  details: string;
  priority: string;
  routingConfidence: string;
  labels: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  needsClarification: string[];
  sourceText: string;
};

export type N8nApplyPayload = {
  jobId: string;
  conversationId: string;
  requestMessageId?: string;
  responseMessageId?: string;
  source: {
    provider: "codex";
    codexAgentJobId?: string;
    mode: string;
  };
  items: N8nApplyItem[];
};

export type N8nApplyResult =
  | { accepted: true; statusCode: number }
  | { accepted: false; statusCode?: number; error: string };

export function draftItemId(responseMessageId: string, itemIndex: number, persistedDraftItemId?: string): string {
  return persistedDraftItemId || `${responseMessageId}:${itemIndex}`;
}

export function mapDraftItemForN8n(responseMessageId: string, itemIndex: number, item: DraftItem & { id?: string; draftItemId?: string }): N8nApplyItem {
  return {
    draftItemId: draftItemId(responseMessageId, itemIndex, item.draftItemId ?? item.id),
    index: itemIndex,
    title: item.title,
    type: item.type,
    project: item.project,
    module: item.module,
    summary: item.summary,
    details: item.details,
    priority: item.priority,
    routingConfidence: item.routing_confidence,
    labels: item.labels ?? [],
    dependencies: item.dependencies ?? [],
    acceptanceCriteria: item.acceptance_criteria ?? [],
    needsClarification: item.needs_clarification ?? [],
    sourceText: item.source_text
  };
}

export async function sendApplyToN8n(config: AppConfig, payload: N8nApplyPayload): Promise<N8nApplyResult> {
  if (!config.n8nApplyWebhookUrl) return { accepted: false, error: "N8N_APPLY_WEBHOOK_URL is not configured." };
  if (!config.n8nWebhookToken) return { accepted: false, error: "N8N_WEBHOOK_TOKEN is not configured." };

  try {
    const response = await fetch(config.n8nApplyWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.n8nWebhookToken}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        accepted: false,
        statusCode: response.status,
        error: `n8n apply webhook returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}.`
      };
    }
    return { accepted: true, statusCode: response.status };
  } catch (error) {
    return { accepted: false, error: error instanceof Error ? error.message : String(error) };
  }
}
