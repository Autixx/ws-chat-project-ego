import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { AuthenticatedUser } from "../auth/authelia.js";
import { requireUserForRequest } from "../auth/requireUser.js";
import {
  buildLlmPromptWithAttachments,
  buildLlmAttachmentInputs,
  deleteStoredAttachments,
  extractTextAttachments,
  finalizeStagedUploads,
  firstExtractedFileName
} from "../attachments/attachmentService.js";
import type { Conversation } from "../conversations/types.js";
import type { AppConfig } from "../config.js";
import { ConversationStore } from "../conversations/conversationStore.js";
import { MessageStore } from "../conversations/messageStore.js";
import { generateConversationTitle } from "../conversations/titleGenerator.js";
import { openDatabase } from "../db/database.js";
import { parseApplyExpression } from "../drafts/applyParser.js";
import { DraftStore } from "../drafts/draftStore.js";
import { UnclarifiedStore } from "../drafts/unclarifiedStore.js";
import { draftItemId, mapDraftItemForN8n, type N8nApplyPayload } from "../integrations/n8nApplyClient.js";
import { dispatchApplyJobToN8n } from "../jobs/n8nApply.js";
import { JobStore, type Job, type JobEvent } from "../jobs/jobStore.js";
import { updateResponseDecision } from "../jobs/responseDecision.js";
import { CodexProvider } from "../llm/codexProvider.js";
import { MockProvider } from "../llm/mockProvider.js";
import type { LlmAttachmentInput, LlmProvider, LlmTaskMode } from "../llm/provider.js";
import { ComponentStatusMonitor } from "../status/componentStatus.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { openReferencedDraft } from "./draftOpen.js";
import { parseClientMessage } from "./protocol.js";

const MAX_TEXT_LENGTH = 256_000;

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function providerFromConfig(config: AppConfig): LlmProvider {
  return config.llmProvider === "codex" ? new CodexProvider(config) : new MockProvider();
}

function taskModeFromUiMode(mode: "digest" | "tasks" | "abstract_idea"): LlmTaskMode {
  if (mode === "tasks") return "create_tasks";
  if (mode === "abstract_idea") return "abstract_idea";
  return "structured_breakdown";
}

