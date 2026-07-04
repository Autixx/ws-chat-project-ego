import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { ConversationStore } from "../src/conversations/conversationStore.js";
import { MessageStore } from "../src/conversations/messageStore.js";
import { openDatabase } from "../src/db/database.js";
import { createDraftApplyJob } from "../src/jobs/draftApply.js";
import { handleJobCallback } from "../src/jobs/jobCallback.js";
import { JobStore } from "../src/jobs/jobStore.js";
import { dispatchApplyJobToN8n } from "../src/jobs/n8nApply.js";
import { updateResponseDecision } from "../src/jobs/responseDecision.js";
import { mapDraftItemForN8n, sendApplyToN8n, type N8nApplyPayload } from "../src/integrations/n8nApplyClient.js";
import { parseClientMessage } from "../src/ws/protocol.js";
import type { DraftItem, StoredDraft } from "../src/drafts/types.js";

const user = { username: "worker", email: "worker@example.test", groups: [] };
const otherUser = { username: "other-worker", email: "other-worker@example.test", groups: [] };

function baseConfig(dir: string, jobCallbackToken?: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 19100,
    dataDir: dir,
    sqlitePath: path.join(dir, "projectego-chat.sqlite"),
    devAuthBypass: true,
    trustAutheliaHeaders: false,
    authMode: "local",
    registrationEnabled: true,
    cookieSecure: false,
    llmProvider: "mock",
    codexFallbackToMock: true,
    planeWorkspace: "projectego",
    jobCallbackToken
  };
}

function draftItem(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    title: "Create workbench apply pipeline",
    summary: "Wire selected draft items to n8n.",
    details: "Create a job, call n8n, and wait for callbacks.",
    project: "ProjectEGO",
    module: "Dashboard",
    type: "idea",
    priority: "medium",
    routing_confidence: "medium",
    labels: ["codex-generated"],
    dependencies: [],
    acceptance_criteria: ["n8n receives selected items"],
    needs_clarification: [],
    source_text: "User asked to apply selected draft items.",
    ...overrides
  };
}

function n8nPayload(jobId: string, itemCount = 1): N8nApplyPayload {
  return {
    jobId,
    conversationId: "C-apply",
    requestMessageId: "M-request",
    responseMessageId: "M-response",
    source: { provider: "codex", codexAgentJobId: "20260621-064612-9149beaf", mode: "create_tasks" },
    items: Array.from({ length: itemCount }, (_, index) => mapDraftItemForN8n("M-response", index, draftItem({ title: `Item ${index + 1}` })))
  };
}

function stores(jobCallbackToken = "secret-token") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "projectego-jobs-"));
  const config = baseConfig(dir, jobCallbackToken);
  const database = openDatabase(config);
  return {
    dir,
    config,
    database,
    conversations: new ConversationStore(database),
    messages: new MessageStore(database),
    jobs: new JobStore(database),
    cleanup: () => {
      database.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("JobStore creates and lists jobs", async () => {
  const s = stores();
  try {
    const conversation = await s.conversations.createConversation(user, "Jobs");
    const job = await s.jobs.createJob({
      conversationId: conversation.id,
      status: "not_started",
      source: "test",
      metadata: { backendConfigured: false }
    });
    const jobs = await s.jobs.listJobsForConversation(user, conversation.id);

    assert.match(job.id, /^JOB-/);
    assert.equal(job.status, "not_started");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].metadata?.backendConfigured, false);
  } finally {
    s.cleanup();
  }
});

test("JobStore updates job status and appends events", async () => {
  const s = stores();
  try {
    const conversation = await s.conversations.createConversation(user, "Events");
    const job = await s.jobs.createJob({ conversationId: conversation.id, status: "queued", source: "test" });
    const event = await s.jobs.appendJobEvent(job.id, "started", { message: "started" });
    const updated = await s.jobs.updateJobStatus(job.id, "running");
    const events = await s.jobs.listEventsForJob(user, job.id);

    assert.match(event.id, /^JEV-/);
    assert.equal(updated.status, "running");
    assert.ok(updated.startedAt);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload?.message, "started");
  } finally {
    s.cleanup();
  }
});

