import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";
import {
  buildLlmPromptWithAttachments,
  extractAttachmentText,
  finalizeStagedUploads,
  firstExtractedFileName,
  stageUploadedFile,
  validateAttachmentFile,
  validateExtractableAttachmentFile,
  streamAttachment,
  deleteStoredAttachments
} from "../src/attachments/attachmentService.js";
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

test("validateAttachmentFile accepts supported attachment types", () => {
  assert.doesNotThrow(() => validateAttachmentFile("note.txt", "text/plain", 10));
  assert.doesNotThrow(() => validateAttachmentFile("note.md", "text/markdown", 10));
  assert.doesNotThrow(() => validateAttachmentFile("note.markdown", "text/markdown", 10));
  assert.doesNotThrow(() => validateAttachmentFile("payload.json", "application/json", 10));
  assert.doesNotThrow(() => validateAttachmentFile("data.csv", "text/csv", 10));
  assert.doesNotThrow(() => validateAttachmentFile("trace.log", "text/plain", 10));
  assert.doesNotThrow(() => validateAttachmentFile("config.yml", "text/yaml", 10));
  assert.doesNotThrow(() => validateAttachmentFile("config.yaml", "text/yaml", 10));
  assert.doesNotThrow(() => validateAttachmentFile("doc.xml", "application/xml", 10));
  assert.doesNotThrow(() => validateAttachmentFile("app.ini", "text/plain", 10));
  assert.doesNotThrow(() => validateAttachmentFile("app.conf", "text/plain", 10));
  assert.doesNotThrow(() => validateAttachmentFile("voice.mp3", "audio/mpeg", 10));
  assert.doesNotThrow(() => validateAttachmentFile("clip.mp4", "video/mp4", 10));
  assert.doesNotThrow(() => validateAttachmentFile("photo.jpg", "image/jpeg", 10));
  assert.doesNotThrow(() => validateAttachmentFile("image.png", "image/png", 10));
  assert.doesNotThrow(() => validateAttachmentFile("vector.svg", "image/svg+xml", 10));
});

test("extractAttachmentText accepts markdown and strips NUL bytes", async () => {
  const s = stores();
  try {
    const relative = "attachments/request/notes.md";
    const absolute = path.join(s.dir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, "# Title\0\nbody", "utf8");

    const extracted = await extractAttachmentText({
      dataDir: s.dir,
      attachment: {
        id: "ATT-md",
        conversationId: "C-md",
        fileName: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 13,
        storagePath: relative,
        createdAt: new Date().toISOString()
      }
    });

    assert.equal(extracted.fileName, "notes.md");
    assert.equal(extracted.text, "# Title\nbody");
    assert.equal(extracted.truncated, false);
    assert.equal(extracted.extension, ".md");
  } finally {
    s.cleanup();
  }
});

test("extractAttachmentText caps extracted content and marks truncation", async () => {
  const s = stores();
  try {
    const relative = "attachments/request/large.log";
    const absolute = path.join(s.dir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, "abcdef", "utf8");

    const extracted = await extractAttachmentText({
      dataDir: s.dir,
      maxExtractedChars: 3,
      attachment: {
        id: "ATT-log",
        conversationId: "C-log",
        fileName: "large.log",
        mimeType: "text/plain",
        sizeBytes: 6,
        storagePath: relative,
        createdAt: new Date().toISOString()
      }
    });

    assert.equal(extracted.text, "abc");
    assert.equal(extracted.extractedChars, 3);
    assert.equal(extracted.truncated, true);
  } finally {
    s.cleanup();
  }
});

test("validateExtractableAttachmentFile rejects unsupported and oversized files", () => {
  assert.throws(() => validateExtractableAttachmentFile("image.png", 10), /Unsupported text attachment extension/);
  assert.throws(() => validateExtractableAttachmentFile("large.md", 11, 10), /text extraction limit/);
});

test("buildLlmPromptWithAttachments combines text and file content", () => {
  const prompt = buildLlmPromptWithAttachments("Please summarize", [
    {
      attachment: {
        id: "ATT-combine",
        conversationId: "C-combine",
        fileName: "plan.md",
        mimeType: "text/markdown",
        sizeBytes: 4,
        storagePath: "attachments/request/plan.md",
        createdAt: new Date().toISOString()
      },
      fileName: "plan.md",
      text: "file body",
      extractedChars: 9,
      truncated: false,
      extension: ".md"
    }
  ]);
  assert.equal(prompt, "User text:\nPlease summarize\n\nAttached file: plan.md\nExtracted file content:\nfile body");
});

test("firstExtractedFileName returns filename passed to LLM provider", () => {
  assert.equal(
    firstExtractedFileName([
      {
        attachment: {
          id: "ATT-name",
          conversationId: "C-name",
          fileName: "source.json",
          mimeType: "application/json",
          sizeBytes: 2,
          storagePath: "attachments/request/source.json",
          createdAt: new Date().toISOString()
        },
        fileName: "source.json",
        text: "{}",
        extractedChars: 2,
        truncated: false,
        extension: ".json"
      }
    ]),
    "source.json"
  );
});

