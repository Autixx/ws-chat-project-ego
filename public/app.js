const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const state = {
  ws: null,
  shouldReconnect: true,
  connected: false,
  conversations: [],
  currentConversationId: null,
  messages: [],
  selectedRequestId: null,
  selectedResponseId: null,
  expandedRequestId: null,
  expandedResponseId: null,
  currentDraft: null,
  currentDraftItems: [],
  attachments: [],
  attachmentsByRequest: {}
};

const els = {
  wsSquare: document.getElementById("wsSquare"),
  wsText: document.getElementById("wsText"),
  planeSquare: document.getElementById("planeSquare"),
  planeText: document.getElementById("planeText"),
  n8nSquare: document.getElementById("n8nSquare"),
  n8nText: document.getElementById("n8nText"),
  dbSquare: document.getElementById("dbSquare"),
  dbText: document.getElementById("dbText"),
  userLine: document.getElementById("userLine"),
  conversationTitle: document.getElementById("conversationTitle"),
  conversationSelect: document.getElementById("conversationSelect"),
  newConversationBtn: document.getElementById("newConversationBtn"),
  archiveConversationBtn: document.getElementById("archiveConversationBtn"),
  themeSelect: document.getElementById("themeSelect"),
  displayMode: document.getElementById("displayMode"),
  requestSearch: document.getElementById("requestSearch"),
  responseSearch: document.getElementById("responseSearch"),
  requestList: document.getElementById("requestList"),
  responseList: document.getElementById("responseList"),
  attachmentsList: document.getElementById("attachmentsList"),
  prompt: document.getElementById("prompt"),
  modeSelect: document.getElementById("modeSelect"),
  fileInput: document.getElementById("fileInput"),
  fileNotice: document.getElementById("fileNotice"),
  sendBtn: document.getElementById("sendBtn"),
  draftJobId: document.getElementById("draftJobId"),
  draftPreview: document.getElementById("draftPreview"),
  itemsList: document.getElementById("itemsList"),
  applySelectedBtn: document.getElementById("applySelectedBtn"),
  applyAllBtn: document.getElementById("applyAllBtn"),
  keepAllBtn: document.getElementById("keepAllBtn"),
  showUnclarifiedBtn: document.getElementById("showUnclarifiedBtn"),
  unclarifiedPanel: document.getElementById("unclarifiedPanel"),
  debugOutput: document.getElementById("debugOutput")
};
const authEls = {
  authScreen: document.getElementById("authScreen"),
  workbench: document.getElementById("workbench"),
  authMessage: document.getElementById("authMessage"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  toggleAuthMode: document.getElementById("toggleAuthMode"),
  loginName: document.getElementById("loginName"),
  loginPassword: document.getElementById("loginPassword"),
  registerUsername: document.getElementById("registerUsername"),
  registerEmail: document.getElementById("registerEmail"),
  registerDisplayName: document.getElementById("registerDisplayName"),
  registerPassword: document.getElementById("registerPassword"),
  registerInviteCode: document.getElementById("registerInviteCode"),
  logoutBtn: document.getElementById("logoutBtn")
};

function log(message) {
  els.debugOutput.textContent += `${JSON.stringify(message, null, 2)}\n\n`;
  els.debugOutput.scrollTop = els.debugOutput.scrollHeight;
}

function send(message) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message));
}

function setConnected(value) {
  state.connected = value;
  els.wsSquare.className = `sq ${value ? "green" : "red"}`;
  els.wsText.textContent = value ? "connected" : "disconnected";
  for (const button of [els.newConversationBtn, els.archiveConversationBtn, els.sendBtn, els.applySelectedBtn, els.applyAllBtn, els.keepAllBtn, els.showUnclarifiedBtn]) {
    button.disabled = !value;
  }
}

function connect() {
  if (!state.shouldReconnect) return;
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.ws = ws;
  ws.addEventListener("open", () => {
    setConnected(true);
    send({ type: "conversation_list" });
  });
  ws.addEventListener("close", () => {
    setConnected(false);
    state.ws = null;
    if (state.shouldReconnect) setTimeout(connect, 1500);
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    log(message);
    handleServerMessage(message);
  });
}

async function bootAuth() {
  const response = await fetch("/api/auth/me");
  if (response.ok) {
    const body = await response.json();
    showWorkbench(body.user);
    connect();
    return;
  }
  showAuth();
}