test("JobStore checks ownership through conversations", async () => {
  const s = stores();
  try {
    const conversation = await s.conversations.createConversation(user, "Ownership");
    const job = await s.jobs.createJob({ conversationId: conversation.id, status: "not_started", source: "test" });

    await assert.rejects(s.jobs.loadJobForUser(otherUser, job.id), /Job not found/);
    assert.equal((await s.jobs.loadJobForUser(user, job.id)).id, job.id);
  } finally {
    s.cleanup();
  }
});

test("job callback rejects missing or wrong token", async () => {
  const s = stores("correct-token");
  try {
    const conversation = await s.conversations.createConversation(user, "Callback auth");
    const job = await s.jobs.createJob({ conversationId: conversation.id, status: "not_started", source: "test" });
    await assert.rejects(
      handleJobCallback({ config: s.config, jobs: s.jobs, jobId: job.id, authorization: undefined, body: { status: "running", eventType: "started" } }),
      /Invalid job callback token/
    );
    await assert.rejects(
      handleJobCallback({ config: s.config, jobs: s.jobs, jobId: job.id, authorization: "Bearer wrong", body: { status: "running", eventType: "started" } }),
      /Invalid job callback token/
    );
  } finally {
    s.cleanup();
  }
});

test("job callback updates job to running succeeded and failed", async () => {
  const s = stores("callback-secret");
  try {
    const conversation = await s.conversations.createConversation(user, "Callback updates");
    const job = await s.jobs.createJob({ conversationId: conversation.id, status: "not_started", source: "test" });
    const auth = "Bearer callback-secret";

    const running = await handleJobCallback({ config: s.config, jobs: s.jobs, jobId: job.id, authorization: auth, body: { status: "running", eventType: "started" } });
    assert.equal(running.job.status, "running");
    assert.ok(running.job.startedAt);

    const succeeded = await handleJobCallback({
      config: s.config,
      jobs: s.jobs,
      jobId: job.id,
      authorization: auth,
      body: { status: "succeeded", eventType: "finished", externalRefs: [{ system: "plane", type: "work_item", id: "P-1" }] }
    });
    assert.equal(succeeded.job.status, "succeeded");
    assert.equal(succeeded.ok, true);
    assert.equal(succeeded.jobId, job.id);
    assert.equal(succeeded.eventType, "finished");
    assert.equal(succeeded.status, "succeeded");
    assert.equal(succeeded.previousStatus, "running");
    assert.equal(succeeded.nextStatus, "succeeded");
    assert.equal(succeeded.updatedRows, 1);
    assert.equal(succeeded.saved, true);
    assert.equal(succeeded.externalRefsCount, 1);
    assert.equal(succeeded.currentJob.id, job.id);
    assert.ok(succeeded.job.finishedAt);
    assert.deepEqual(succeeded.job.metadata?.externalRefs, [{ system: "plane", type: "work_item", id: "P-1" }]);
    assert.equal(succeeded.job.metadata?.lastEventStatus, "succeeded");
    assert.equal(succeeded.job.metadata?.lastEventType, "finished");

    const failed = await handleJobCallback({
      config: s.config,
      jobs: s.jobs,
      jobId: job.id,
      authorization: auth,
      body: { status: "failed", eventType: "error", message: "Plane rejected payload" }
    });
    assert.equal(failed.job.status, "failed");
    assert.equal(failed.job.errorMessage, "Plane rejected payload");
    assert.equal(failed.job.metadata?.lastEventStatus, "failed");
    assert.equal(failed.job.metadata?.lastEventType, "error");
  } finally {
    s.cleanup();
  }
});

test("n8n apply sends one selected item payload with bearer authorization", async () => {
  const s = stores();
  const originalFetch = globalThis.fetch;
  try {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("accepted", { status: 202 });
    }) as typeof fetch;
    const config = { ...s.config, n8nApplyWebhookUrl: "https://n8n.example.test/webhook/apply", n8nWebhookToken: "n8n-secret" };
    const result = await sendApplyToN8n(config, n8nPayload("JOB-1", 1));

    assert.equal(result.accepted, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://n8n.example.test/webhook/apply");
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer n8n-secret");
    const body = JSON.parse(String(calls[0].init.body)) as N8nApplyPayload;
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].draftItemId, "M-response:0");
    assert.equal(body.items[0].index, 0);
    assert.equal(body.items[0].routingConfidence, "medium");
    assert.equal(body.items[0].acceptanceCriteria[0], "n8n receives selected items");
  } finally {
    globalThis.fetch = originalFetch;
    s.cleanup();
  }
});

