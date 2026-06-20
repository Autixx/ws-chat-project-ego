import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/database.js";
import { checkDatabaseHealth, type DbHealth } from "../db/health.js";

export type ProbeStatus = {
  status: string;
  checkedAt?: string;
  latencyMs?: number;
  message?: string;
  lastError?: string;
};

export type DashboardStatus = {
  status: "ok" | "error";
  service: "projectego-dashboard";
  components: {
    db: DbHealth;
    llmAgent: ProbeStatus;
    n8n: ProbeStatus;
    plane: ProbeStatus;
    jobs: { callbackConfigured: boolean };
  };
};

type FetchLike = typeof fetch;

export class ComponentStatusMonitor {
  private latest: Omit<DashboardStatus["components"], "db" | "jobs">;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.latest = {
      llmAgent: this.initialLlmAgentStatus(),
      n8n: this.initialN8nStatus(),
      plane: { status: "unreachable", message: "Plane URL is not configured." }
    };
  }

  snapshot(database: AppDatabase): DashboardStatus {
    const db = checkDatabaseHealth(database);
    return {
      status: db.status === "ok" ? "ok" : "error",
      service: "projectego-dashboard",
      components: {
        db,
        ...this.latest,
        jobs: { callbackConfigured: Boolean(this.config.jobCallbackToken) }
      }
    };
  }

  start(onUpdate?: () => void): void {
    if (this.timer) return;
    void this.poll().then(onUpdate);
    this.timer = setInterval(() => {
      void this.poll().then(onUpdate);
    }, this.config.componentStatusIntervalMs ?? 15000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async poll(): Promise<void> {
    const [llmAgent, n8n, plane] = await Promise.all([this.checkLlmAgent(), this.checkN8n(), this.checkPlane()]);
    this.latest = { llmAgent, n8n, plane };
  }

  private initialLlmAgentStatus(): ProbeStatus {
    if (this.config.llmProvider === "mock") return { status: "reachable", message: "MockProvider active" };
    if (!this.config.codexAgentUrl) return { status: "misconfigured", message: "CODEX_AGENT_URL is not configured." };
    return { status: "unreachable", message: "LLM-agent has not been checked yet." };
  }

  private initialN8nStatus(): ProbeStatus {
    if (!this.config.n8nBaseUrl || !this.config.n8nWebhookToken) return { status: "unconfigured", message: "n8n URL or token is not configured." };
    return { status: "unreachable", message: "n8n has not been checked yet." };
  }

  private async checkLlmAgent(): Promise<ProbeStatus> {
    if (this.config.llmProvider === "mock") return { status: "reachable", checkedAt: new Date().toISOString(), message: "MockProvider active" };
    if (!this.config.codexAgentUrl) return { status: "misconfigured", checkedAt: new Date().toISOString(), message: "CODEX_AGENT_URL is not configured." };
    return this.probe(this.config.codexAgentHealthUrl || this.config.codexAgentUrl, "reachable", "unreachable");
  }

  private async checkN8n(): Promise<ProbeStatus> {
    if (!this.config.n8nBaseUrl || !this.config.n8nWebhookToken) {
      return { status: "unconfigured", checkedAt: new Date().toISOString(), message: "n8n URL or token is not configured." };
    }
    return this.probe(this.config.n8nHealthUrl || this.config.n8nBaseUrl, "configured", "unreachable");
  }

  private async checkPlane(): Promise<ProbeStatus> {
    const url = this.config.planeHealthUrl || this.config.planeBaseUrl;
    if (!url) return { status: "unreachable", checkedAt: new Date().toISOString(), message: "Plane URL is not configured." };
    return this.probe(url, "reachable", "unreachable");
  }

  private async probe(url: string, okStatus: string, failStatus: string): Promise<ProbeStatus> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.componentStatusTimeoutMs ?? 2000);
    try {
      const response = await this.fetchImpl(url, { method: "GET", signal: controller.signal });
      const latencyMs = Date.now() - started;
      if ((response.status >= 200 && response.status <= 399) || response.status === 401 || response.status === 403 || response.status === 405) {
        return { status: okStatus, checkedAt, latencyMs, message: `HTTP ${response.status}` };
      }
      return { status: failStatus, checkedAt, latencyMs, lastError: `HTTP ${response.status}` };
    } catch (error) {
      return { status: failStatus, checkedAt, latencyMs: Date.now() - started, lastError: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
