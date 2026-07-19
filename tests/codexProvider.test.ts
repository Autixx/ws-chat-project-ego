import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import type { DraftResult } from "../src/drafts/types.js";
import { CodexProvider } from "../src/llm/codexProvider.js";
import { generateCodexClientRequestId, isValidCodexClientRequestId } from "../src/llm/codexTrace.js";
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
    codexAgentUrl: "http://agent.test/v2/projectego/decompose",
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
    assert.equal(typeof body?.client_request_id, "string");
    assert.equal(isValidCodexClientRequestId(String(body?.client_request_id)), true);
    assert.equal(body?.thread_id, "projectego-intake");
    assert.deepEqual(body, {
      client_request_id: body?.client_request_id,
      thread_id: "projectego-intake",
      mode: "structured_breakdown",
      text: "Make a plan",
      source: "browser_text",
      fileName: "plan.md",
      attachments: []
    });
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
      client_request_id: body?.client_request_id,
      thread_id: "projectego-intake",
      mode: "structured_breakdown",
      source: "dashboard-upload",
      text: "User text:\nHello\n\nAttached file: note.md\nExtracted file content:\nBody",
      fileName: "note.md",
      attachments: []
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

test("CodexProvider accepts caller-supplied stable client request id and thread id", async () => {
  let body: Record<string, unknown> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ client_request_id: "dash_external-1", thread_id: "projectego-intake", status: "done", result: draftResult });
  }) as typeof fetch;
  try {
    await collectWithInput(new CodexProvider(config()), {
      ...input,
      clientRequestId: "dash_external-1",
      threadId: "projectego-intake"
    });
    assert.equal(body?.client_request_id, "dash_external-1");
    assert.equal(body?.thread_id, "projectego-intake");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateCodexClientRequestId creates safe bounded dashboard ids", () => {
  const id = generateCodexClientRequestId();
  assert.equal(id.startsWith("dash_"), true);
  assert.equal(id.length <= 128, true);
  assert.equal(isValidCodexClientRequestId(id), true);
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

test("CodexProvider normalizes v2 decompose result and exposes trace fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      client_request_id: "dash_req-123",
      job_id: "agent-job-123",
      status: "done",
      thread_id: "projectego-intake",
      session: {
        id: "internal-session-1",
        codex_session_id: "codex-session-1",
        turn_count: 3,
        max_turns: 10,
        rotated: false
      },
      result: {
        mode: "structured_breakdown",
        source_summary: "V2 summary",
        items: [
          {
            title: "Create combat board",
            type: "task",
            domain_hint: "combat",
            module_hint: "encounters",
            summary: "Add board",
            details: "Create a new combat board.",
            source_text: "Need combat board.",
            priority: "high",
            labels: ["codex-generated"],
            dependencies: [],
            acceptance_criteria: ["Board exists"],
            needs_clarification: []
          },
          {
            title: "Record decision",
            type: "decision",
            domain_hint: "core",
            module_hint: "planning",
            summary: "Capture decision",
            details: "Document accepted direction.",
            source_text: "We decided.",
            priority: "low",
            labels: [],
            dependencies: [],
            acceptance_criteria: [],
            needs_clarification: []
          }
        ],
        needs_clarification: [],
        eventlog_summary: "ok"
      },
      warnings: ["minor warning"]
    })) as typeof fetch;
  try {
    const events = await collectWithInput(new CodexProvider(config()), {
      ...input,
      clientRequestId: "dash_req-123"
    });
    assert.deepEqual(events.map((event) => event.type), ["status", "result", "done"]);
    const resultEvent = events[1];
    assert.equal(resultEvent.type, "result");
    if (resultEvent.type !== "result") return;
    assert.equal(resultEvent.result.status, "done");
    assert.equal(resultEvent.result.items[0].type, "feature");
    assert.equal(resultEvent.result.items[0].project, "combat");
    assert.equal(resultEvent.result.items[0].module, "encounters");
    assert.equal(resultEvent.result.items[0].routing_confidence, "medium");
    assert.equal(resultEvent.result.items[1].type, "idea");
    assert.equal(resultEvent.trace?.clientRequestId, "dash_req-123");
    assert.equal(resultEvent.trace?.codexJobId, "agent-job-123");
    assert.equal(resultEvent.trace?.codexInternalSessionId, "internal-session-1");
    assert.equal(resultEvent.trace?.codexSessionId, "codex-session-1");
    assert.equal(resultEvent.trace?.sessionTurnCount, 3);
    assert.equal(resultEvent.trace?.sessionRotated, false);
    assert.deepEqual(resultEvent.trace?.warnings, ["minor warning"]);
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

test("CodexProvider returns error when v2 envelope status is error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ client_request_id: "dash_error-1", job_id: "job-error", status: "error", error: "model failed" })) as typeof fetch;
  try {
    const events = await collect(new CodexProvider(config()));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    if (events[0].type !== "error") return;
    assert.match(events[0].message, /status error/);
    assert.match(events[0].message, /model failed/);
    assert.equal(events[0].trace?.clientRequestId, "dash_error-1");
    assert.equal(events[0].trace?.codexJobId, "job-error");
    assert.equal(events[0].trace?.status, "error");
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
