import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConversationStore } from "../src/conversations/conversationStore.js";
import { MessageStore } from "../src/conversations/messageStore.js";
import { openDatabase } from "../src/db/database.js";

const user = {
  username: "tester",
  email: "tester@example.test",
  name: "Tester",
  groups: ["dev"]
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
    llmProvider: "mock",
    codexFallbackToMock: true,
    planeWorkspace: "projectego"
  });
  return {
    dir,
    database,
    conversations: new ConversationStore(database),
    messages: new MessageStore(database),
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

test("MessageStore appends and loads messages in created order", async () => {
  const stores = testStores();
  try {
    const conversation = await stores.conversations.createConversation(user, "Messages");
    await stores.messages.appendUserMessage(conversation.id, user, "first");
    await stores.messages.appendAssistantMessage(conversation.id, user, "second");
    const messages = await stores.messages.loadMessages(user, conversation.id);

    assert.deepEqual(messages.map((message) => message.content), ["first", "second"]);
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
