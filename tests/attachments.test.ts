import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";
import express from "express";
import {
  buildLlmAttachmentInputs,
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
import { isValidAgentAttachmentAuthorization } from "../src/attachments/internalAttachmentAuth.js";
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
  assert.doesNotThrow(() => validateAttachmentFile("photo.jpeg", "image/jpeg", 10));
  assert.doesNotThrow(() => validateAttachmentFile("image.png", "image/png", 10));
  assert.doesNotThrow(() => validateAttachmentFile("vector.svg", "image/svg+xml", 10));
  assert.doesNotThrow(() => validateAttachmentFile("preview.webp", "image/webp", 10));
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
  assert.throws(() => validateExtractableAttachmentFile("note.markdown", 10), /Unsupported text attachment extension/);
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

test("buildLlmAttachmentInputs forwards image attachments with internal download URL", () => {
  const result = buildLlmAttachmentInputs({
    dashboardInternalBaseUrl: "http://127.0.0.1:19100/",
    attachments: [
      {
        id: "ATT-image",
        conversationId: "C-image",
        fileName: "screen.png",
        mimeType: "image/png",
        sizeBytes: 123,
        storagePath: "attachments/C/R/ATT-image_screen.png",
        createdAt: new Date().toISOString()
      }
    ]
  });
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.attachments, [
    {
      id: "ATT-image",
      kind: "image",
      fileName: "screen.png",
      mimeType: "image/png",
      sizeBytes: 123,
      downloadUrl: "http://127.0.0.1:19100/api/internal/attachments/ATT-image"
    }
  ]);
});

test("buildLlmAttachmentInputs skips stored-only media with warning", () => {
  const result = buildLlmAttachmentInputs({
    dashboardInternalBaseUrl: "http://127.0.0.1:19100",
    attachments: [
      {
        id: "ATT-video",
        conversationId: "C-video",
        fileName: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 123,
        storagePath: "attachments/C/R/clip.mp4",
        createdAt: new Date().toISOString()
      }
    ]
  });
  assert.equal(result.attachments.length, 0);
  assert.match(result.warnings[0], /stored but not included/);
});

test("buildLlmAttachmentInputs reports missing internal base URL for images", () => {
  const result = buildLlmAttachmentInputs({
    attachments: [
      {
        id: "ATT-image",
        conversationId: "C-image",
        fileName: "screen.jpeg",
        mimeType: "image/jpeg",
        sizeBytes: 123,
        storagePath: "attachments/C/R/ATT-image_screen.jpeg",
        createdAt: new Date().toISOString()
      }
    ]
  });
  assert.equal(result.attachments.length, 0);
  assert.match(result.warnings[0], /DASHBOARD_INTERNAL_BASE_URL/);
});

test("internal attachment bearer authorization requires AGENT_ATTACHMENT_TOKEN", () => {
  const config = { agentAttachmentToken: "secret" } as never;
  assert.equal(isValidAgentAttachmentAuthorization(config, undefined), false);
  assert.equal(isValidAgentAttachmentAuthorization(config, "Bearer wrong"), false);
  assert.equal(isValidAgentAttachmentAuthorization(config, "Bearer secret"), true);
  assert.equal(isValidAgentAttachmentAuthorization({} as never, "Bearer secret"), false);
});

test("internal attachment endpoint pattern requires token and streams file", async () => {
  const s = stores();
  const app = express();
  const config = { agentAttachmentToken: "secret", dataDir: s.dir } as never;
  const relative = "attachments/internal/file.txt";
  const absolute = path.join(s.dir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, "internal-stream", "utf8");
  try {
    const conversation = await s.conversations.createConversation(user, "Internal");
    const request = await s.messages.appendUserMessage(conversation.id, user, "request");
    const attachment = await s.conversations.insertAttachment(user, {
      conversationId: conversation.id,
      messageId: request.id,
      fileName: "file.txt",
      mimeType: "text/plain",
      sizeBytes: 15,
      storagePath: relative
    });
    app.get("/api/internal/attachments/:attachmentId", async (req, res) => {
      if (!isValidAgentAttachmentAuthorization(config, req.headers.authorization)) {
        res.status(401).json({ error: "Invalid attachment token." });
        return;
      }
      await streamAttachment({ dataDir: s.dir, attachment: await s.conversations.loadAttachmentById(req.params.attachmentId), res });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const missing = await fetch(`http://127.0.0.1:${port}/api/internal/attachments/${attachment.id}`);
      assert.equal(missing.status, 401);
      const ok = await fetch(`http://127.0.0.1:${port}/api/internal/attachments/${attachment.id}`, { headers: { authorization: "Bearer secret" } });
      assert.equal(ok.status, 200);
      assert.equal(await ok.text(), "internal-stream");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    s.cleanup();
  }
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

test("image upload is stored and associated with request message", async () => {
  const s = stores();
  try {
    const tempPath = path.join(s.dir, "image.png");
    writeFileSync(tempPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const upload = await stageUploadedFile({
      dataDir: s.dir,
      user,
      tempPath,
      originalName: "image.png",
      mimeType: "image/png",
      sizeBytes: 4
    });
    const conversation = await s.conversations.createConversation(user, "Image");
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
    assert.equal(attachments[0].fileName, "image.png");
    assert.equal(attachments[0].mimeType, "image/png");
    assert.equal(attachments[0].messageId, request.id);
    assert.equal((await s.conversations.listAttachments(user, conversation.id, request.id))[0].id, attachments[0].id);
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
