import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { ConversationStore } from "../src/conversations/conversationStore.js";
import { MessageStore } from "../src/conversations/messageStore.js";
import { openDatabase } from "../src/db/database.js";
import { handleJobCallback } from "../src/jobs/jobCallback.js";
import { JobStore } from "../src/jobs/jobStore.js";
import { updateResponseDecision } from "../src/jobs/responseDecision.js";
import { parseClientMessage } from "../src/ws/protocol.js";

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
    assert.ok(succeeded.job.finishedAt);
    assert.deepEqual(succeeded.job.metadata?.externalRefs, [{ system: "plane", type: "work_item", id: "P-1" }]);

    const failed = await handleJobCallback({
      config: s.config,
      jobs: s.jobs,
      jobId: job.id,
      authorization: auth,
      body: { status: "failed", eventType: "error", message: "Plane rejected payload" }
    });
    assert.equal(failed.job.status, "failed");
    assert.equal(failed.job.errorMessage, "Plane rejected payload");
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