test("n8n apply sends multiple selected draft items as an array", async () => {
  const s = stores();
  const originalFetch = globalThis.fetch;
  try {
    let payload: N8nApplyPayload | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body)) as N8nApplyPayload;
      return new Response("accepted", { status: 200 });
    }) as typeof fetch;
    const config = { ...s.config, n8nApplyWebhookUrl: "https://n8n.example.test/webhook/apply", n8nWebhookToken: "n8n-secret" };
    await sendApplyToN8n(config, n8nPayload("JOB-1", 3));

    assert.equal(payload?.items.length, 3);
    assert.deepEqual(payload?.items.map((item) => item.draftItemId), [
      "M-response:0",
      "M-response:1",
      "M-response:2"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    s.cleanup();
  }
});

test("Draft Inspector Apply creates execution job and n8n payload uses execution job id", async () => {
  const s = stores();
  try {
    const conversation = await s.conversations.createConversation(user, "Draft apply");
    const request = await s.messages.appendUserMessage(conversation.id, user, "make tasks", { mode: "tasks" });
    const draftMessage = await s.messages.appendToolMessage(conversation.id, user, "Draft draft-job-1: 2 item(s).", {
      kind: "draft",
      jobId: "draft-job-1",
      responseToRequestId: request.id,
      decisionStatus: "pending"
    });
    await s.conversations.insertDraftRef(user, {
      conversationId: conversation.id,
      messageId: draftMessage.id,
      jobId: "draft-job-1",
      mode: "create_tasks",
      source: "browser_text",
      itemsCount: 2
    });
    const firstItem = draftItem({ title: "First selected item" });
    const secondItem = { ...draftItem({ title: "Second selected item" }), draftItemId: "persisted-item-2" } as DraftItem & { draftItemId: string };
    const draft: StoredDraft = {
      jobId: "draft-job-1",
      createdAt: new Date().toISOString(),
      mode: "create_tasks",
      source: "browser_text",
      user,
      result: {
        status: "done",
        source_summary: "summary",
        items: [firstItem, secondItem],
        needs_clarification: []
      }
    };

    const result = await createDraftApplyJob({
      conversations: s.conversations,
      messages: s.messages,
      jobs: s.jobs,
      user,
      conversationId: conversation.id,
      draft,
      applyEntries: [
        { itemNumber: 1, itemIndex: 0, item: firstItem },
        { itemNumber: 2, itemIndex: 1, item: secondItem }
      ],
      selection: { apply: [1, 2], keep: [], drop: [] },
      backendConfigured: true
    });

    assert.match(result.job.id, /^JOB-/);
    assert.equal(result.job.status, "queued");
    assert.equal(result.job.source, "n8n_apply");
    assert.equal(result.job.draftJobId, "draft-job-1");
    assert.equal(result.job.conversationId, conversation.id);
    assert.equal(result.job.requestMessageId, request.id);
    assert.equal(result.job.responseMessageId, draftMessage.id);
    assert.equal(result.payload.jobId, result.job.id);
    assert.notEqual(result.payload.jobId, "draft-job-1");
    assert.deepEqual(result.selectedDraftItemIds, [`${draftMessage.id}:0`, "persisted-item-2"]);
    assert.deepEqual(result.payload.items.map((item) => item.draftItemId), [`${draftMessage.id}:0`, "persisted-item-2"]);
    assert.equal(result.payload.items[0].index, 0);
    assert.equal(result.payload.items[1].title, "Second selected item");
  } finally {
    s.cleanup();
  }
});