function showWorkbench(user) {
  if (!user?.username) {
    showAuth("Login response did not include user data.");
    return;
  }
  authEls.authScreen.hidden = true;
  authEls.workbench.hidden = false;
  els.userLine.textContent = `${user.username}${user.email ? ` / ${user.email}` : ""}`;
}

function showAuth(message = "") {
  authEls.workbench.hidden = true;
  authEls.authScreen.hidden = false;
  authEls.authMessage.textContent = message;
}

function handleServerMessage(message) {
  if (message.type === "connected") {
    els.userLine.textContent = `${message.user.username}${message.user.email ? ` / ${message.user.email}` : ""}`;
  }

  if (message.type === "app_status") {
    setStatusIndicator(els.dbSquare, els.dbText, message.db.status, message.db.path || message.db.message || message.db.status);
    setStatusIndicator(els.planeSquare, els.planeText, message.plane.status === "configured" ? "ok" : message.plane.status === "error" ? "error" : "unknown", message.plane.message || message.plane.status);
    setStatusIndicator(els.n8nSquare, els.n8nText, message.n8n.status === "configured" ? "ok" : "error", message.n8n.status);
  }

  if (message.type === "conversation_list") {
    state.conversations = message.conversations;
    renderConversationSelect();
    if (!state.currentConversationId) {
      if (state.conversations.length) openConversation(state.conversations[0].id);
      else send({ type: "conversation_create", title: "ProjectEGO Workbench" });
    }
  }

  if (message.type === "conversation_created") {
    upsertConversation(message.conversation);
    openConversation(message.conversation.id);
  }

  if (message.type === "conversation_opened") {
    state.currentConversationId = message.conversation.id;
    upsertConversation(message.conversation);
    state.messages = message.messages;
    state.attachments = message.attachments || [];
    state.attachmentsByRequest = groupAttachmentsByRequest(state.attachments);
    state.selectedRequestId = firstRequest()?.id || null;
    state.expandedRequestId = state.selectedRequestId;
    state.selectedResponseId = null;
    state.expandedResponseId = null;
    renderAll();
  }

  if (message.type === "conversation_renamed") {
    upsertConversation(message.conversation);
    renderConversationSelect();
    renderHeader();
  }

  if (message.type === "conversation_archived") {
    state.conversations = state.conversations.filter((item) => item.id !== message.conversationId);
    state.currentConversationId = null;
    state.messages = [];
    renderAll();
    send({ type: "conversation_list" });
  }

  if (message.type === "message_created") {
    if (message.message.conversationId !== state.currentConversationId) return;
    upsertMessage(message.message);
    if (message.message.kind === "request") {
      state.selectedRequestId = message.message.id;
      state.expandedRequestId = message.message.id;
    }
    if (isResponse(message.message) && message.message.metadata?.responseToRequestId) {
      state.selectedRequestId = message.message.metadata.responseToRequestId;
    }
    renderAll();
  }

  if (message.type === "assistant_message_start" && message.conversationId === state.currentConversationId) {
    upsertMessage({
      id: message.messageId,
      conversationId: message.conversationId,
      role: "assistant",
      kind: "response",
      content: "",
      createdAt: new Date().toISOString(),
      metadata: { decisionStatus: "pending", responseToRequestId: state.selectedRequestId }
    });
    renderAll();
  }

  if (message.type === "token" && message.conversationId === state.currentConversationId) {
    const target = state.messages.find((item) => item.id === message.messageId);
    if (target) {
      target.content += message.text;
      renderResponses();
    }
  }

  if (message.type === "response_decision_updated" && message.conversationId === state.currentConversationId) {
    upsertMessage(message.message);
    renderResponses();
  }

  if (message.type === "attachments_for_request" && message.conversationId === state.currentConversationId) {
    state.attachmentsByRequest[message.requestId] = message.attachments || [];
    renderAttachments();
  }

  if (message.type === "draft_saved" && message.conversationId === state.currentConversationId) {
    state.currentDraft = { jobId: message.jobId, preview: message.preview, result: null };
    renderDraft();
  }

  if (message.type === "draft_result" && message.conversationId === state.currentConversationId) {
    state.currentDraft = { ...(state.currentDraft || {}), jobId: message.jobId, result: message.result };
    state.currentDraftItems = message.result.items || [];
    renderDraft();
  }

  if (message.type === "unclarified_index") {
    els.unclarifiedPanel.textContent = message.text;
  }

  if (message.type === "error") {
    upsertMessage({
      id: `local-error-${Date.now()}`,
      conversationId: state.currentConversationId,
      role: "tool",
      kind: "error",
      content: `${message.message}${message.details ? `: ${message.details}` : ""}`,
      createdAt: new Date().toISOString(),
      metadata: { responseToRequestId: state.selectedRequestId }
    });
    renderAll();
  }
}