test("extractAttachmentText rejects paths outside attachments directory", async () => {
  const s = stores();
  try {
    await assert.rejects(
      extractAttachmentText({
        dataDir: s.dir,
        attachment: {
          id: "ATT-escape",
          conversationId: "C-escape",
          fileName: "escape.md",
          mimeType: "text/markdown",
          sizeBytes: 4,
          storagePath: "../escape.md",
          createdAt: new Date().toISOString()
        }
      }),
      /Invalid attachment path/
    );
  } finally {
    s.cleanup();
  }
});

test("buildLlmPromptWithAttachments keeps old text-only request unchanged", () => {
  assert.equal(buildLlmPromptWithAttachments("plain request", []), "plain request");
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
    assert.match(upload.uploadId, /^UP-/);
    assert.equal(upload.fileName, "hello.txt");
    assert.equal(upload.mimeType, "text/plain");
    assert.equal(upload.sizeBytes, 5);
    assert.match(upload.storagePath, /attachments\/staging\/uploader\/UP-/);

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
    assert.equal(attachments[0].messageId, request.id);
    assert.match(attachments[0].storagePath, new RegExp(`attachments/${conversation.id}/${request.id}/ATT-`));
    assert.equal(statSync(path.join(s.dir, attachments[0].storagePath)).size, 5);
    assert.equal((await s.conversations.listAttachments(user, conversation.id, request.id)).length, 1);
  } finally {
    s.cleanup();
  }
});

test("stageUploadedFile sanitizes names so saved path stays under attachments", async () => {
  const s = stores();
  try {
    const tempPath = path.join(s.dir, "unsafe.md");
    writeFileSync(tempPath, "safe", "utf8");
    const upload = await stageUploadedFile({
      dataDir: s.dir,
      user,
      tempPath,
      originalName: "../escape.md",
      mimeType: "text/markdown",
      sizeBytes: 4
    });
    const absolute = path.resolve(s.dir, upload.storagePath);
    const attachmentsRoot = path.resolve(s.dir, "attachments");
    assert.equal(path.relative(attachmentsRoot, absolute).startsWith(".."), false);
    assert.equal(upload.fileName, "escape.md");
  } finally {
    s.cleanup();
  }
});

test("listAttachments returns only attachments for requested message", async () => {
  const s = stores();
  try {
    const conversation = await s.conversations.createConversation(user, "Filter");
    const first = await s.messages.appendUserMessage(conversation.id, user, "first");
    const second = await s.messages.appendUserMessage(conversation.id, user, "second");
    await s.conversations.insertAttachment(user, {
      conversationId: conversation.id,
      messageId: first.id,
      fileName: "first.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      storagePath: "attachments/filter/first.txt"
    });
    await s.conversations.insertAttachment(user, {
      conversationId: conversation.id,
      messageId: second.id,
      fileName: "second.txt",
      mimeType: "text/plain",
      sizeBytes: 6,
      storagePath: "attachments/filter/second.txt"
    });

    const firstAttachments = await s.conversations.listAttachments(user, conversation.id, first.id);
    assert.deepEqual(firstAttachments.map((attachment) => attachment.fileName), ["first.txt"]);
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

test("streamAttachment streams owner file and rejects unsafe paths", async () => {
  const s = stores();
  try {
    const safeRelative = "attachments/stream/file.txt";
    const safeAbsolute = path.join(s.dir, safeRelative);
    mkdirSync(path.dirname(safeAbsolute), { recursive: true });
    writeFileSync(safeAbsolute, "streamed", "utf8");
    const chunks: Buffer[] = [];
    const res = new PassThrough() as PassThrough & { setHeader: () => void };
    res.setHeader = () => {};
    res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

    await streamAttachment({
      dataDir: s.dir,
      attachment: {
        id: "ATT-test",
        conversationId: "C-test",
        fileName: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 8,
        storagePath: safeRelative,
        createdAt: new Date().toISOString()
      },
      res: res as never
    });
    await new Promise((resolve) => res.on("finish", resolve));
    assert.equal(Buffer.concat(chunks).toString("utf8"), "streamed");

    const unsafeRes = new PassThrough() as PassThrough & { setHeader: () => void };
    unsafeRes.setHeader = () => {};
    await assert.rejects(
      streamAttachment({
        dataDir: s.dir,
        attachment: {
          id: "ATT-bad",
          conversationId: "C-test",
          fileName: "bad.txt",
          mimeType: "text/plain",
          sizeBytes: 1,
          storagePath: "../bad.txt",
          createdAt: new Date().toISOString()
        },
        res: unsafeRes as never
      }),
      /Invalid attachment path/
    );
  } finally {
    s.cleanup();
  }
});

test("deleteStoredAttachments removes stored files but ignores unsafe paths", async () => {
  const s = stores();
  try {
    const safeRelative = "attachments/delete/file.txt";
    const safeAbsolute = path.join(s.dir, safeRelative);
    mkdirSync(path.dirname(safeAbsolute), { recursive: true });
    writeFileSync(safeAbsolute, "delete me", "utf8");

    await deleteStoredAttachments(s.dir, [
      {
        id: "ATT-safe",
        conversationId: "C-delete",
        fileName: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 9,
        storagePath: safeRelative,
        createdAt: new Date().toISOString()
      },
      {
        id: "ATT-unsafe",
        conversationId: "C-delete",
        fileName: "bad.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        storagePath: "../bad.txt",
        createdAt: new Date().toISOString()
      }
    ]);

    assert.equal(existsSync(safeAbsolute), false);
  } finally {
    s.cleanup();
  }
});
