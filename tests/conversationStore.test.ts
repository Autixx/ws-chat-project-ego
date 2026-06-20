import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConversationStore } from "../src/conversations/conversationStore.js";
import { MessageStore } from "../src/conversations/messageStore.js";
import { openDatabase } from "../src/db/database.js";
import { DraftStore } from "../src/drafts/draftStore.js";
import type { DraftResult } from "../src/drafts/types.js";
import { openReferencedDraft } from "../src/ws/draftOpen.js";

const user = {
  username: "tester",
  email: "tester@example.test",
  name: "Tester",
  groups: ["dev"]
};

const otherUser = {
  username: "other",
  email: "other@example.test",
  name: "Other",
  groups: ["dev"]
};

const draftResult: DraftResult = {
  status: "done",
  source_summary: "Test source",
  needs_clarification: [],
  items: [
    {
      title: "Test item",
      summary: "Summary",
      details: "Details",
      project: "Production",
      module: "Tests",
      type: "technical",
      priority: "medium",
      routing_confidence: "high",
      labels: ["test"],
      dependencies: [],
      acceptance_criteria: ["Works"],
      needs_clarification: [],
      source_text: "Source"
    }
  ]
};

function testStores() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "projectego-chat-test-"));
  const database = openDatabase({
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
    planeWorkspace: "projectego"
  });
  return {
    dir,
    database,
    conversations: new ConversationStore(database),
    messages: new MessageStore(database),
    drafts: new DraftStore(dir),
    cleanup: () => {
      database.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("ConversationStore creates, lists and loads scoped conversations", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "SQLite chat");
    const list = await stores.conversations.listConversations(user);
    const loaded = await stores.conversations.loadConversation(user, conversation.id);

    assert.equal(list.length, 1);
    assert.equal(loaded.title, "SQLite chat");
  } finally {
    stores.cleanup();
  }
});

test("ConversationStore lists archived conversations only when requested and can unarchive", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Archived");
    await stores.conversations.archiveConversation(user, conversation.id);

    assert.equal((await stores.conversations.listConversations(user)).length, 0);
    const archived = await stores.conversations.listConversations(user, true);
    assert.equal(archived.length, 1);
    assert.equal(archived[0].archived, true);

    const restored = await stores.conversations.unarchiveConversation(user, conversation.id);
    assert.equal(restored.archived, false);
    assert.equal((await stores.conversations.listConversations(user)).length, 1);
  } finally {
    stores.cleanup();
  }
});

test("ConversationStore renames conversations with a 64 character limit and unicode support", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Rename");
    const longTitle = `Рабочая область ${"x".repeat(80)}`;
    const renamed = await stores.conversations.renameConversation(user, conversation.id, longTitle);

    assert.equal(renamed.title.length, 64);
    assert.match(renamed.title, /^Рабочая область/);
  } finally {
    stores.cleanup();
  }
});

test("MessageStore appends and loads messages in created order", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Messages");
    await stores.messages.appendUserMessage(conversation.id, user, "first");
    await stores.messages.appendAssistantMessage(conversation.id, user, "second");
    const messages = await stores.messages.loadMessages(user, conversation.id);

    assert.deepEqual(messages.map((message) => message.content), ["first", "second"]);
    assert.deepEqual(messages.map((message) => message.kind), ["request", "response"]);
  } finally {
    stores.cleanup();
  }
});

test("MessageStore persists response links and decision status", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Links");
    const request = await stores.messages.appendUserMessage(conversation.id, user, "request", { mode: "digest" });
    const response = await stores.messages.appendAssistantMessage(conversation.id, user, "response", {
      responseToRequestId: request.id,
      decisionStatus: "pending"
    });
    const updated = await stores.messages.updateMessageMetadata(user, conversation.id, response.id, { decisionStatus: "kept" });
    const messages = await stores.messages.loadMessages(user, conversation.id);

    assert.equal(messages[1].metadata?.responseToRequestId, request.id);
    assert.equal(updated.metadata?.decisionStatus, "kept");
  } finally {
    stores.cleanup();
  }
});