export function attachWebSocketServer(
  server: Server,
  config: AppConfig,
  database = openDatabase(config),
  componentStatus = new ComponentStatusMonitor(config)
): { notifyJobUpdated: (job: Job, event?: JobEvent) => Promise<void> } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  const clients = new Set<{ ws: WebSocket; user: AuthenticatedUser }>();
  const conversations = new ConversationStore(database);
  const messages = new MessageStore(database);
  const jobs = new JobStore(database);
  const drafts = new DraftStore(config.dataDir);
  const unclarified = new UnclarifiedStore(config.dataDir);
  const provider = providerFromConfig(config);

  componentStatus.start(() => broadcastAppStatus());

  server.on("upgrade", async (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    let user: AuthenticatedUser;
    try {
      user = await requireUserForRequest(req, config, database);
    } catch (error) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, user);
    });
  });

  function handleConnection(ws: WebSocket, user: AuthenticatedUser): void {
    clients.add({ ws, user });
    ws.on("close", () => {
      for (const client of clients) {
        if (client.ws === ws) clients.delete(client);
      }
    });
    send(ws, { type: "connected", user: { username: user.username, email: user.email } });
    send(ws, { type: "app_status", ...componentStatus.snapshot(database).components });

    ws.on("message", async (data, isBinary) => {
      if (isBinary) {
        send(ws, { type: "error", message: "Binary WebSocket messages are not supported." });
        return;
      }

      try {
        const parsed = parseClientMessage(JSON.parse(data.toString())) as ClientMessage;
        await handleClientMessage(ws, parsed, user);
      } catch (error) {
        send(ws, {
          type: "error",
          message: "Invalid request.",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  async function emitMessage(ws: WebSocket, message: Awaited<ReturnType<MessageStore["appendToolMessage"]>>): Promise<void> {
    send(ws, { type: "message_created", message });
  }

  async function createAndEmitConversation(ws: WebSocket, user: AuthenticatedUser, title?: string): Promise<Conversation> {
    const conversation = await conversations.createConversation(user, title);
    send(ws, { type: "conversation_created", conversation });
    send(ws, { type: "conversation_list", conversations: await conversations.listConversations(user) });
    return conversation;
  }

  async function ensureConversation(ws: WebSocket, user: AuthenticatedUser, conversationId: string | undefined, titleSeed: string): Promise<Conversation> {
    if (conversationId) return conversations.loadConversation(user, conversationId);
    return createAndEmitConversation(ws, user, generateConversationTitle(titleSeed));
  }

  async function handleClientMessage(ws: WebSocket, message: ClientMessage, user: AuthenticatedUser): Promise<void> {
    if (message.type === "conversation_create") {
      await createAndEmitConversation(ws, user, message.title);
      return;
    }

    if (message.type === "conversation_list") {
      send(ws, { type: "conversation_list", conversations: await conversations.listConversations(user, message.includeArchived), includeArchived: message.includeArchived });
      return;
    }

    if (message.type === "conversation_open") {
      const conversation = await conversations.loadConversation(user, message.conversationId);
      const history = await messages.loadMessages(user, conversation.id);
      const attachments = await conversations.listAttachments(user, conversation.id);
      const conversationJobs = await jobs.listJobsForConversation(user, conversation.id);
      send(ws, { type: "conversation_opened", conversation, messages: history, attachments, jobs: conversationJobs });
      return;
    }

    if (message.type === "conversation_rename") {
      const conversation = await conversations.renameConversation(user, message.conversationId, message.title);
      send(ws, { type: "conversation_renamed", conversation });
      send(ws, { type: "conversation_list", conversations: await conversations.listConversations(user, true), includeArchived: true });
      return;
    }

    if (message.type === "conversation_archive") {
      await conversations.archiveConversation(user, message.conversationId);
      send(ws, { type: "conversation_archived", conversationId: message.conversationId });
      send(ws, { type: "conversation_list", conversations: await conversations.listConversations(user, true), includeArchived: true });
      return;
    }

    if (message.type === "conversation_unarchive") {
      const conversation = await conversations.unarchiveConversation(user, message.conversationId);
      send(ws, { type: "conversation_unarchived", conversation });
      send(ws, { type: "conversation_list", conversations: await conversations.listConversations(user, true), includeArchived: true });
      return;
    }

    if (message.type === "conversation_delete") {
      const attachments = await conversations.deleteConversation(user, message.conversationId);
      await deleteStoredAttachments(config.dataDir, attachments);
      send(ws, { type: "conversation_deleted", conversationId: message.conversationId });
      send(ws, { type: "conversation_list", conversations: await conversations.listConversations(user, true), includeArchived: true });
      return;
    }

    if (message.type === "message_send" || message.type === "digest" || message.type === "tasks") {
      const mode = message.type === "message_send" ? message.mode : message.type;
      await handleConversationMessage(ws, user, {
        conversationId: message.conversationId,
        mode,
        text: message.text,
        fileName: message.fileName,
        fileSize: "fileSize" in message ? message.fileSize : undefined,
        mimeType: "mimeType" in message ? message.mimeType : undefined,
        attachmentUploadIds: "attachmentUploadIds" in message ? message.attachmentUploadIds : undefined
      });
      return;
    }

    if (message.type === "draft_open") {
      const payloads = await openReferencedDraft({ conversations, drafts, user, conversationId: message.conversationId, jobId: message.jobId });
      send(ws, payloads.saved);
      send(ws, payloads.result);
      return;
    }

    if (message.type === "attachments_for_request") {
      const attachments = await conversations.listAttachments(user, message.conversationId, message.requestId);
      send(ws, { type: "attachments_for_request", conversationId: message.conversationId, requestId: message.requestId, attachments });
      return;
    }

    if (message.type === "job_list") {
      await conversations.loadConversation(user, message.conversationId);
      send(ws, { type: "job_list", conversationId: message.conversationId, jobs: await jobs.listJobsForConversation(user, message.conversationId) });
      return;
    }

    if (message.type === "response_decision_update") {
      const result = await updateResponseDecision({
        conversations,
        messages,
        jobs,
        user,
        conversationId: message.conversationId,
        messageId: message.messageId,
        decisionStatus: message.decisionStatus
      });
      send(ws, { type: "response_decision_updated", conversationId: message.conversationId, message: result.message });
      if (result.job) send(ws, { type: "job_created", job: result.job });
      if (result.job && result.event) send(ws, { type: "job_event", jobId: result.job.id, event: result.event });
      return;
    }

    if (message.type === "apply") {
      await conversations.loadConversation(user, message.conversationId);
      const draft = await drafts.loadDraft(message.jobId, user);
      const draftRef = await conversations.loadDraftRef(user, message.conversationId, draft.jobId);
      const draftMessage = draftRef.messageId ? await messages.loadMessage(user, message.conversationId, draftRef.messageId) : undefined;
      const requestMessageId = typeof draftMessage?.metadata?.responseToRequestId === "string" ? draftMessage.metadata.responseToRequestId : undefined;
      const selection = parseApplyExpression(message.expression, draft.result.items.length);
      const applyEntries = selection.apply
        .map((itemNumber) => ({ itemNumber, item: draft.result.items[itemNumber - 1] }))
        .filter((entry): entry is { itemNumber: number; item: (typeof draft.result.items)[number] } => Boolean(entry.item));
      const keepItems = drafts.selectItems(draft, selection.keep);
      await unclarified.storeUnclarifiedItems(keepItems, user);

      if (applyEntries.length === 0) {
        const content = `Apply result for ${draft.jobId}: queued=0, kept=${keepItems.length}, dropped=${selection.drop.length}. No selected draft items were sent to n8n.`;
        const toolMessage = await messages.appendToolMessage(message.conversationId, user, content, {
          kind: "apply_result",
          jobId: draft.jobId,
          decisionStatus: "kept",
          selection,
          requestedApplyCount: 0
        });
        await conversations.touchConversation(user, message.conversationId);
        await emitMessage(ws, toolMessage);
        send(ws, {
          type: "apply_result",
          conversationId: message.conversationId,
          jobId: draft.jobId,
          appliedCount: 0,
          keptCount: keepItems.length,
          droppedCount: selection.drop.length,
          message: "No selected draft items were sent to n8n."
        });
        return;
      }

      const selectedDraftItemIds = applyEntries.map((entry) => draftItemId(draft.jobId, entry.itemNumber));
      const job = await jobs.createJob({
        conversationId: message.conversationId,
        requestMessageId,
        responseMessageId: draftRef.messageId,
        draftJobId: draft.jobId,
        status: "queued",
        source: "n8n_apply",
        metadata: {
          backend: "n8n",
          selectedDraftItemIds,
          selection,
          source: {
            provider: "codex",
            codexAgentJobId: draft.jobId,
            mode: draft.mode
          },
          backendConfigured: Boolean(config.n8nApplyWebhookUrl && config.n8nWebhookToken)
        }
      });
      const createdEvent = await jobs.appendJobEvent(job.id, "created", {
        message: "n8n apply job created.",
        selectedDraftItemIds
      });
      send(ws, { type: "job_created", job });
      send(ws, { type: "job_event", jobId: job.id, event: createdEvent });

      const payload: N8nApplyPayload = {
        jobId: job.id,
        conversationId: message.conversationId,
        requestMessageId,
        responseMessageId: draftRef.messageId,
        source: {
          provider: "codex",
          codexAgentJobId: draft.jobId,
          mode: draft.mode
        },
        items: applyEntries.map((entry) => mapDraftItemForN8n(draft.jobId, entry.itemNumber, entry.item))
      };
      const dispatch = await dispatchApplyJobToN8n({ config, jobs, jobId: job.id, payload });
      send(ws, { type: "job_updated", job: dispatch.job });
      send(ws, { type: "job_event", jobId: dispatch.job.id, event: dispatch.event });

      const queuedText = dispatch.result.accepted ? `queued=${applyEntries.length}` : `failed=${applyEntries.length}`;
      const content = `Apply result for ${draft.jobId}: ${queuedText}, kept=${keepItems.length}, dropped=${selection.drop.length}, job=${job.id}. Dashboard does not write Plane directly; n8n workflow execution is tracked separately.`;
      const toolMessage = await messages.appendToolMessage(message.conversationId, user, content, {
        kind: "apply_result",
        jobId: draft.jobId,
        decisionStatus: "applied",
        selection,
        requestedApplyCount: applyEntries.length,
        executionJobId: job.id,
        executionStatus: dispatch.job.status
      });
      await conversations.touchConversation(user, message.conversationId);
      await emitMessage(ws, toolMessage);
      send(ws, {
        type: "apply_result",
        conversationId: message.conversationId,
        jobId: draft.jobId,
        appliedCount: dispatch.result.accepted ? applyEntries.length : 0,
        keptCount: keepItems.length,
        droppedCount: selection.drop.length,
        message: dispatch.result.accepted
          ? `n8n apply job ${job.id} accepted.`
          : `n8n apply job ${job.id} failed: ${dispatch.result.error}`
      });
      return;
    }

    if (message.type === "discard") {
      await conversations.loadConversation(user, message.conversationId);
      const discardedJobId = await drafts.discardDraft(message.jobId, user);
      const toolMessage = await messages.appendToolMessage(message.conversationId, user, `Draft ${discardedJobId} discarded.`, {
        kind: "status",
        jobId: discardedJobId
      });
      await conversations.touchConversation(user, message.conversationId);
      await emitMessage(ws, toolMessage);
      send(ws, { type: "status", conversationId: message.conversationId, jobId: discardedJobId, message: "Draft discarded." });
      return;
    }

    if (message.type === "show_unclarified") {
      const text = await unclarified.renderUnclarifiedIndex();
      if (message.conversationId) {
        await conversations.loadConversation(user, message.conversationId);
        const toolMessage = await messages.appendToolMessage(message.conversationId, user, text, { kind: "unclarified_index" });
        await conversations.touchConversation(user, message.conversationId);
        await emitMessage(ws, toolMessage);
      }
      send(ws, { type: "unclarified_index", conversationId: message.conversationId, text });
      return;
    }

    if (message.type === "clarify") {
      await conversations.loadConversation(user, message.conversationId);
      const item = await unclarified.loadUnclarifiedItem(message.unclarifiedId);
      const userMessage = await messages.appendUserMessage(message.conversationId, user, `Clarification for ${message.unclarifiedId}: ${message.text}`, {
        mode: "clarify",
        unclarifiedId: message.unclarifiedId
      });
      await emitMessage(ws, userMessage);
      const toolMessage = await messages.appendToolMessage(
        message.conversationId,
        user,
        `Clarification recorded for ${message.unclarifiedId}. The unclarified item is preserved for review; apply or drop it explicitly when ready.`,
        {
          kind: "status",
          unclarifiedId: message.unclarifiedId,
          itemTitle: item.item.title,
          todo: "Future pass should run LLM clarification and create a new review draft item."
        }
      );
      await conversations.touchConversation(user, message.conversationId);
      await emitMessage(ws, toolMessage);
      send(ws, { type: "status", conversationId: message.conversationId, jobId: message.unclarifiedId, message: "Clarification recorded; unclarified item preserved." });
    }
  }

  async function notifyJobUpdated(job: Job, event?: JobEvent): Promise<void> {
    await Promise.all(
      Array.from(clients).map(async (client) => {
        try {
          await conversations.loadConversation(client.user, job.conversationId);
          send(client.ws, { type: "job_updated", job });
          if (event) send(client.ws, { type: "job_event", jobId: job.id, event });
        } catch {
          // Not this user's conversation.
        }
      })
    );
  }

  function broadcastAppStatus(): void {
    const status = componentStatus.snapshot(database).components;
    for (const client of clients) send(client.ws, { type: "app_status", ...status });
  }

  async function handleConversationMessage(
    ws: WebSocket,
    user: AuthenticatedUser,
    input: {
      conversationId?: string;
      mode: "chat" | "digest" | "tasks" | "abstract_idea";
      text: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
      attachmentUploadIds?: string[];
    }
  ): Promise<void> {
    if (input.text.length > MAX_TEXT_LENGTH) throw new Error("Message text is too large.");
    const conversation = await ensureConversation(ws, user, input.conversationId, input.text);
    let userMessage = await messages.appendUserMessage(conversation.id, user, input.text, {
      mode: input.mode,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType
    });
    let finalizedAttachments: Awaited<ReturnType<typeof finalizeStagedUploads>> = [];
    let extraction: Awaited<ReturnType<typeof extractTextAttachments>> = { extracted: [], warnings: [] };
    let llmAttachments: LlmAttachmentInput[] = [];
    let attachmentWarnings: string[] = [];
    if (input.attachmentUploadIds?.length) {
      finalizedAttachments = await finalizeStagedUploads({
        dataDir: config.dataDir,
        conversations,
        user,
        conversationId: conversation.id,
        requestMessageId: userMessage.id,
        uploadIds: input.attachmentUploadIds
      });
      send(ws, { type: "attachments_for_request", conversationId: conversation.id, requestId: userMessage.id, attachments: finalizedAttachments });
      userMessage = await messages.updateMessageMetadata(user, conversation.id, userMessage.id, {
        fileName: finalizedAttachments[0]?.originalFileName ?? finalizedAttachments[0]?.fileName,
        uploadedFileNames: finalizedAttachments.map((attachment) => attachment.originalFileName ?? attachment.fileName),
        storedFileNames: finalizedAttachments.map((attachment) => attachment.storedFileName ?? attachment.fileName),
        uploadedFileCount: finalizedAttachments.length
      });
      extraction = await extractTextAttachments({
        dataDir: config.dataDir,
        attachments: finalizedAttachments,
        maxUploadBytes: config.maxUploadBytes,
        maxExtractedChars: config.maxExtractedChars
      });
      if (extraction.extracted.length) {
        userMessage = await messages.updateMessageMetadata(user, conversation.id, userMessage.id, {
          extractedAttachments: extraction.extracted.map((item) => ({
            originalFileName: item.attachment.originalFileName ?? item.fileName,
            storedFileName: item.attachment.storedFileName,
            savedPath: item.attachment.storagePath,
            sizeBytes: item.attachment.sizeBytes,
            extension: item.extension,
            extractedChars: item.extractedChars,
            truncated: item.truncated
          }))
        });
      }
      const forwardable = buildLlmAttachmentInputs({
        attachments: finalizedAttachments,
        dashboardInternalBaseUrl: config.dashboardInternalBaseUrl,
        maxLlmAttachmentBytes: config.maxLlmAttachmentBytes
      });
      llmAttachments = forwardable.attachments;
      attachmentWarnings = forwardable.warnings;
    }
    send(ws, { type: "message_created", message: userMessage });

    if (conversation.title === "New conversation") {
      const renamed = await conversations.renameConversation(user, conversation.id, generateConversationTitle(input.text));
      send(ws, { type: "conversation_renamed", conversation: renamed });
    }

    const assistantMessage = messages.createMessage({
      conversationId: conversation.id,
      user,
      role: "assistant",
      kind: "response",
      content: "",
      metadata: {
        mode: input.mode,
        responseToRequestId: userMessage.id,
        decisionStatus: "pending",
        fileName: userMessage.metadata?.fileName,
        uploadedFileNames: userMessage.metadata?.uploadedFileNames
      }
    });
    await messages.appendMessage(assistantMessage);
    send(ws, { type: "assistant_message_start", conversationId: conversation.id, messageId: assistantMessage.id });

    if (input.mode === "chat") {
      const updatedAssistant = await messages.updateMessageContent(
        assistantMessage,
        "I received your message and saved it in this conversation. General chat is currently a lightweight MVP path; use Digest, Tasks, or Abstract idea to generate ProjectEGO drafts."
      );
      await conversations.touchConversation(user, conversation.id);
      send(ws, { type: "message_created", message: updatedAssistant });
      send(ws, { type: "assistant_message_done", conversationId: conversation.id, messageId: assistantMessage.id });
      return;
    }

    for (const warning of [...extraction.warnings, ...attachmentWarnings]) {
      const statusMessage = await messages.appendToolMessage(conversation.id, user, warning, {
        kind: "status",
        mode: input.mode,
        responseToRequestId: userMessage.id
      });
      await emitMessage(ws, statusMessage);
      send(ws, { type: "status", conversationId: conversation.id, messageId: assistantMessage.id, jobId: "pending", message: warning });
    }
    const llmText = buildLlmPromptWithAttachments(input.text, extraction.extracted);
    const llmFileName = input.fileName ?? firstExtractedFileName(extraction.extracted);
    if (!llmText.trim() && !llmAttachments.length) throw new Error("At least one text prompt, supported text-like attachment, or image attachment is required.");
    if (llmText.length > MAX_TEXT_LENGTH) throw new Error("Combined message text is too large.");

    const taskMode = taskModeFromUiMode(input.mode);
    const source = llmFileName ? "dashboard-upload" : "browser_text";
    let assistantContent = "";

    for await (const event of provider.runProjectEgoTask({ mode: taskMode, text: llmText, source, fileName: llmFileName, attachments: llmAttachments, user })) {
      if (event.type === "status") {
        const statusMessage = await messages.appendToolMessage(conversation.id, user, event.message, {
          kind: "status",
          mode: input.mode,
          responseToRequestId: userMessage.id
        });
        await emitMessage(ws, statusMessage);
        send(ws, { type: "status", conversationId: conversation.id, messageId: assistantMessage.id, jobId: "pending", message: event.message });
      }

      if (event.type === "token") {
        assistantContent += event.text;
        send(ws, { type: "token", conversationId: conversation.id, messageId: assistantMessage.id, jobId: "pending", text: event.text });
      }

      if (event.type === "error") {
        const errorMessage = await messages.appendToolMessage(conversation.id, user, event.message, {
          kind: "error",
          mode: input.mode,
          responseToRequestId: userMessage.id
        });
        await emitMessage(ws, errorMessage);
        send(ws, { type: "error", message: event.message });
      }

      if (event.type === "result") {
        const saved = await drafts.saveDraft({ mode: taskMode, source, fileName: llmFileName, user, result: event.result });
        assistantContent += `\n\nI created draft ${saved.draft.jobId} with ${saved.draft.result.items.length} item(s).`;
        const draftMessage = await messages.appendToolMessage(conversation.id, user, `Draft ${saved.draft.jobId}: ${saved.draft.result.items.length} item(s).`, {
          kind: "draft",
          jobId: saved.draft.jobId,
          itemsCount: saved.draft.result.items.length,
          mode: input.mode,
          responseToRequestId: userMessage.id,
          decisionStatus: "pending"
        });
        await conversations.insertDraftRef(user, {
          conversationId: conversation.id,
          jobId: saved.draft.jobId,
          messageId: draftMessage.id,
          mode: input.mode,
          source,
          fileName: llmFileName,
          itemsCount: saved.draft.result.items.length
        });
        await emitMessage(ws, draftMessage);
      }
    }

    const updatedAssistant = await messages.updateMessageContent(assistantMessage, assistantContent.trim() || "Done.");
    await conversations.touchConversation(user, conversation.id);
    send(ws, { type: "message_created", message: updatedAssistant });
    send(ws, { type: "assistant_message_done", conversationId: conversation.id, messageId: assistantMessage.id });
  }
  return { notifyJobUpdated };
}
