import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Response } from "express";
import type { PmAttachment } from "./types.js";

export const DEFAULT_PM_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const allowedExtensions = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".log",
  ".yml",
  ".yaml",
  ".xml",
  ".ini",
  ".conf",
  ".jpg",
  ".jpeg",
  ".png",
  ".svg",
  ".webp",
  ".gif",
  ".mp3",
  ".mp4",
  ".pdf",
  ".zip"
]);

export type StoredPmAttachment = {
  originalFileName: string;
  storedFileName: string;
  mimeType?: string;
  sizeBytes: number;
  storagePath: string;
};

export type StoredPmProjectBackground = {
  storedFileName: string;
  mimeType?: string;
  sizeBytes: number;
  storagePath: string;
};

export function sanitizePmFileName(value: string): string {
  const base = path.basename(value).replaceAll(/[^\w.\-()[\] а-яА-ЯёЁ]+/gu, "_").replaceAll(/_+/g, "_").trim();
  const cleaned = base.replaceAll(/^\.+/g, "").slice(0, 180);
  return cleaned || "attachment";
}

export function validatePmAttachmentFile(fileName: string, sizeBytes: number, maxBytes = DEFAULT_PM_MAX_ATTACHMENT_BYTES): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new Error("Attachment size is invalid.");
  if (sizeBytes > maxBytes) throw new Error(`Attachment exceeds ${maxBytes} bytes.`);
  const ext = path.extname(fileName).toLowerCase();
  if (!allowedExtensions.has(ext)) {
    throw new Error(`Unsupported attachment extension: ${ext || "none"}.`);
  }
}

export function validatePmProjectBackgroundFile(fileName: string, sizeBytes: number, maxBytes = DEFAULT_PM_MAX_ATTACHMENT_BYTES): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new Error("Background image size is invalid.");
  if (sizeBytes > maxBytes) throw new Error(`Background image exceeds ${maxBytes} bytes.`);
  const ext = path.extname(fileName).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".gif"].includes(ext)) {
    throw new Error(`Unsupported background image extension: ${ext || "none"}.`);
  }
}

export async function storePmTaskAttachment(input: {
  attachmentsDir: string;
  taskId: string;
  tempPath: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  maxBytes?: number;
}): Promise<StoredPmAttachment> {
  const originalFileName = sanitizePmFileName(input.originalName);
  validatePmAttachmentFile(originalFileName, input.sizeBytes, input.maxBytes);
  const ext = path.extname(originalFileName).toLowerCase();
  const storedFileName = `PMATT_${randomBytes(10).toString("hex")}${ext}`;
  const taskDir = safeJoin(input.attachmentsDir, input.taskId);
  const storagePath = safeJoin(taskDir, storedFileName);
  await fs.mkdir(taskDir, { recursive: true });
  await fs.rename(input.tempPath, storagePath);
  return {
    originalFileName,
    storedFileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storagePath
  };
}

export async function storePmProjectBackground(input: {
  attachmentsDir: string;
  projectId: string;
  tempPath: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  maxBytes?: number;
}): Promise<StoredPmProjectBackground> {
  const originalFileName = sanitizePmFileName(input.originalName);
  validatePmProjectBackgroundFile(originalFileName, input.sizeBytes, input.maxBytes);
  const ext = path.extname(originalFileName).toLowerCase();
  const storedFileName = `PMBG_${randomBytes(10).toString("hex")}${ext}`;
  const projectDir = safeJoin(safeJoin(input.attachmentsDir, "project-backgrounds"), input.projectId);
  const storagePath = safeJoin(projectDir, storedFileName);
  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.rename(input.tempPath, storagePath);
  return {
    storedFileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storagePath
  };
}

export async function removePmProjectBackground(attachmentsDir: string, projectId: string): Promise<void> {
  const projectDir = safeJoin(safeJoin(attachmentsDir, "project-backgrounds"), projectId);
  await fs.rm(projectDir, { recursive: true, force: true });
}

export async function removePmAttachmentFile(attachmentsDir: string, attachment: PmAttachment): Promise<void> {
  const storagePath = resolveAttachmentPath(attachmentsDir, attachment.storagePath);
  await fs.rm(storagePath, { force: true });
}

export function streamPmAttachment(attachmentsDir: string, attachment: PmAttachment, res: Response): void {
  const storagePath = resolveAttachmentPath(attachmentsDir, attachment.storagePath);
  res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(attachment.sizeBytes));
  res.setHeader("Content-Disposition", `attachment; filename="${escapeHeaderValue(attachment.originalFileName || attachment.storedFileName)}"`);
  createReadStream(storagePath).pipe(res);
}

export function resolveAttachmentPath(attachmentsDir: string, candidate: string): string {
  const root = path.resolve(attachmentsDir);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Attachment path escapes PM attachments directory.");
  }
  return resolved;
}

function safeJoin(root: string, child: string): string {
  const resolved = path.resolve(root, child);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsafe attachment path.");
  return resolved;
}

function escapeHeaderValue(value: string): string {
  return value.replaceAll(/["\r\n]/g, "_");
}
