import type { AppConfig } from "../config.js";
import type { DraftItem, DraftResult } from "../drafts/types.js";
import { MockProvider } from "./mockProvider.js";
import type { LlmProvider, LlmStreamEvent, LlmTaskInput } from "./provider.js";

type CodexAgentEnvelope = {
  job_id?: string;
  status?: string;
  result?: unknown;
  eventlog?: unknown[];
  warnings?: unknown[];
};

type DraftItemType = DraftItem["type"];
type DraftItemPriority = DraftItem["priority"];
type DraftRoutingConfidence = DraftItem["routing_confidence"];

const draftItemTypes = new Set<DraftItemType>(["feature", "bug", "research", "refactor", "content", "design", "technical", "production", "idea"]);
const draftPriorities = new Set<DraftItemPriority>(["urgent", "high", "medium", "low", "none"]);
const draftRoutingConfidence = new Set<DraftRoutingConfidence>(["high", "medium", "low"]);

export class CodexProvider implements LlmProvider {
  private readonly fallback = new MockProvider();

  constructor(private readonly config: AppConfig) {}

  async *runProjectEgoTask(input: LlmTaskInput): AsyncGenerator<LlmStreamEvent> {
    if (!this.config.codexAgentUrl) {
      if (this.config.codexFallbackToMock) {
        yield { type: "status", message: "CODEX_AGENT_URL is not configured; falling back to MockProvider." };
        yield* this.fallback.runProjectEgoTask(input);
        return;
      }
      yield { type: "error", message: "Codex provider is not configured. Set CODEX_AGENT_URL or enable CODEX_FALLBACK_TO_MOCK." };
      return;
    }

    const response = await fetch(this.config.codexAgentUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.codexAgentToken ? { "x-codex-agent-token": this.config.codexAgentToken } : {})
      },
      body: JSON.stringify({
        mode: input.mode,
        text: input.text,
        source: input.source,
        ...(input.fileName ? { fileName: input.fileName } : {})
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      yield { type: "error", message: `Codex provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}.` };
      return;
    }

    const envelope = (await response.json()) as CodexAgentEnvelope;
    if (Array.isArray(envelope.warnings)) {
      for (const warning of envelope.warnings) {
        yield { type: "status", message: `Codex warning: ${typeof warning === "string" ? warning : JSON.stringify(warning)}` };
      }
    }
    if (envelope.status !== "done") {
      yield { type: "error", message: `Codex provider returned status ${envelope.status ?? "unknown"}${envelope.job_id ? ` for job ${envelope.job_id}` : ""}.` };
      return;
    }
    const normalized = normalizeDraftResult(envelope.result);
    if (!normalized.ok) {
      yield { type: "error", message: buildInvalidResultMessage(envelope, normalized.failures) };
      return;
    }
    yield { type: "result", result: normalized.result };
    yield { type: "done" };
  }
}

function normalizeDraftResult(value: unknown): { ok: true; result: DraftResult } | { ok: false; failures: string[] } {
  const failures: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, failures: ["result must be an object"] };
  }

  const sourceSummary = requireString(value, "source_summary", "result.source_summary", failures);
  const rawItems = requireArray(value, "items", "result.items", failures);
  const needsClarification = requireArray(value, "needs_clarification", "result.needs_clarification", failures);

  const items = rawItems?.map((item, index) => normalizeDraftItem(item, index, failures)).filter((item): item is DraftItem => Boolean(item)) ?? [];

  if (failures.length > 0 || sourceSummary === undefined || rawItems === undefined || needsClarification === undefined) {
    return { ok: false, failures };
  }

  return {
    ok: true,
    result: {
      status: "done",
      source_summary: sourceSummary,
      items,
      needs_clarification: toStringArray(needsClarification)
    }
  };
}

function normalizeDraftItem(value: unknown, index: number, failures: string[]): DraftItem | undefined {
  const path = `result.items[${index}]`;
  if (!isRecord(value)) {
    failures.push(`${path} must be an object`);
    return undefined;
  }

  const title = requireString(value, "title", `${path}.title`, failures);
  const summary = requireString(value, "summary", `${path}.summary`, failures);
  const details = requireString(value, "details", `${path}.details`, failures);
  const project = requireString(value, "project", `${path}.project`, failures);
  const module = requireString(value, "module", `${path}.module`, failures);
  const sourceText = requireString(value, "source_text", `${path}.source_text`, failures);

  if (
    title === undefined ||
    summary === undefined ||
    details === undefined ||
    project === undefined ||
    module === undefined ||
    sourceText === undefined
  ) {
    return undefined;
  }

  return {
    title,
    summary,
    details,
    project,
    module,
    type: draftItemTypes.has(value.type as DraftItemType) ? (value.type as DraftItemType) : "idea",
    priority: draftPriorities.has(value.priority as DraftItemPriority) ? (value.priority as DraftItemPriority) : "medium",
    routing_confidence: draftRoutingConfidence.has(value.routing_confidence as DraftRoutingConfidence) ? (value.routing_confidence as DraftRoutingConfidence) : "medium",
    labels: toStringArray(value.labels),
    dependencies: toStringArray(value.dependencies),
    acceptance_criteria: toStringArray(value.acceptance_criteria),
    needs_clarification: toStringArray(value.needs_clarification),
    source_text: sourceText
  };
}

function buildInvalidResultMessage(envelope: CodexAgentEnvelope, failures: string[]): string {
  const resultKeys = isRecord(envelope.result) ? Object.keys(envelope.result) : [];
  return [
    "Codex provider response did not include a valid result.",
    `job_id=${envelope.job_id ?? "unknown"}`,
    `envelope_status=${envelope.status ?? "unknown"}`,
    `result_exists=${envelope.result !== undefined}`,
    `result_keys=${resultKeys.length > 0 ? resultKeys.join(",") : "none"}`,
    `failed_fields=${failures.length > 0 ? failures.join("; ") : "unknown"}`
  ].join(" ");
}

function requireString(record: Record<string, unknown>, key: string, path: string, failures: string[]): string | undefined {
  if (typeof record[key] !== "string") {
    failures.push(`${path} must be a string`);
    return undefined;
  }
  return record[key];
}

function requireArray(record: Record<string, unknown>, key: string, path: string, failures: string[]): unknown[] | undefined {
  if (!Array.isArray(record[key])) {
    failures.push(`${path} must be an array`);
    return undefined;
  }
  return record[key];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