test("failed n8n apply request marks execution job failed", async () => {
  const s = stores();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("workflow disabled", { status: 503 })) as typeof fetch;
    const conversation = await s.conversations.createConversation(user, "n8n failed");
    const job = await s.jobs.createJob({
      conversationId: conversation.id,
      status: "queued",
      source: "n8n_apply",
      metadata: { backend: "n8n" }
    });
    const config = { ...s.config, n8nApplyWebhookUrl: "https://n8n.example.test/webhook/apply", n8nWebhookToken: "n8n-secret" };
    const result = await dispatchApplyJobToN8n({ config, jobs: s.jobs, jobId: job.id, payload: n8nPayload(job.id) });

    assert.equal(result.result.accepted, false);
    assert.equal(result.job.status, "failed");
    assert.match(result.job.errorMessage ?? "", /HTTP 503/);
    assert.equal(result.event.eventType, "error");
  } finally {
    globalThis.fetch = originalFetch;
    s.cleanup();
  }
});

test("n8n accepted dispatch cannot overwrite terminal callback status back to running", async () => {
  const s = stores("callback-secret");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("accepted", { status: 202 })) as typeof fetch;
    const conversation = await s.conversations.createConversation(user, "race guard");
    const job = await s.jobs.createJob({ conversationId: conversation.id, status: "running", source: "n8n_apply" });
    const callback = await handleJobCallback({
      config: s.config,
      jobs: s.jobs,
      jobId: job.id,
      authorization: "Bearer callback-secret",
      body: { status: "succeeded", eventType: "finished" }
    });
    assert.equal(callback.job.status, "succeeded");

    const config = { ...s.config, n8nApplyWebhookUrl: "https://n8n.example.test/webhook/apply", n8nWebhookToken: "n8n-secret" };
    const dispatch = await dispatchApplyJobToN8n({ config, jobs: s.jobs, jobId: job.id, payload: n8nPayload(job.id) });

    assert.equal(dispatch.result.accepted, true);
    assert.equal(dispatch.job.status, "succeeded");
    assert.equal(s.jobs.loadJob(job.id).status, "succeeded");
  } finally {
    globalThis.fetch = originalFetch;
    s.cleanup();
  }
});

test("n8n callback marks apply job succeeded and stores external refs", async () => {
  const s = stores("callback-secret");
  try {
    const conversation = await s.conversations.createConversation(user, "n8n callback");
    const job = await s.jobs.createJob({ conversationId: conversation.id, status: "running", source: "n8n_apply" });
    const callback = await handleJobCallback({
      config: s.config,
      jobs: s.jobs,
      jobId: job.id,
      authorization: "Bearer callback-secret",
      body: {
        status: "succeeded",
        eventType: "finished",
        externalRefs: [{ system: "plane", type: "work_item", id: "PEGO-42", url: "https://plane.example.test/PEGO-42" }]
      }
    });

    assert.equal(callback.job.status, "succeeded");
    assert.deepEqual(callback.job.metadata?.externalRefs, [
      { system: "plane", type: "work_item", id: "PEGO-42", url: "https://plane.example.test/PEGO-42" }
    ]);
  } finally {
    s.cleanup();
  }
});

