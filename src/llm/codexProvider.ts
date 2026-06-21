import type { AppConfig } from "../config.js";
import type { DraftResult } from "../drafts/types.js";
import { MockProvider } from "./mockProvider.js";
import type { LlmProvider, LlmStreamEvent, LlmTaskInput } from "./provider.js";

type CodexAgentEnvelope = {
  job_id?: string;
  status?: string;
  result?: DraftResult;
  eventlog?: unknown[];
  warnings?: unknown[];
};

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
    if (!isDraftResult(envelope.result)) {
      yield { type: "error", message: "Codex provider response did not include a valid result." };
      return;
    }
    yield { type: "result", result: envelope.result };
    yield { type: "done" };
  }
}

function isDraftResult(value: unknown): value is DraftResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DraftResult>;
  return candidate.status === "done" && typeof candidate.source_summary === "string" && Array.isArray(candidate.items) && Array.isArray(candidate.needs_clarification);
}
