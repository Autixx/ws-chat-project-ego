import type { AppConfig } from "../config.js";
import { MockProvider } from "./mockProvider.js";
import type { LlmProvider, LlmStreamEvent, LlmTaskInput } from "./provider.js";

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
        ...(this.config.codexAgentToken ? { authorization: `Bearer ${this.config.codexAgentToken}` } : {})
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      yield { type: "error", message: `Codex provider returned HTTP ${response.status}.` };
      return;
    }

    const result = await response.json();
    yield { type: "result", result };
    yield { type: "done" };
  }
}