test("dedupe finished callback completes running job and preserves duplicate external refs", async () => {
  const s = stores("callback-secret");
  const originalDebug = console.debug;
  const debugCalls: unknown[] = [];
  try {
    console.debug = (...args: unknown[]) => {
      debugCalls.push(args);
    };
    const conversation = await s.conversations.createConversation(user, "dedupe callback");
    const job = await s.jobs.createJob({ conversationId: conversation.id, status: "running", source: "n8n_apply" });
    const externalRefs = [{ system: "plane", type: "work_item", id: "PEGO-42", url: "https://plane.example.test/PEGO-42" }];
    const callback = await handleJobCallback({
      config: s.config,
      jobs: s.jobs,
      jobId: job.id,
      authorization: "Bearer callback-secret",
      body: {
        status: "succeeded",
        eventType: "finished",
        payload: {
          mode: "dedupe",
          createdCount: 0,
          duplicateCount: 2,
          externalRefs
        }
      }
    });

    assert.equal(callback.job.status, "succeeded");
    assert.ok(callback.job.finishedAt);
    assert.equal(callback.job.metadata?.completedAt, callback.job.finishedAt);
    assert.deepEqual(callback.job.metadata?.externalRefs, externalRefs);
    const debugPayload = (debugCalls.find((call) => (call as unknown[])?.[0] === "ProjectEGO job callback") as unknown[])?.[1] as Record<string, unknown>;
    assert.equal(debugPayload.jobId, job.id);
    assert.equal(debugPayload.eventType, "finished");
    assert.equal(callback.ok, true);
    assert.equal(callback.jobId, job.id);
    assert.equal(callback.eventType, "finished");
    assert.equal(callback.status, "succeeded");
    assert.equal(callback.previousStatus, "running");
    assert.equal(callback.nextStatus, "succeeded");
    assert.equal(callback.updatedRows, 1);
    assert.equal(callback.saved, true);
    assert.equal(callback.externalRefsCount, 1);
    assert.equal(callback.currentJob.id, job.id);
    assert.equal(debugPayload.status, "succeeded");
    assert.equal(debugPayload.createdCount, 0);
    assert.equal(debugPayload.duplicateCount, 2);
    assert.equal(debugPayload.previousStatus, "running");
    assert.equal(debugPayload.nextStatus, "succeeded");
  } finally {
    console.debug = originalDebug;
    s.cleanup();
  }
});

test("finished callback rejects non-terminal running status", async () => {
  const s = stores("callback-secret");
  try {
    const conversation = await s.conversations.createConversation(user, "bad finished callback");
    const job = await s.jobs.createJob({ conversationId: conversation.id, status: "running", source: "n8n_apply" });
    await assert.rejects(
      handleJobCallback({
        config: s.config,
        jobs: s.jobs,
        jobId: job.id,
        authorization: "Bearer callback-secret",
        body: { status: "running", eventType: "finished" }
      }),
      /Finished callback requires terminal status/
    );
    assert.equal(s.jobs.loadJob(job.id).status, "running");
  } finally {
    s.cleanup();
  }
});

test("Apply decision creates job but does not mark execution succeeded", async () => {
  const s = stores();
  try {
    const conversation = await s.conversations.createConversation(user, "Apply job");
    const request = await s.messages.appendUserMessage(conversation.id, user, "request", { mode: "tasks" });
    const response = await s.messages.appendAssistantMessage(conversation.id, user, "response", {
      responseToRequestId: request.id,
      decisionStatus: "pending"
    });
    const result = await updateResponseDecision({
      conversations: s.conversations,
      messages: s.messages,
      jobs: s.jobs,
      user,
      conversationId: conversation.id,
      messageId: response.id,
      decisionStatus: "applied"
    });

    assert.equal(result.message.metadata?.decisionStatus, "applied");
    assert.equal(result.job?.requestMessageId, request.id);
    assert.equal(result.job?.responseMessageId, response.id);
    assert.equal(result.job?.status, "not_started");
    assert.notEqual(result.job?.status, "succeeded");
    assert.equal(result.job?.metadata?.backendConfigured, false);
  } finally {
    s.cleanup();
  }
});

test("protocol parses job_list client message", () => {
  assert.deepEqual(parseClientMessage({ type: "job_list", conversationId: "C-1" }), { type: "job_list", conversationId: "C-1" });
});

test("protocol keeps text-only request flow and allows file-only request flow", () => {
  assert.deepEqual(parseClientMessage({ type: "message_send", conversationId: "C-1", mode: "tasks", text: "plain request" }), {
    type: "message_send",
    conversationId: "C-1",
    mode: "tasks",
    text: "plain request",
    fileName: undefined,
    fileSize: undefined,
    mimeType: undefined,
    attachmentUploadIds: undefined
  });
  assert.deepEqual(parseClientMessage({ type: "message_send", conversationId: "C-1", mode: "tasks", text: "", attachmentUploadIds: ["UP-1"] }), {
    type: "message_send",
    conversationId: "C-1",
    mode: "tasks",
    text: "",
    fileName: undefined,
    fileSize: undefined,
    mimeType: undefined,
    attachmentUploadIds: ["UP-1"]
  });
});
