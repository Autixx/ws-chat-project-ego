import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageUploadedFile, finalizeStagedUploads, validateAttachmentFile } from "../src/attachments/attachmentService.js";
import { ConversationStore } from "../src/conversations/conversationStore.js";
import { MessageStore } from "../src/conversations/messageStore.js";
import { openDatabase } from "../src/db/database.js";

const user = { username: "uploader", email: "uploader@example.test", groups: [] };
const otherUser = { username: "other", email: "other@example.test", groups: [] };

function stores() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "projectego-attachments-"));
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
    cleanup: () => {
      database.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("validateAttachmentFile rejects unsupported extensions", () => {
  assert.throws(() => validateAttachmentFile("bad.exe", "application/octet-stream", 10), /Unsupported attachment extension/);
});

test("validateAttachmentFile rejects files over 25 MB", () => {
  assert.throws(() => validateAttachmentFile("clip.mp4", "video/mp4", 25 * 1024 * 1024 + 1), /25 MB/);
});

test("stage and finalize upload stores file and SQLite metadata", async () => {
  const s = stores();
  try {
    const tempPath = path.join(s.dir, "input.txt");
    writeFileSync(tempPath, "hello", "utf8");
    const upload = await stageUploadedFile({
      dataDir: s.dir,
      user,
      tempPath,
      originalName: "hello.txt",
      mimeType: "text/plain",
      sizeBytes: 5
    });
    assert.equal(existsSync(path.join(s.dir, upload.storagePath)), true);

    const conversation = await s.conversations.createConversation(user, "Upload");
    const request = await s.messages.appendUserMessage(conversation.id, user, "request");
    const attachments = await finalizeStagedUploads({
      dataDir: s.dir,
      conversations: s.conversations,
      user,
      conversationId: conversation.id,
      requestMessageId: request.id,
      uploadIds: [upload.uploadId]
    });

    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].fileName, "hello.txt");
    assert.equal(statSync(path.join(s.dir, attachments[0].storagePath)).size, 5);
    assert.equal((await s.conversations.listAttachments(user, conversation.id, request.id)).length, 1);
  } finally {
    s.cleanup();
  }
});

test("attachment download lookup denies unauthorized user and allows owner", async () => {
  const s = stores();
  try {
    const conversation = await s.conversations.createConversation(user, "Download");
    const request = await s.messages.appendUserMessage(conversation.id, user, "request");
    const attachment = await s.conversations.insertAttachment(user, {
      conversationId: conversation.id,
      messageId: request.id,
      fileName: "hello.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      storagePath: "attachments/test/hello.txt"
    });

    await assert.rejects(s.conversations.loadAttachmentForUser(otherUser, attachment.id), /Attachment not found/);
    assert.equal((await s.conversations.loadAttachmentForUser(user, attachment.id)).id, attachment.id);
  } finally {
    s.cleanup();
  }
});