test("draft response metadata stays lightweight", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Draft metadata");
    const request = await stores.messages.appendUserMessage(conversation.id, user, "request", { mode: "tasks" });
    const draftMessage = await stores.messages.appendToolMessage(conversation.id, user, "Draft JOB: 2 item(s).", {
      kind: "draft",
      jobId: "20260618-010203-abcdef",
      itemsCount: 2,
      mode: "tasks",
      responseToRequestId: request.id,
      decisionStatus: "pending"
    });

    assert.equal(draftMessage.metadata?.jobId, "20260618-010203-abcdef");
    assert.equal("preview" in (draftMessage.metadata ?? {}), false);
    assert.equal("result" in (draftMessage.metadata ?? {}), false);
  } finally {
    stores.cleanup();
  }
});

test("ConversationStore stores and loads attachment metadata per request", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Attachments");
    const request = await stores.messages.appendUserMessage(conversation.id, user, "see file", { mode: "chat" });
    await stores.conversations.insertAttachment(user, {
      conversationId: conversation.id,
      messageId: request.id,
      fileName: "note.md",
      mimeType: "text/markdown",
      sizeBytes: 128,
      storagePath: `inline-text://${request.id}`
    });
    const attachments = await stores.conversations.listAttachments(user, conversation.id, request.id);

    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].fileName, "note.md");
    assert.equal(attachments[0].messageId, request.id);
  } finally {
    stores.cleanup();
  }
});

test("draft_open validates draft_refs ownership", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Draft open");
    const saved = await stores.drafts.saveDraft({ mode: "structured_breakdown", source: "test", user, result: draftResult });
    await stores.conversations.insertDraftRef(user, {
      conversationId: conversation.id,
      jobId: saved.draft.jobId,
      mode: "digest",
      source: "test",
      itemsCount: saved.draft.result.items.length
    });

    await assert.rejects(
      openReferencedDraft({ conversations: stores.conversations, drafts: stores.drafts, user: otherUser, conversationId: conversation.id, jobId: saved.draft.jobId }),
      /Conversation not found/
    );
  } finally {
    stores.cleanup();
  }
});

test("draft_open emits draft_saved and draft_result from filesystem", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Draft open payload");
    const saved = await stores.drafts.saveDraft({ mode: "structured_breakdown", source: "test", user, result: draftResult });
    await stores.conversations.insertDraftRef(user, {
      conversationId: conversation.id,
      jobId: saved.draft.jobId,
      mode: "digest",
      source: "test",
      itemsCount: saved.draft.result.items.length
    });
    const payloads = await openReferencedDraft({ conversations: stores.conversations, drafts: stores.drafts, user, conversationId: conversation.id, jobId: saved.draft.jobId });

    assert.equal(payloads.saved.type, "draft_saved");
    assert.equal(payloads.result.type, "draft_result");
    assert.equal(payloads.saved.preview.includes(saved.draft.jobId), true);
    assert.equal(payloads.result.result.items[0].title, "Test item");
  } finally {
    stores.cleanup();
  }
});

test("ConversationStore inserts draft references", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Draft refs");
    const message = await stores.messages.appendAssistantMessage(conversation.id, user, "draft created");
    await stores.conversations.insertDraftRef(user, {
      conversationId: conversation.id,
      messageId: message.id,
      jobId: "20260617-010203-abcdef",
      mode: "digest",
      source: "browser_text",
      itemsCount: 2
    });
    const row = stores.database.db.prepare("SELECT job_id, items_count FROM draft_refs WHERE conversation_id = ?").get(conversation.id) as
      | { job_id: string; items_count: number }
      | undefined;

    assert.equal(row?.job_id, "20260617-010203-abcdef");
    assert.equal(row?.items_count, 2);
  } finally {
    stores.cleanup();
  }
});
