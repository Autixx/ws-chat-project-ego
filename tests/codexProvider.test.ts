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

const homelabAgentResult = {
  mode: "structured_breakdown",
  source_summary: "Dashboard cleanup plan",
  items: [
    {
      title: "Improve media preview",
      type: "idea",
      project: "UI / UX",
      module: "ProjectEGO Dashboard",
      summary: "Make previews easier to use.",
      details: "Open media in movable preview windows.",
      source_text: "Preview uploaded files.",
      priority: "medium",
      labels: ["codex-generated", "manual-review"],
      dependencies: [],
      acceptance_criteria: [],
      needs_clarification: []
    }
  ],
  needs_clarification: [],
  eventlog_summary: "No warnings."
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

async function collectWithInput(provider: CodexProvider, taskInput: LlmTaskInput): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const event of provider.runProjectEgoTask(taskInput)) events.push(event);
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

test("CodexProvider sends dashboard-upload source and fileName as JSON metadata", async () => {
  let body: Record<string, unknown> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ status: "done", result: draftResult });
  }) as typeof fetch;
  try {
    const events = await collectWithInput(new CodexProvider(config()), {
      ...input,
      source: "dashboard-upload",
      text: "User text:\nHello\n\nAttached file: note.md\nExtracted file content:\nBody",
      fileName: "note.md"
    });
    assert.deepEqual(body, {
      mode: "structured_breakdown",
      source: "dashboard-upload",
      text: "User text:\nHello\n\nAttached file: note.md\nExtracted file content:\nBody",
      fileName: "note.md"
    });
    assert.equal(events.at(-1)?.type, "done");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CodexProvider sends multimodal attachments in JSON body", async () => {
  let body: Record<string, unknown> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ status: "done", result: draftResult });
  }) as typeof fetch;
  try {
    await collectWithInput(new CodexProvider(config()), {
      ...input,
      source: "dashboard-upload",
      fileName: "screen.png",
      attachments: [
        {
          id: "ATT-image",
          kind: "image",
          fileName: "screen.png",
          mimeType: "image/png",
          sizeBytes: 12345,
          downloadUrl: "http://127.0.0.1:19100/api/internal/attachments/ATT-image"
        }
      ]
    });
    assert.deepEqual(body?.attachments, [
      {
        id: "ATT-image",
        kind: "image",
        fileName: "screen.png",
        mimeType: "image/png",
        sizeBytes: 12345,
        downloadUrl: "http://127.0.0.1:19100/api/internal/attachments/ATT-image"
      }
    ]);
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

test("CodexProvider normalizes current homelab-codex-agent result shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ job_id: "20260621-064612-9149beaf", status: "done", result: homelabAgentResult, eventlog: [] })) as typeof fetch;
  try {
    const events = await collect(new CodexProvider(config()));
    assert.deepEqual(events.map((event) => event.type), ["result", "done"]);
    const result = events[0].type === "result" ? events[0].result : undefined;
    assert.equal(result?.status, "done");
    assert.equal(result?.source_summary, "Dashboard cleanup plan");
    assert.equal(result?.items[0]?.title, "Improve media preview");
    assert.equal(result?.items[0]?.routing_confidence, "medium");
    assert.deepEqual(result?.items[0]?.labels, ["codex-generated", "manual-review"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CodexProvider safely defaults invalid draft item enum fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      job_id: "job-defaults",
      status: "done",
      result: {
        ...homelabAgentResult,
        items: [
          {
            ...homelabAgentResult.items[0],
            type: "not-a-dashboard-type",
            priority: "critical",
            routing_confidence: "certain",
            labels: ["ok", 123, false],
            dependencies: undefined,
            acceptance_criteria: ["done"],
            needs_clarification: null
          }
        ]
      }
    })) as typeof fetch;
  try {
    const events = await collect(new CodexProvider(config()));
    const result = events[0].type === "result" ? events[0].result : undefined;
    assert.equal(result?.items[0]?.type, "idea");
    assert.equal(result?.items[0]?.priority, "medium");
    assert.equal(result?.items[0]?.routing_confidence, "medium");
    assert.deepEqual(result?.items[0]?.labels, ["ok", "123", "false"]);
    assert.deepEqual(result?.items[0]?.dependencies, []);
    assert.deepEqual(result?.items[0]?.acceptance_criteria, ["done"]);
    assert.deepEqual(result?.items[0]?.needs_clarification, []);
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
    assert.match(events[0].type === "error" ? events[0].message : "", /job_id=job-1/);
    assert.match(events[0].type === "error" ? events[0].message : "", /result_exists=false/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CodexProvider returns detailed error for invalid result shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ job_id: "job-invalid", status: "done", result: { items: "bad" } })) as typeof fetch;
  try {
    const events = await collect(new CodexProvider(config()));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    const message = events[0].type === "error" ? events[0].message : "";
    assert.match(message, /job_id=job-invalid/);
    assert.match(message, /envelope_status=done/);
    assert.match(message, /result_exists=true/);
    assert.match(message, /result_keys=items/);
    assert.match(message, /result\.source_summary must be a string/);
    assert.match(message, /result\.items must be an array/);
    assert.match(message, /result\.needs_clarification must be an array/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