function setStatusIndicator(square, text, status, label) {
  square.className = `sq ${status === "ok" ? "green" : status === "error" ? "red" : "gray"}`;
  text.textContent = label;
}

function isResponse(message) {
  return ["response", "status", "token", "draft", "apply_result", "unclarified_index", "error"].includes(message.kind);
}

function requests() {
  return state.messages.filter((message) => message.kind === "request");
}

function responses() {
  return state.messages.filter(isResponse);
}

function firstRequest() {
  return requests()[0];
}

function upsertConversation(conversation) {
  const index = state.conversations.findIndex((item) => item.id === conversation.id);
  if (index >= 0) state.conversations[index] = conversation;
  else state.conversations.unshift(conversation);
  state.conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function upsertMessage(message) {
  const index = state.messages.findIndex((item) => item.id === message.id);
  if (index >= 0) state.messages[index] = message;
  else state.messages.push(message);
  state.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function openConversation(conversationId) {
  send({ type: "conversation_open", conversationId });
}

function renderAll() {
  renderConversationSelect();
  renderHeader();
  renderRequests();
  renderResponses();
  renderAttachments();
  renderDraft();
}

function renderHeader() {
  const conversation = state.conversations.find((item) => item.id === state.currentConversationId);
  els.conversationTitle.textContent = conversation?.title || "PROJECTEGO / CHAT TITLE";
}

function renderConversationSelect() {
  els.conversationSelect.replaceChildren();
  for (const conversation of state.conversations) {
    const option = document.createElement("option");
    option.value = conversation.id;
    option.textContent = conversation.title;
    option.selected = conversation.id === state.currentConversationId;
    els.conversationSelect.append(option);
  }
}

function requestHasResponse(requestId) {
  return responses().some((message) => message.metadata?.responseToRequestId === requestId);
}

function requestAttachments(request) {
  return request ? state.attachmentsByRequest[request.id] || [] : [];
}

function groupAttachmentsByRequest(attachments) {
  return attachments.reduce((groups, attachment) => {
    const requestId = attachment.messageId;
    if (!requestId) return groups;
    groups[requestId] = groups[requestId] || [];
    groups[requestId].push(attachment);
    return groups;
  }, {});
}

function kb(value) {
  return `${(value / 1024).toFixed(1)} KB`;
}

function byteSize(text) {
  return new Blob([text || ""]).size;
}

function shortDate(value) {
  return new Date(value).toLocaleString();
}

function renderRequests() {
  const query = els.requestSearch.value.toLowerCase().trim();
  els.requestList.replaceChildren();
  for (const request of requests().filter((item) => requestMatches(item, query))) {
    const expanded = request.id === state.expandedRequestId;
    const row = document.createElement("article");
    row.className = `rr-row ${expanded ? "expanded" : ""} ${request.id === state.selectedRequestId ? "selected" : ""}`;
    row.addEventListener("click", () => selectRequest(request.id));
    const status = document.createElement("span");
    status.className = `sq ${requestHasResponse(request.id) ? "green" : "red"}`;
    row.append(status);

    if (expanded) {
      const main = document.createElement("div");
      main.className = "row-main";
      appendLine(main, `${shortDate(request.createdAt)} / ${labelMode(request)} / ${kb(byteSize(request.content))}`);
      appendLine(main, `status: ${requestHasResponse(request.id) ? "has_response" : "no_response"}`);
      appendLine(main, requestAttachments(request).length ? `attachments: ${requestAttachments(request).map((a) => a.fileName).join(", ")}` : "attachments: none");
      const body = document.createElement("div");
      body.className = "expanded-body";
      body.textContent = contentForDisplay(request);
      main.append(body);
      row.append(main);
    } else {
      row.append(cell(shortDate(request.createdAt)), cell(labelMode(request)), cell(request.content, "clip"), cell(kb(byteSize(request.content))));
    }
    els.requestList.append(row);
  }
}

function renderResponses() {
  const query = els.responseSearch.value.toLowerCase().trim();
  els.responseList.replaceChildren();
  for (const response of responses().filter((item) => responseMatches(item, query))) {
    const expanded = response.id === state.expandedResponseId;
    const linked = response.metadata?.responseToRequestId === state.selectedRequestId || response.id === state.selectedResponseId;
    const row = document.createElement("article");
    row.className = `rr-row ${expanded ? "expanded" : ""} ${linked ? "linked" : ""}`;
    row.addEventListener("click", () => selectResponse(response.id));
    const status = document.createElement("span");
    status.className = `sq ${decisionClass(response)}`;
    row.append(status);

    if (expanded) {
      const main = document.createElement("div");
      main.className = "row-main";
      appendLine(main, `${shortDate(response.createdAt)} / ${response.kind} / ${projectHint(response)} / ${kb(byteSize(response.content))}`);
      appendLine(main, `decision: ${decisionStatus(response)}`);
      const body = document.createElement("div");
      body.className = "expanded-body";
      body.textContent = contentForDisplay(response);
      main.append(body);
      const actions = document.createElement("div");
      actions.className = "row-actions";
      if (decisionStatus(response) === "pending") {
        for (const [label, value] of [["Apply", "applied"], ["Drop", "dropped"], ["Keep", "kept"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            send({ type: "response_decision_update", conversationId: state.currentConversationId, messageId: response.id, decisionStatus: value });
          });
          actions.append(button);
        }
      }
      if (response.kind === "draft" && response.metadata?.jobId) {
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Open in Draft Inspector";
        open.addEventListener("click", (event) => {
          event.stopPropagation();
          send({ type: "draft_open", conversationId: state.currentConversationId, jobId: response.metadata.jobId });
        });
        actions.append(open);
      }
      main.append(actions);
      row.append(main);
    } else {
      row.append(cell(shortDate(response.createdAt)), cell(response.kind), cell(projectHint(response), "clip"), cell(kb(byteSize(response.content))));
    }
    els.responseList.append(row);
  }
}

function renderAttachments() {
  els.attachmentsList.replaceChildren();
  const attachments = state.attachmentsByRequest[state.selectedRequestId] || [];
  if (!attachments.length) {
    const empty = document.createElement("div");
    empty.className = "attachment-card";
    empty.textContent = "No attachments for selected request.";
    els.attachmentsList.append(empty);
    return;
  }
  for (const attachment of attachments) {
    const card = document.createElement("div");
    card.className = "attachment-card";
    const icon = attachment.fileName.match(/\.mp3$/i) ? "[audio]" : attachment.fileName.match(/\.mp4$/i) ? "[video]" : "[text]";
    const label = document.createElement("div");
    label.textContent = `${icon}\n${attachment.fileName}\n${kb(attachment.sizeBytes)}\nrequest: ${attachment.messageId || "-"}`;
    card.append(label);
    const url = `/api/attachments/${encodeURIComponent(attachment.id)}`;
    if (attachment.fileName.match(/\.mp3$/i)) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = url;
      card.append(audio);
    } else if (attachment.fileName.match(/\.mp4$/i)) {
      const video = document.createElement("video");
      video.controls = true;
      video.src = url;
      video.width = 240;
      card.append(video);
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open / download";
      card.append(link);
    }
    els.attachmentsList.append(card);
  }
}

function renderDraft() {
  els.draftJobId.textContent = state.currentDraft?.jobId || "No draft";
  els.draftPreview.textContent = state.currentDraft?.preview || "";
  els.itemsList.replaceChildren();
  for (const [index, item] of state.currentDraftItems.entries()) {
    const number = index + 1;
    const card = document.createElement("div");
    card.className = "item";
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = `#${String(number).padStart(3, "0")} ${item.title}`;
    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${item.project} / ${item.module} / ${item.type} / ${item.priority} / ${item.routing_confidence}`;
    const summary = document.createElement("p");
    summary.textContent = item.summary;
    const details = document.createElement("details");
    const ds = document.createElement("summary");
    ds.textContent = "Details";
    const db = document.createElement("p");
    db.textContent = item.details;
    details.append(ds, db);
    const clarify = document.createElement("div");
    clarify.className = "needs-clarification";
    clarify.textContent = item.needs_clarification?.length ? `Needs clarification: ${item.needs_clarification.join("; ")}` : "";
    const choices = document.createElement("div");
    choices.className = "choices";
    for (const action of ["apply", "keep", "drop"]) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `item-${number}-action`;
      radio.value = action;
      radio.dataset.item = String(number);
      if (action === "keep") radio.checked = true;
      label.append(radio, action);
      choices.append(label);
    }
    card.append(title, meta, summary, details, clarify, choices);
    els.itemsList.append(card);
  }
}

function appendLine(parent, text) {
  const line = document.createElement("div");
  line.textContent = text;
  parent.append(line);
}

function cell(text, className = "") {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function contentForDisplay(message) {
  if (els.displayMode.value === "json") return JSON.stringify(message, null, 2);
  return message.content;
}

function labelMode(request) {
  const mode = request.metadata?.mode || "chat";
  return String(mode).replace("_", " ");
}

function decisionStatus(response) {
  return response.metadata?.decisionStatus || "pending";
}

function decisionClass(response) {
  const status = decisionStatus(response);
  if (status === "applied") return "green";
  if (status === "dropped") return "red";
  if (status === "kept") return "gray";
  return "white";
}

function projectHint(response) {
  return response.metadata?.project || response.metadata?.mode || response.metadata?.jobId || "-";
}

function requestMatches(request, query) {
  if (!query) return true;
  const text = `${request.createdAt} ${requestHasResponse(request.id) ? "has_response" : "no_response"} ${labelMode(request)} ${request.content}`.toLowerCase();
  return text.includes(query);
}

function responseMatches(response, query) {
  if (!query) return true;
  const text = `${response.createdAt} ${response.kind} ${projectHint(response)} ${response.content} ${JSON.stringify(response.metadata || {})}`.toLowerCase();
  return text.includes(query);
}

function selectRequest(requestId) {
  state.selectedRequestId = requestId;
  state.expandedRequestId = state.expandedRequestId === requestId ? null : requestId;
  const linked = responses().find((message) => message.metadata?.responseToRequestId === requestId);
  state.selectedResponseId = linked?.id || null;
  renderRequests();
  renderResponses();
  renderAttachments();
  send({ type: "attachments_for_request", conversationId: state.currentConversationId, requestId });
}

function selectResponse(responseId) {
  const response = state.messages.find((message) => message.id === responseId);
  state.selectedResponseId = responseId;
  state.expandedResponseId = state.expandedResponseId === responseId ? null : responseId;
  if (response?.metadata?.responseToRequestId) state.selectedRequestId = response.metadata.responseToRequestId;
  renderRequests();
  renderResponses();
  renderAttachments();
}

function selectedExpression() {
  const groups = { apply: [], keep: [], drop: [] };
  for (const radio of els.itemsList.querySelectorAll("input[type=radio]:checked")) {
    groups[radio.value].push(Number(radio.dataset.item));
  }
  const parts = [];
  if (groups.apply.length === state.currentDraftItems.length && !groups.keep.length && !groups.drop.length) return "all";
  if (groups.apply.length) parts.push(groups.apply.join(","));
  if (groups.keep.length) parts.push("keep", groups.keep.join(","));
  if (groups.drop.length) parts.push("drop", groups.drop.join(","));
  return parts.length ? parts.join(" ") : "all";
}

async function sendCurrentRequest() {
  if (!state.currentConversationId) return;
  const text = els.prompt.value.trim();
  const files = Array.from(els.fileInput.files || []);
  if (!text && !files.length) return;
  let attachmentUploadIds = [];
  try {
    attachmentUploadIds = files.length ? await uploadSelectedFiles() : [];
  } catch (error) {
    els.fileNotice.textContent = error instanceof Error ? error.message : String(error);
    return;
  }
  send({
    type: "message_send",
    conversationId: state.currentConversationId,
    mode: els.modeSelect.value,
    text,
    attachmentUploadIds
  });
  els.prompt.value = "";
  els.fileInput.value = "";
  els.fileNotice.textContent = "";
}

async function uploadSelectedFiles() {
  const files = Array.from(els.fileInput.files || []);
  if (!files.length) return [];
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const response = await fetch("/api/uploads", { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Upload failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  return (body.uploads || []).map((upload) => upload.uploadId);
}

els.themeSelect.addEventListener("change", () => {
  document.body.className = els.themeSelect.value;
});
els.displayMode.addEventListener("change", () => {
  renderRequests();
  renderResponses();
});
els.conversationSelect.addEventListener("change", () => openConversation(els.conversationSelect.value));
els.newConversationBtn.addEventListener("click", () => send({ type: "conversation_create", title: "ProjectEGO Workbench" }));
els.archiveConversationBtn.addEventListener("click", () => {
  if (state.currentConversationId) send({ type: "conversation_archive", conversationId: state.currentConversationId });
});
els.requestSearch.addEventListener("input", renderRequests);
els.responseSearch.addEventListener("input", renderResponses);
els.sendBtn.addEventListener("click", sendCurrentRequest);
els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) sendCurrentRequest();
});
els.fileInput.addEventListener("change", async () => {
  const files = Array.from(els.fileInput.files || []);
  els.fileNotice.textContent = "";
  if (!files.length) return;
  for (const file of files) {
    if (!/\.(txt|md|mp3|mp4)$/i.test(file.name)) {
      els.fileNotice.textContent = "Supported: .txt, .md, .mp3, .mp4";
      els.fileInput.value = "";
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      els.fileNotice.textContent = "Attachment limit is 25 MB per file.";
      els.fileInput.value = "";
      return;
    }
  }
  els.fileNotice.textContent = `${files.length} file(s) ready to upload`;
  const firstText = files.find((file) => /\.(txt|md)$/i.test(file.name));
  if (firstText) els.prompt.value = await firstText.text();
});
els.applySelectedBtn.addEventListener("click", () => {
  if (state.currentConversationId && state.currentDraft?.jobId) {
    send({ type: "apply", conversationId: state.currentConversationId, jobId: state.currentDraft.jobId, expression: selectedExpression() });
  }
});
els.applyAllBtn.addEventListener("click", () => {
  if (state.currentConversationId && state.currentDraft?.jobId) send({ type: "apply", conversationId: state.currentConversationId, jobId: state.currentDraft.jobId, expression: "all" });
});
els.keepAllBtn.addEventListener("click", () => {
  for (const radio of els.itemsList.querySelectorAll("input[type=radio][value=keep]")) radio.checked = true;
});
els.showUnclarifiedBtn.addEventListener("click", () => {
  send({ type: "show_unclarified", conversationId: state.currentConversationId });
});

setConnected(false);
authEls.toggleAuthMode.addEventListener("click", () => {
  const register = authEls.registerForm.hidden;
  authEls.registerForm.hidden = !register;
  authEls.loginForm.hidden = register;
  authEls.toggleAuthMode.textContent = register ? "Back to login" : "Create account";
  authEls.authMessage.textContent = "";
});

authEls.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ usernameOrEmail: authEls.loginName.value, password: authEls.loginPassword.value })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    showAuth(body.error || "Login failed.");
    return;
  }
  if (!body.user?.username) {
    showAuth("Login failed: unexpected server response.");
    return;
  }
  authEls.loginPassword.value = "";
  state.shouldReconnect = true;
  showWorkbench(body.user);
  connect();
});

authEls.registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: authEls.registerUsername.value,
      email: authEls.registerEmail.value,
      displayName: authEls.registerDisplayName.value,
      password: authEls.registerPassword.value,
      inviteCode: authEls.registerInviteCode.value
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    showAuth(body.error || "Registration failed.");
    return;
  }
  if (!body.user?.username) {
    showAuth("Registration failed: unexpected server response.");
    return;
  }
  authEls.registerPassword.value = "";
  authEls.registerInviteCode.value = "";
  state.shouldReconnect = true;
  showWorkbench(body.user);
  connect();
});

authEls.logoutBtn.addEventListener("click", async () => {
  state.shouldReconnect = false;
  await fetch("/api/auth/logout", { method: "POST" });
  state.ws?.close();
  state.ws = null;
  state.currentConversationId = null;
  state.messages = [];
  state.conversations = [];
  state.attachments = [];
  state.attachmentsByRequest = {};
  setConnected(false);
  showAuth("Logged out.");
});

bootAuth();
