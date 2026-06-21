import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import type { DraftResult } from "../src/drafts/types.js";
import { CodexProvider } from "../src/llm/codexProvider.js";
import type { LlmStreamEvent, LlmTaskInput } from "../src/llm/provider.js";

const draftResult: DraftResult = {
  status: "done",
  source_summary: "summary",
  needs_clarification: [],
  items: []
};

const input: LlmTaskInput = {
  mode: "structured_breakdown",
  text: "Make a plan",
  source: "browser_text",
  fileName: "plan.md",
  user: { username: "tester", groups: [] }
};

function config(): AppConfig {
  return {
    host: "127.0.0.1",
    port: 19100,
    dataDir: "./data",
    sqlitePath: "./data/test.sqlite",
    devAuthBypass: true,
    trustAutheliaHeaders: false,
    authMode: "local",
    registrationEnabled: true,
    cookieSecure: false,
    llmProvider: "codex",
    codexAgentUrl: "http://agent.test/v1/projectego/process",
    codexAgentToken: "secret-token",
    codexFallbackToMock: false,
    planeWorkspace: "projectego"
  };
}

async function collect(provider: CodexProvider): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const event of provider.runProjectEgoTask(input)) events.push(event);
  return events;
}

test("CodexProvider uses X-Codex-Agent-Token and omits user from payload", async () => {
  let headers: Headers | undefined;
  let body: Record<string, unknown> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    headers = new Headers(init?.headers);
    body = JSON.parse(String(init?.body));
    return Response.json({ status: "done", result: draftResult });
  }) as typeof fetch;
  try {
    const events = await collect(new CodexProvider(config()));
    assert.equal(headers?.get("x-codex-agent-token"), "secret-token");
    assert.equal(headers?.get("authorization"), null);
    assert.deepEqual(body, { mode: "structured_breakdown", text: "Make a plan", source: "browser_text", fileName: "plan.md" });
    assert.equal(events.at(-1)?.type, "done");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CodexProvider unwraps result and emits warnings before result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ job_id: "job-1", status: "done", result: draftResult, warnings: ["check routing"] })) as typeof fetch;
  try {
    const events = await collect(new CodexProvider(config()));
    assert.deepEqual(events.map((event) => event.type), ["status", "result", "done"]);
    assert.equal(events[0].type === "status" ? events[0].message.includes("check routing") : false, true);
    assert.deepEqual(events[1].type === "result" ? events[1].result : undefined, draftResult);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CodexProvider returns error on non-2xx response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("bad request", { status: 400 })) as typeof fetch;
  try {
    const events = await collect(new CodexProvider(config()));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.match(events[0].type === "error" ? events[0].message : "", /HTTP 400/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CodexProvider returns error when result is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ job_id: "job-1", status: "done" })) as typeof fetch;
  try {
    const events = await collect(new CodexProvider(config()));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.match(events[0].type === "error" ? events[0].message : "", /valid result/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
