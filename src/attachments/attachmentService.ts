import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Response } from "express";
import type { AuthenticatedUser } from "../auth/authelia.js";
import type { ConversationStore } from "../conversations/conversationStore.js";
import type { AttachmentMetadata } from "../conversations/types.js";
import { createId, safeUserId } from "../utils/ids.js";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const allowedExtensions = new Set([".txt", ".md", ".mp3", ".mp4", ".jpg", ".png", ".svg"]);
const allowedMimePrefixes = new Map([
  [".txt", ["text/plain", "application/octet-stream"]],
  [".md", ["text/markdown", "text/plain", "application/octet-stream"]],
  [".mp3", ["audio/mpeg", "audio/mp3", "application/octet-stream"]],
  [".mp4", ["video/mp4", "application/octet-stream"]],
  [".jpg", ["image/jpeg", "application/octet-stream"]],
  [".png", ["image/png", "application/octet-stream"]],
  [".svg", ["image/svg+xml", "application/octet-stream"]]
]);

export type StagedUpload = {
  uploadId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

export function validateAttachmentFile(fileName: string, mimeType: string, sizeBytes: number): void {
  const ext = path.extname(fileName).toLowerCase();
  if (!allowedExtensions.has(ext)) throw new Error("Unsupported attachment extension.");
  if (sizeBytes > MAX_ATTACHMENT_BYTES) throw new Error("Attachment exceeds 25 MB limit.");
  const allowed = allowedMimePrefixes.get(ext) ?? [];
  if (mimeType && !allowed.includes(mimeType)) throw new Error("Unsupported attachment MIME type.");
}

export function sanitizeFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  const base = parsed.name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "attachment";
  const ext = parsed.ext.toLowerCase();
  return `${base}${ext}`;
}

export async function stageUploadedFile(input: {
  dataDir: string;
  user: AuthenticatedUser;
  tempPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<StagedUpload> {
  validateAttachmentFile(input.originalName, input.mimeType, input.sizeBytes);
  const uploadId = createId("UP");
  const fileName = sanitizeFileName(input.originalName);
  const relativePath = path.join("attachments", "staging", safeUserId(input.user.username), uploadId, fileName);
  const finalPath = path.join(input.dataDir, relativePath);
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.rename(input.tempPath, finalPath);
  return {
    uploadId,
    fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storagePath: relativePath.replace(/\\/g, "/")
  };
}

export async function finalizeStagedUploads(input: {
  dataDir: string;
  conversations: ConversationStore;
  user: AuthenticatedUser;
  conversationId: string;
  requestMessageId: string;
  uploadIds: string[];
}): Promise<AttachmentMetadata[]> {
  const finalized: AttachmentMetadata[] = [];
  for (const uploadId of input.uploadIds) {
    const stagedDir = path.join(input.dataDir, "attachments", "staging", safeUserId(input.user.username), uploadId);
    const files = await fs.readdir(stagedDir);
    if (files.length !== 1) throw new Error(`Invalid staged upload: ${uploadId}`);
    const fileName = sanitizeFileName(files[0]);
    const attachmentId = createId("ATT");
    const finalFileName = `${attachmentId}_${fileName}`;
    const relativePath = path.join("attachments", input.conversationId, input.requestMessageId, finalFileName);
    const finalPath = path.join(input.dataDir, relativePath);
    const sourcePath = path.join(stagedDir, files[0]);
    const stat = await fs.stat(sourcePath);
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.rename(sourcePath, finalPath);
    await fs.rm(stagedDir, { recursive: true, force: true });

    const mimeType = mimeFromExtension(fileName);
    const metadata = await input.conversations.insertAttachment(input.user, {
      id: attachmentId,
      conversationId: input.conversationId,
      messageId: input.requestMessageId,
      fileName,
      mimeType,
      sizeBytes: stat.size,
      storagePath: relativePath.replace(/\\/g, "/")
    });
    finalized.push(metadata);
  }
  return finalized;
}

export async function streamAttachment(input: {
  dataDir: string;
  attachment: AttachmentMetadata;
  res: Response;
}): Promise<void> {
  const absolutePath = path.resolve(input.dataDir, input.attachment.storagePath);
  const dataRoot = path.resolve(input.dataDir);
  const relative = path.relative(dataRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid attachment path.");
  input.res.setHeader("Content-Type", input.attachment.mimeType ?? "application/octet-stream");
  input.res.setHeader("Content-Disposition", `inline; filename="${input.attachment.fileName.replace(/"/g, "")}"`);
  createReadStream(absolutePath).pipe(input.res);
}

function mimeFromExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".txt") return "text/plain";
  if (ext === ".md") return "text/markdown";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".jpg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
