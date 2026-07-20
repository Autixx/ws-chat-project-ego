import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Response } from "express";
import type { AuthenticatedUser } from "../auth/authelia.js";
import type { ConversationStore } from "../conversations/conversationStore.js";
import type { AttachmentMetadata } from "../conversations/types.js";
import type { DraftWarning, LlmAttachmentInput, SourceFileInfo } from "../llm/provider.js";
import { createId, safeUserId } from "../utils/ids.js";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_UPLOAD_BYTES = 1_048_576;
export const DEFAULT_MAX_EXTRACTED_CHARS = 50_000;
export const DEFAULT_MAX_LLM_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_TEXT_FILE_BYTES = 256 * 1024;
export const DEFAULT_MAX_TOTAL_EXTRACTED_CHARS = 512 * 1024;
const textLikeExtensions = new Set([".txt", ".md", ".markdown", ".log", ".json", ".yaml", ".yml", ".csv", ".tsv", ".xml", ".ini", ".cfg", ".conf", ".toml", ".gitignore"]);
const sensitiveTextExtensions = new Set([".env"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".svg", ".webp", ".gif"]);
const knownUnsupportedExtensions = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".rtf"]);
const blockedBinaryExtensions = new Set([".exe", ".dll", ".bat", ".cmd", ".ps1", ".sh", ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz"]);
const allowedExtensions = new Set([...textLikeExtensions, ...sensitiveTextExtensions, ".mp3", ".mp4", ...imageExtensions, ...knownUnsupportedExtensions]);
const allowedMimePrefixes = new Map([
  [".txt", ["text/plain", "application/octet-stream"]],
  [".md", ["text/markdown", "text/plain", "application/octet-stream"]],
  [".markdown", ["text/markdown", "text/plain", "application/octet-stream"]],
  [".json", ["application/json", "text/json", "text/plain", "application/octet-stream"]],
  [".csv", ["text/csv", "text/plain", "application/octet-stream"]],
  [".tsv", ["text/tab-separated-values", "text/plain", "application/octet-stream"]],
  [".log", ["text/plain", "application/octet-stream"]],
  [".yml", ["application/yaml", "application/x-yaml", "text/yaml", "text/plain", "application/octet-stream"]],
  [".yaml", ["application/yaml", "application/x-yaml", "text/yaml", "text/plain", "application/octet-stream"]],
  [".xml", ["application/xml", "text/xml", "text/plain", "application/octet-stream"]],
  [".ini", ["text/plain", "application/octet-stream"]],
  [".cfg", ["text/plain", "application/octet-stream"]],
  [".conf", ["text/plain", "application/octet-stream"]],
  [".toml", ["application/toml", "text/plain", "application/octet-stream"]],
  [".env", ["text/plain", "application/octet-stream"]],
  [".gitignore", ["text/plain", "application/octet-stream"]],
  [".mp3", ["audio/mpeg", "audio/mp3", "application/octet-stream"]],
  [".mp4", ["video/mp4", "application/octet-stream"]],
  [".jpg", ["image/jpeg", "image/jpg", "application/octet-stream"]],
  [".jpeg", ["image/jpeg", "image/jpg", "application/octet-stream"]],
  [".png", ["image/png", "application/octet-stream"]],
  [".svg", ["image/svg+xml", "application/octet-stream"]],
  [".webp", ["image/webp", "application/octet-stream"]],
  [".gif", ["image/gif", "application/octet-stream"]],
  [".pdf", ["application/pdf", "application/octet-stream"]],
  [".doc", ["application/msword", "application/octet-stream"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"]],
  [".xls", ["application/vnd.ms-excel", "application/octet-stream"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"]],
  [".ppt", ["application/vnd.ms-powerpoint", "application/octet-stream"]],
  [".pptx", ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/octet-stream"]],
  [".odt", ["application/vnd.oasis.opendocument.text", "application/octet-stream"]],
  [".rtf", ["application/rtf", "text/rtf", "application/octet-stream"]]
]);

export type StagedUpload = {
  uploadId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

export type ExtractedAttachmentText = {
  attachment: AttachmentMetadata;
  fileName: string;
  text: string;
  extractedChars: number;
  truncated: boolean;
  extension: string;
};

export type PreparedDraftAttachments = {
  text: string;
  attachments: LlmAttachmentInput[];
  sourceFiles: SourceFileInfo[];
  warnings: DraftWarning[];
  extracted: ExtractedAttachmentText[];
};

export function validateAttachmentFile(fileName: string, mimeType: string, sizeBytes: number): void {
  const ext = normalizedExtension(fileName);
  if (blockedBinaryExtensions.has(ext)) throw new Error("Unsupported attachment extension.");
  if (!allowedExtensions.has(ext) && !(ext === "" && isSupportedTextMimeType(mimeType))) throw new Error("Unsupported attachment extension.");
  if (sizeBytes > MAX_ATTACHMENT_BYTES) throw new Error("Attachment exceeds 25 MB limit.");
  const allowed = allowedMimePrefixes.get(ext) ?? [];
  if (mimeType && allowed.length > 0 && !allowed.includes(mimeType)) throw new Error("Unsupported attachment MIME type.");
}

export function validateExtractableAttachmentFile(fileName: string, sizeBytes: number, maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES): void {
  const ext = normalizedExtension(fileName);
  if (sensitiveTextExtensions.has(ext)) throw new Error("Sensitive text attachment is not included by default.");
  if (!textLikeExtensions.has(ext)) throw new Error(`Unsupported text attachment extension: ${ext || "(none)"}.`);
  if (sizeBytes > maxUploadBytes) throw new Error(`Attachment exceeds ${maxUploadBytes} byte text extraction limit.`);
}

export function isTextLikeAttachment(fileName: string, mimeType?: string): boolean {
  const ext = normalizedExtension(fileName);
  if (sensitiveTextExtensions.has(ext)) return false;
  if (textLikeExtensions.has(ext)) return true;
  if (!ext && mimeType?.toLowerCase().startsWith("text/")) return true;
  return isSupportedTextMimeType(mimeType);
}

export function isImageAttachment(fileName: string, mimeType?: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  if (mimeType && ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp", "image/gif"].includes(mimeType.toLowerCase())) return true;
  return imageExtensions.has(ext);
}

export function isLlmForwardableAttachment(attachment: AttachmentMetadata, maxBytes = DEFAULT_MAX_LLM_ATTACHMENT_BYTES): boolean {
  return isImageAttachment(attachment.fileName, attachment.mimeType) && attachment.sizeBytes <= maxBytes;
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
    const storedFileName = `${attachmentId}${path.extname(fileName).toLowerCase()}`;
    const finalFileName = storedFileName;
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
      originalFileName: fileName,
      storedFileName,
      mimeType,
      sizeBytes: stat.size,
      storagePath: relativePath.replace(/\\/g, "/")
    });
    finalized.push(metadata);
  }
  return finalized;
}

export async function extractAttachmentText(input: {
  dataDir: string;
  attachment: AttachmentMetadata;
  maxUploadBytes?: number;
  maxExtractedChars?: number;
}): Promise<ExtractedAttachmentText> {
  const maxUploadBytes = input.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const maxExtractedChars = input.maxExtractedChars ?? DEFAULT_MAX_EXTRACTED_CHARS;
  validateExtractableAttachmentFile(input.attachment.fileName, input.attachment.sizeBytes, maxUploadBytes);
  const absolutePath = safeAttachmentPath(input.dataDir, input.attachment.storagePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const cleaned = normalizeAttachmentText(raw);
  const truncated = cleaned.length > maxExtractedChars;
  const text = truncated ? cleaned.slice(0, maxExtractedChars) : cleaned;
  return {
    attachment: input.attachment,
    fileName: input.attachment.originalFileName ?? input.attachment.fileName,
    text,
    extractedChars: text.length,
    truncated,
    extension: normalizedExtension(input.attachment.fileName)
  };
}

export async function extractTextAttachments(input: {
  dataDir: string;
  attachments: AttachmentMetadata[];
  maxUploadBytes?: number;
  maxExtractedChars?: number;
}): Promise<{ extracted: ExtractedAttachmentText[]; warnings: string[] }> {
  const extracted: ExtractedAttachmentText[] = [];
  const warnings: string[] = [];
  for (const attachment of input.attachments) {
    if (!isTextLikeAttachment(attachment.fileName, attachment.mimeType)) continue;
    const item = await extractAttachmentText({
      dataDir: input.dataDir,
      attachment,
      maxUploadBytes: input.maxUploadBytes,
      maxExtractedChars: input.maxExtractedChars
    });
    extracted.push(item);
    if (item.truncated) warnings.push(`Attached file ${item.fileName} was truncated to ${item.extractedChars} characters.`);
  }
  return { extracted, warnings };
}

export function buildLlmPromptWithAttachments(userText: string, extracted: ExtractedAttachmentText[]): string {
  const cleanText = userText.trim();
  if (!extracted.length) return cleanText;
  const fileSections = extracted
    .map((item) => [`--- ATTACHED TEXT FILE: ${sanitizeDelimiterFileName(item.fileName)} ---`, item.text, `--- END ATTACHED TEXT FILE: ${sanitizeDelimiterFileName(item.fileName)} ---`].join("\n"))
    .join("\n\n");
  if (!cleanText) return fileSections;
  return [cleanText, "", fileSections].join("\n");
}

export function firstExtractedFileName(extracted: ExtractedAttachmentText[]): string | undefined {
  return extracted[0] ? extracted[0].attachment.storedFileName ?? path.basename(extracted[0].attachment.storagePath) : undefined;
}

export function buildLlmAttachmentInputs(input: {
  attachments: AttachmentMetadata[];
  dashboardInternalBaseUrl?: string;
  maxLlmAttachmentBytes?: number;
}): { attachments: LlmAttachmentInput[]; warnings: string[] } {
  const llmAttachments: LlmAttachmentInput[] = [];
  const warnings: string[] = [];
  const baseUrl = input.dashboardInternalBaseUrl?.replace(/\/+$/, "");
  const maxBytes = input.maxLlmAttachmentBytes ?? DEFAULT_MAX_LLM_ATTACHMENT_BYTES;
  for (const attachment of input.attachments) {
    const internalName = attachment.storedFileName ?? path.basename(attachment.storagePath);
    if (isTextLikeAttachment(attachment.fileName, attachment.mimeType)) continue;
    if (!isImageAttachment(attachment.fileName, attachment.mimeType)) {
      warnings.push(`Attachment ${internalName} is stored but not included in LLM context.`);
      continue;
    }
    if (attachment.sizeBytes > maxBytes) {
      warnings.push(`Image attachment ${internalName} exceeds ${maxBytes} byte LLM attachment limit and was not included.`);
      continue;
    }
    if (!baseUrl) {
      warnings.push("Image attachment forwarding requires DASHBOARD_INTERNAL_BASE_URL.");
      continue;
    }
    llmAttachments.push({
      id: attachment.id,
      kind: "image",
      fileName: internalName,
      mimeType: attachment.mimeType ?? "application/octet-stream",
      sizeBytes: attachment.sizeBytes,
      downloadUrl: `${baseUrl}/api/internal/attachments/${encodeURIComponent(attachment.id)}`
    });
  }
  return { attachments: llmAttachments, warnings };
}

export async function prepareDraftAttachmentContext(input: {
  dataDir: string;
  userText: string;
  attachments: AttachmentMetadata[];
  dashboardInternalBaseUrl?: string;
  maxUploadBytes?: number;
  maxExtractedChars?: number;
  maxTotalExtractedChars?: number;
  maxLlmAttachmentBytes?: number;
}): Promise<PreparedDraftAttachments> {
  const sourceFiles: SourceFileInfo[] = [];
  const warnings: DraftWarning[] = [];
  const extracted: ExtractedAttachmentText[] = [];
  const imageAttachments: AttachmentMetadata[] = [];
  const maxTextBytes = Math.min(input.maxUploadBytes ?? DEFAULT_MAX_TEXT_FILE_BYTES, DEFAULT_MAX_TEXT_FILE_BYTES);
  const maxExtractedChars = input.maxExtractedChars ?? DEFAULT_MAX_EXTRACTED_CHARS;
  const maxTotalExtractedChars = input.maxTotalExtractedChars ?? DEFAULT_MAX_TOTAL_EXTRACTED_CHARS;
  let totalExtractedChars = 0;

  for (const attachment of input.attachments) {
    const displayName = attachment.originalFileName ?? attachment.fileName;
    const mimeType = attachment.mimeType;
    if (isSensitiveTextAttachment(attachment.fileName)) {
      sourceFiles.push(sourceFile(attachment, "unsupported", { skipped: true, reason: "sensitive_file_type" }));
      warnings.push({ code: "sensitive_file_type", message: `Sensitive file skipped: ${displayName}`, fileName: displayName });
      continue;
    }
    if (isTextLikeAttachment(attachment.fileName, mimeType)) {
      if (attachment.sizeBytes > maxTextBytes) {
        sourceFiles.push(sourceFile(attachment, "unsupported", { skipped: true, reason: "text_file_too_large" }));
        warnings.push({ code: "text_file_too_large", message: `Text file skipped because it exceeds ${maxTextBytes} bytes: ${displayName}`, fileName: displayName });
        continue;
      }
      const remainingChars = maxTotalExtractedChars - totalExtractedChars;
      if (remainingChars <= 0) {
        sourceFiles.push(sourceFile(attachment, "unsupported", { skipped: true, reason: "total_text_limit_exceeded" }));
        warnings.push({ code: "total_text_limit_exceeded", message: `Text file skipped because total extracted text limit was reached: ${displayName}`, fileName: displayName });
        continue;
      }
      const item = await extractAttachmentText({
        dataDir: input.dataDir,
        attachment,
        maxUploadBytes: maxTextBytes,
        maxExtractedChars: Math.min(maxExtractedChars, remainingChars)
      });
      totalExtractedChars += item.extractedChars;
      extracted.push(item);
      sourceFiles.push(sourceFile(attachment, "text", { included_in_text: true }));
      if (item.truncated) warnings.push({ code: "text_file_truncated", message: `Attached file ${displayName} was truncated to ${item.extractedChars} characters.`, fileName: displayName });
      continue;
    }
    if (isImageAttachment(attachment.fileName, mimeType)) {
      imageAttachments.push(attachment);
      continue;
    }
    sourceFiles.push(sourceFile(attachment, "unsupported", { skipped: true, reason: "unsupported_file_type" }));
    warnings.push({ code: "unsupported_file_type", message: `Unsupported file skipped: ${displayName}`, fileName: displayName });
  }

  const forwardable = buildLlmAttachmentInputs({
    attachments: imageAttachments,
    dashboardInternalBaseUrl: input.dashboardInternalBaseUrl,
    maxLlmAttachmentBytes: input.maxLlmAttachmentBytes
  });
  for (const attachment of imageAttachments) {
    const forwarded = forwardable.attachments.find((item) => item.id === attachment.id);
    if (forwarded) {
      sourceFiles.push(sourceFile(attachment, "image", { included_as_attachment: true, attachment_id: attachment.id }));
    } else {
      sourceFiles.push(sourceFile(attachment, "unsupported", { skipped: true, reason: "image_attachment_not_forwarded" }));
    }
  }
  warnings.push(...forwardable.warnings.map((message) => ({ code: "attachment_not_forwarded", message })));

  return {
    text: buildLlmPromptWithAttachments(input.userText, extracted),
    attachments: forwardable.attachments,
    sourceFiles,
    warnings,
    extracted
  };
}

export async function streamAttachment(input: {
  dataDir: string;
  attachment: AttachmentMetadata;
  res: Response;
}): Promise<void> {
  const absolutePath = safeAttachmentPath(input.dataDir, input.attachment.storagePath);
  input.res.setHeader("Content-Type", input.attachment.mimeType ?? "application/octet-stream");
  const downloadFileName = input.attachment.storedFileName ?? path.basename(input.attachment.storagePath) ?? input.attachment.fileName;
  input.res.setHeader("Content-Disposition", `inline; filename="${downloadFileName.replace(/"/g, "")}"`);
  createReadStream(absolutePath).pipe(input.res);
}

export async function deleteStoredAttachments(dataDir: string, attachments: AttachmentMetadata[]): Promise<void> {
  const dataRoot = path.resolve(dataDir);
  await Promise.all(
    attachments.map(async (attachment) => {
      const absolutePath = path.resolve(dataRoot, attachment.storagePath);
      const relative = path.relative(dataRoot, absolutePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return;
      await fs.rm(absolutePath, { force: true });
    })
  );
}

function mimeFromExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".txt") return "text/plain";
  if (ext === ".md") return "text/markdown";
  if (ext === ".markdown") return "text/markdown";
  if (ext === ".json") return "application/json";
  if (ext === ".csv") return "text/csv";
  if (ext === ".tsv") return "text/tab-separated-values";
  if ([".log", ".ini", ".cfg", ".conf", ".env", ".gitignore"].includes(ext)) return "text/plain";
  if (ext === ".yml" || ext === ".yaml") return "application/yaml";
  if (ext === ".xml") return "application/xml";
  if (ext === ".toml") return "application/toml";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".jpg") return "image/jpeg";
  if (ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".doc") return "application/msword";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".ppt") return "application/vnd.ms-powerpoint";
  if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (ext === ".odt") return "application/vnd.oasis.opendocument.text";
  if (ext === ".rtf") return "application/rtf";
  return "application/octet-stream";
}

function normalizeAttachmentText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/[ \t\n]+$/g, "");
}

function sanitizeDelimiterFileName(fileName: string): string {
  return sanitizeFileName(fileName.replace(/[\r\n\t\0]/g, "_")).replace(/ATTACHED_TEXT_FILE/gi, "attached_text_file");
}

function normalizedExtension(fileName: string): string {
  const base = path.basename(fileName).toLowerCase();
  if (base === ".gitignore") return ".gitignore";
  if (base === ".env") return ".env";
  return path.extname(fileName).toLowerCase();
}

function isSensitiveTextAttachment(fileName: string): boolean {
  return sensitiveTextExtensions.has(normalizedExtension(fileName));
}

function isSupportedTextMimeType(mimeType?: string): boolean {
  const mime = mimeType?.toLowerCase();
  if (!mime) return false;
  return (
    mime.startsWith("text/") ||
    ["application/json", "application/x-yaml", "application/yaml", "application/xml", "application/toml", "application/x-www-form-urlencoded"].includes(mime)
  );
}

function sourceFile(attachment: AttachmentMetadata, kind: SourceFileInfo["kind"], extra: Partial<SourceFileInfo> = {}): SourceFileInfo {
  return {
    fileName: attachment.originalFileName ?? attachment.fileName,
    kind,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...extra
  };
}

function safeAttachmentPath(dataDir: string, storagePath: string): string {
  const dataRoot = path.resolve(dataDir);
  const absolutePath = path.resolve(dataRoot, storagePath);
  const relative = path.relative(path.join(dataRoot, "attachments"), absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid attachment path.");
  return absolutePath;
}
