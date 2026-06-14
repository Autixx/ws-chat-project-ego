import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { getAutheliaUser, type AuthenticatedUser } from "../auth/authelia.js";
import type { AppConfig } from "../config.js";
import { parseApplyExpression } from "../drafts/applyParser.js";
import { DraftStore } from "../drafts/draftStore.js";
import { UnclarifiedStore } from "../drafts/unclarifiedStore.js";
import { PlaneClient } from "../integrations/planeClient.js";
import { CodexProvider } from "../llm/codexProvider.js";
import { MockProvider } from "../llm/mockProvider.js";
import type { LlmProvider, LlmTaskMode } from "../llm/provider.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { parseClientMessage } from "./protocol.js";

const MAX_TEXT_LENGTH = 256_000;

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function providerFromConfig(config: AppConfig): LlmProvider {
  return config.llmProvider === "codex" ? new CodexProvider(config) : new MockProvider();
}

export function attachWebSocketServer(server: Server, config: AppConfig): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  const drafts = new DraftStore(config.dataDir);
  const unclarified = new UnclarifiedStore(config.dataDir);
  const plane = new PlaneClient(config);
  const provider = providerFromConfig(config);

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const user = getAutheliaUser(req, {
      devAuthBypass: config.devAuthBypass,
      trustAutheliaHeaders: config.trustAutheliaHeaders
    });
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, user);
    });
  });

  function handleConnection(ws: WebSocket, user: AuthenticatedUser): void {
    send(ws, { type: "connected", user: { username: user.username, email: user.email } });

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

  async function handleClientMessage(ws: WebSocket, message: ClientMessage, user: AuthenticatedUser): Promise<void> {
    if (message.type === "digest" || message.type === "tasks") {
      if (message.text.length > MAX_TEXT_LENGTH) throw new Error("Message text is too large.");
      const mode: LlmTaskMode = message.type === "tasks" ? "create_tasks" : "structured_breakdown";
      const source = message.fileName ? "uploaded_file" : "browser_text";
      send(ws, { type: "status", jobId: "pending", message: "Starting LLM provider task." });

      for await (const event of provider.runProjectEgoTask({ mode, text: message.text, source, fileName: message.fileName, user })) {
        if (event.type === "status") send(ws, { type: "status", jobId: "pending", message: event.message });
        if (event.type === "token") send(ws, { type: "token", jobId: "pending", text: event.text });
        if (event.type === "error") send(ws, { type: "error", message: event.message });
        if (event.type === "result") {
          const saved = await drafts.saveDraft({ mode, source, fileName: message.fileName, user, result: event.result });
          send(ws, { type: "draft_saved", jobId: saved.draft.jobId, itemsCount: saved.draft.result.items.length, preview: saved.preview });
          send(ws, { type: "draft_result", jobId: saved.draft.jobId, result: saved.draft.result });
        }
      }
      return;
    }

    if (message.type === "apply") {
      const draft = await drafts.loadDraft(message.jobId, user);
      const selection = parseApplyExpression(message.expression, draft.result.items.length);
      const applyItems = drafts.selectItems(draft, selection.apply);
      const keepItems = drafts.selectItems(draft, selection.keep);
      const planeResult = await plane.createWorkItems(applyItems);
      await unclarified.storeUnclarifiedItems(keepItems, user);
      send(ws, {
        type: "apply_result",
        jobId: draft.jobId,
        appliedCount: planeResult.createdCount,
        keptCount: keepItems.length,
        droppedCount: selection.drop.length,
        message: planeResult.message
      });
      return;
    }

    if (message.type === "discard") {
      const discardedJobId = await drafts.discardDraft(message.jobId, user);
      send(ws, { type: "status", jobId: discardedJobId, message: "Draft discarded." });
      return;
    }

    if (message.type === "show_unclarified") {
      send(ws, { type: "unclarified_index", text: await unclarified.renderUnclarifiedIndex() });
      return;
    }

    if (message.type === "clarify") {
      const item = await unclarified.loadUnclarifiedItem(message.unclarifiedId);
      item.item.needs_clarification = [];
      item.item.details = `${item.item.details}\n\nClarification: ${message.text}`;
      await unclarified.removeUnclarifiedItem(message.unclarifiedId);
      send(ws, { type: "status", jobId: message.unclarifiedId, message: "Clarification recorded and item removed from unclarified storage." });
    }
  }
}
