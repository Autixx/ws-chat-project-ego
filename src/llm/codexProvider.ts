import type { AppConfig } from "../config.js";
import type { DraftItem, DraftResult } from "../drafts/types.js";
import { MockProvider } from "./mockProvider.js";
import { normalizeCodexClientRequestId, normalizeCodexThreadId } from "./codexTrace.js";
import type { CodexTrace, LlmProvider, LlmStreamEvent, LlmTaskInput } from "./provider.js";

type CodexAgentEnvelope = {
  client_request_id?: string;
  job_id?: string;
  status?: string;
  thread_id?: string;
  session?: {
    id?: unknown;
    codex_session_id?: unknown;
    turn_count?: unknown;
    max_turns?: unknown;
    rotated?: unknown;
  };
  result?: unknown;
  eventlog?: unknown[];
  warnings?: unknown[];
  error?: unknown;
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
    const clientRequestId = normalizeCodexClientRequestId(input.clientRequestId);
    const threadId = normalizeCodexThreadId(input.threadId);
    const traceBase: CodexTrace = {
      clientRequestId,
      threadId,
      source: input.source,
      mode: input.mode,
      inputText: input.text,
      status: "started"
    };

    if (!this.config.codexAgentUrl) {
      if (this.config.codexFallbackToMock) {
        yield { type: "status", message: "CODEX_AGENT_URL is not configured; falling back to MockProvider." };
        yield* this.fallback.runProjectEgoTask(input);
        return;
      }
      const message = "Codex provider is not configured. Set CODEX_AGENT_URL or enable CODEX_FALLBACK_TO_MOCK.";
      yield { type: "error", message, trace: { ...traceBase, status: "error", error: message, completedAt: new Date().toISOString() } };
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(this.config.codexAgentUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.config.codexAgentToken ? { "x-codex-agent-token": this.config.codexAgentToken } : {})
        },
        body: JSON.stringify({
          client_request_id: clientRequestId,
          thread_id: threadId,
          mode: input.mode,
          text: input.text,
          source: input.source,
          ...(input.fileName ? { fileName: input.fileName } : {}),
          attachments: input.attachments ?? []
        })
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "Codex provider request timed out."
        : `Codex provider request failed: ${error instanceof Error ? error.message : String(error)}.`;
      yield { type: "error", message, trace: { ...traceBase, status: "error", error: message, completedAt: new Date().toISOString() } };
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const message = `Codex provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}.`;
        yield { type: "error", message, trace: { ...traceBase, status: "error", error: message, completedAt: new Date().toISOString() } };
        return;
      }

    let envelope: CodexAgentEnvelope;
    try {
      envelope = (await response.json()) as CodexAgentEnvelope;
    } catch (error) {
      const message = `Codex provider returned malformed JSON: ${error instanceof Error ? error.message : String(error)}.`;
      yield { type: "error", message, trace: { ...traceBase, status: "error", error: message, completedAt: new Date().toISOString() } };
      return;
    }
    const responseTrace = buildTrace(traceBase, envelope);
    if (Array.isArray(envelope.warnings)) {
      for (const warning of envelope.warnings) {
        yield { type: "status", message: `Codex warning: ${typeof warning === "string" ? warning : JSON.stringify(warning)}` };
      }
    }
    if (envelope.status !== "done") {
      const detail = typeof envelope.error === "string" ? `: ${envelope.error}` : "";
      const message = `Codex provider returned status ${envelope.status ?? "unknown"}${envelope.job_id ? ` for job ${envelope.job_id}` : ""}${detail}.`;
      yield { type: "error", message, trace: { ...responseTrace, status: "error", error: message, completedAt: new Date().toISOString() } };
      return;
    }
    const normalized = normalizeDraftResult(envelope.result);
    if (!normalized.ok) {
      const message = buildInvalidResultMessage(envelope, normalized.failures);
      yield { type: "error", message, trace: { ...responseTrace, status: "error", error: message, completedAt: new Date().toISOString() } };
      return;
    }
    yield { type: "result", result: normalized.result, trace: { ...responseTrace, status: "done", result: envelope.result, completedAt: new Date().toISOString() } };
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
  const project = optionalString(value, "project") ?? optionalString(value, "domain_hint") ?? "ProjectEGO";
  const module = optionalString(value, "module") ?? optionalString(value, "module_hint") ?? optionalString(value, "domain_hint") ?? "General";
  const sourceText = requireString(value, "source_text", `${path}.source_text`, failures);

  if (
    title === undefined ||
    summary === undefined ||
    details === undefined ||
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
    type: normalizeDraftItemType(value.type),
    priority: draftPriorities.has(value.priority as DraftItemPriority) ? (value.priority as DraftItemPriority) : "medium",
    routing_confidence: draftRoutingConfidence.has(value.routing_confidence as DraftRoutingConfidence) ? (value.routing_confidence as DraftRoutingConfidence) : "medium",
    labels: toStringArray(value.labels),
    dependencies: toStringArray(value.dependencies),
    acceptance_criteria: toStringArray(value.acceptance_criteria),
    needs_clarification: toStringArray(value.needs_clarification),
    source_text: sourceText
  };
}

function buildTrace(base: CodexTrace, envelope: CodexAgentEnvelope): CodexTrace {
  const warnings = Array.isArray(envelope.warnings) ? envelope.warnings : undefined;
  return {
    ...base,
    clientRequestId: typeof envelope.client_request_id === "string" ? envelope.client_request_id : base.clientRequestId,
    threadId: typeof envelope.thread_id === "string" ? envelope.thread_id : base.threadId,
    status: envelope.status ?? "unknown",
    codexJobId: envelope.job_id,
    codexInternalSessionId: typeof envelope.session?.id === "string" ? envelope.session.id : undefined,
    codexSessionId: typeof envelope.session?.codex_session_id === "string" ? envelope.session.codex_session_id : undefined,
    sessionTurnCount: typeof envelope.session?.turn_count === "number" ? envelope.session.turn_count : undefined,
    sessionRotated: typeof envelope.session?.rotated === "boolean" ? envelope.session.rotated : undefined,
    warnings
  };
}

function normalizeDraftItemType(value: unknown): DraftItemType {
  if (draftItemTypes.has(value as DraftItemType)) return value as DraftItemType;
  if (value === "task") return "feature";
  if (value === "decision") return "idea";
  return "idea";
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

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" && record[key].trim() ? record[key] : undefined;
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
