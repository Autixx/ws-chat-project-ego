const state = {
  ws: null,
  connected: false,
  conversations: [],
  currentConversationId: null,
  messages: [],
  currentDraft: null,
  currentDraftItems: [],
  unclarifiedIndex: ""
};

const els = {
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  userLine: document.getElementById("userLine"),
  newConversationBtn: document.getElementById("newConversationBtn"),
  archiveConversationBtn: document.getElementById("archiveConversationBtn"),
  conversationFilter: document.getElementById("conversationFilter"),
  conversationList: document.getElementById("conversationList"),
  conversationTitle: document.getElementById("conversationTitle"),
  messageList: document.getElementById("messageList"),
  prompt: document.getElementById("prompt"),
  fileInput: document.getElementById("fileInput"),
  fileNotice: document.getElementById("fileNotice"),
  sendBtn: document.getElementById("sendBtn"),
  applySelectedBtn: document.getElementById("applySelectedBtn"),
  applyAllBtn: document.getElementById("applyAllBtn"),
  keepAllBtn: document.getElementById("keepAllBtn"),
  showUnclarifiedBtn: document.getElementById("showUnclarifiedBtn"),
  draftJobId: document.getElementById("draftJobId"),
  draftPreview: document.getElementById("draftPreview"),
  itemsList: document.getElementById("itemsList"),
  unclarifiedPanel: document.getElementById("unclarifiedPanel"),
  debugOutput: document.getElementById("debugOutput")
};

function log(message) {
  els.debugOutput.textContent += `${JSON.stringify(message, null, 2)}\n\n`;
  els.debugOutput.scrollTop = els.debugOutput.scrollHeight;
}

function setConnected(value) {
  state.connected = value;
  els.statusDot.classList.toggle("online", value);
  els.statusText.textContent = value ? "online" : "offline";
  for (const button of [els.newConversationBtn, els.archiveConversationBtn, els.sendBtn, els.applySelectedBtn, els.applyAllBtn, els.keepAllBtn, els.showUnclarifiedBtn]) {
    button.disabled = !value;
  }
}

function send(message) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(message));
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.ws = ws;

  ws.addEventListener("open", () => {
    setConnected(true);
    send({ type: "conversation_list" });
  });

  ws.addEventListener("close", () => {
    setConnected(false);
    els.userLine.textContent = "Disconnected. Reconnecting...";
    window.setTimeout(connect, 1500);
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    log(message);
    handleServerMessage(message);
  });
}

function handleServerMessage(message) {
  if (message.type === "connected") {
    els.userLine.textContent = `Connected as ${message.user.username}${message.user.email ? ` <${message.user.email}>` : ""}`;
  }

  if (message.type === "conversation_list") {
    state.conversations = message.conversations;
    renderConversations();
    if (!state.currentConversationId) {
      if (state.conversations.length) openConversation(state.conversations[0].id);
      else send({ type: "conversation_create", title: "New conversation" });
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
    restoreDraftFromMessages();
    renderConversations();
    renderConversationHeader();
    renderMessages();
  }

  if (message.type === "conversation_renamed") {
    upsertConversation(message.conversation);
    renderConversations();
    renderConversationHeader();
  }

  if (message.type === "conversation_archived") {
    state.conversations = state.conversations.filter((conversation) => conversation.id !== message.conversationId);
    if (state.currentConversationId === message.conversationId) {
      state.currentConversationId = null;
      state.messages = [];
      renderMessages();
      clearDraft();
    }
    renderConversations();
    if (!state.currentConversationId) send({ type: "conversation_list" });
  }

  if (message.type === "message_created") {
    if (message.message.conversationId === state.currentConversationId) {
      const existingIndex = state.messages.findIndex((item) => item.id === message.message.id);
      if (existingIndex >= 0) state.messages[existingIndex] = message.message;
      else state.messages.push(message.message);
      renderMessages();
      if (message.message.kind === "draft") restoreDraftFromMessage(message.message);
    }
  }

  if (message.type === "assistant_message_start" && message.conversationId === state.currentConversationId) {
    const placeholder = {
      id: message.messageId,
      conversationId: message.conversationId,
      role: "assistant",
      kind: "chat",
      content: "",
      createdAt: new Date().toISOString(),
      pending: true
    };
    state.messages.push(placeholder);
    renderMessages();
  }

  if (message.type === "token" && message.conversationId === state.currentConversationId) {
    const target = state.messages.find((item) => item.id === message.messageId);
    if (target) {
      target.content += message.text;
      renderMessages();
    }
  }

  if (message.type === "assistant_message_done" && message.conversationId === state.currentConversationId) {
    const target = state.messages.find((item) => item.id === message.messageId);
    if (target) target.pending = false;
    renderMessages();
  }

  if (message.type === "draft_saved") {
    state.currentDraft = { jobId: message.jobId, preview: message.preview, mode: currentMode(), result: null };
    renderDraft();
  }

  if (message.type === "draft_result") {
    state.currentDraft = {
      jobId: message.jobId,
      preview: state.currentDraft?.preview || "",
      mode: currentMode(),
      result: message.result
    };
    state.currentDraftItems = message.result.items || [];
    renderDraft();
  }

  if (message.type === "apply_result" && message.conversationId === state.currentConversationId) {
    renderMessages();
  }

  if (message.type === "unclarified_index") {
    state.unclarifiedIndex = message.text;
    els.unclarifiedPanel.textContent = message.text;
  }

  if (message.type === "error") {
    state.messages.push({
      id: `local-error-${Date.now()}`,
      conversationId: state.currentConversationId,
      role: "tool",
      kind: "error",
      content: `${message.message}${message.details ? `: ${message.details}` : ""}`,
      createdAt: new Date().toISOString()
    });
    renderMessages();
  }
}

function upsertConversation(conversation) {
  const index = state.conversations.findIndex((item) => item.id === conversation.id);
  if (index >= 0) state.conversations[index] = conversation;
  else state.conversations.unshift(conversation);
  state.conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function openConversation(conversationId) {
  send({ type: "conversation_open", conversationId });
}

function renderConversations() {
  const query = els.conversationFilter.value.trim().toLowerCase();
  els.conversationList.replaceChildren();
  for (const conversation of state.conversations.filter((item) => item.title.toLowerCase().includes(query))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation${conversation.id === state.currentConversationId ? " active" : ""}`;
    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title;
    const meta = document.createElement("span");
    meta.className = "conversation-meta";
    meta.textContent = new Date(conversation.updatedAt).toLocaleString();
    button.append(title, meta);
    button.addEventListener("click", () => openConversation(conversation.id));
    els.conversationList.append(button);
  }
}

function renderConversationHeader() {
  const conversation = state.conversations.find((item) => item.id === state.currentConversationId);
  els.conversationTitle.textContent = conversation?.title || "No conversation";
}

function renderMessages() {
  els.messageList.replaceChildren();
  for (const message of state.messages) {
    const wrapper = document.createElement("article");
    wrapper.className = `message ${message.role} ${message.kind === "error" ? "error" : ""}`;
    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = labelFor(message);
    const body = document.createElement("div");
    body.textContent = message.content || (message.pending ? "Working..." : "");
    wrapper.append(label, body);

    if (message.kind === "draft") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "draft-open";
      button.textContent = "Open in Draft Inspector";
      button.addEventListener("click", () => restoreDraftFromMessage(message));
      wrapper.append(button);
    }

    els.messageList.append(wrapper);
  }
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function labelFor(message) {
  if (message.kind === "draft") return "Draft";
  if (message.kind === "apply_result") return "Apply result";
  if (message.kind === "unclarified_index") return "Unclarified";
  if (message.kind === "status") return "Status";
  return message.role;
}

function currentMode() {
  return document.querySelector("input[name=mode]:checked")?.value || "chat";
}

function restoreDraftFromMessages() {
  const draftMessage = [...state.messages].reverse().find((message) => message.kind === "draft");
  if (draftMessage) restoreDraftFromMessage(draftMessage);
  else clearDraft();
}

function restoreDraftFromMessage(message) {
  const metadata = message.metadata || {};
  state.currentDraft = {
    jobId: metadata.jobId || message.jobId,
    preview: metadata.preview || "",
    mode: metadata.mode || "digest",
    result: metadata.result || null
  };
  state.currentDraftItems = state.currentDraft.result?.items || [];
  renderDraft();
}

function clearDraft() {
  state.currentDraft = null;
  state.currentDraftItems = [];
  renderDraft();
}

function renderDraft() {
  els.draftJobId.textContent = state.currentDraft?.jobId || "No draft";
  els.draftPreview.textContent = state.currentDraft?.preview || "";
  els.itemsList.replaceChildren();

  state.currentDraftItems.forEach((item, index) => {
    const number = index + 1;
    const card = document.createElement("div");
    card.className = "item";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = `#${String(number).padStart(3, "0")} ${item.title}`;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${item.project} / ${item.module} / ${item.type} / ${item.priority} / ${item.routing_confidence}`;

    const summary = document.createElement("div");
    summary.textContent = item.summary;

    const clarify = document.createElement("div");
    clarify.className = "needs-clarification";
    clarify.textContent = item.needs_clarification?.length ? `Needs clarification: ${item.needs_clarification.join("; ")}` : "";

    const details = document.createElement("details");
    details.className = "item-details";
    const detailsSummary = document.createElement("summary");
    detailsSummary.textContent = "Details";
    const detailsBody = document.createElement("p");
    detailsBody.textContent = item.details;
    details.append(detailsSummary, detailsBody);

    const choices = document.createElement("div");
    choices.className = "choices";
    for (const action of ["apply", "keep", "drop"]) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `item-${number}-action`;
      radio.value = action;
      radio.dataset.item = String(number);
      if (action === defaultDraftAction()) radio.checked = true;
      label.append(radio, action);
      choices.append(label);
    }

    card.append(title, meta, summary, clarify, details, choices);
    els.itemsList.append(card);
  });
}

function defaultDraftAction() {
  return state.currentDraft?.mode === "tasks" ? "apply" : "keep";
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

function sendCurrentMessage() {
  if (!state.currentConversationId) return;
  const text = els.prompt.value.trim();
  if (!text) return;
  send({
    type: "message_send",
    conversationId: state.currentConversationId,
    mode: currentMode(),
    text,
    fileName: els.fileInput.files[0]?.name
  });
  els.prompt.value = "";
  els.fileInput.value = "";
  els.fileNotice.textContent = "";
}

els.newConversationBtn.addEventListener("click", () => send({ type: "conversation_create", title: "New conversation" }));
els.archiveConversationBtn.addEventListener("click", () => {
  if (state.currentConversationId) send({ type: "conversation_archive", conversationId: state.currentConversationId });
});
els.conversationFilter.addEventListener("input", renderConversations);
els.sendBtn.addEventListener("click", sendCurrentMessage);
els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) sendCurrentMessage();
});

els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  els.fileNotice.textContent = "";
  if (!file) return;
  if (!/\.(txt|md)$/i.test(file.name)) {
    els.fileNotice.textContent = "Only .txt and .md files are accepted.";
    els.fileInput.value = "";
    return;
  }
  if (file.size > 256_000) els.fileNotice.textContent = "Large file warning: MVP input limit is 256 KB.";
  els.prompt.value = await file.text();
});

els.applySelectedBtn.addEventListener("click", () => {
  if (!state.currentConversationId || !state.currentDraft?.jobId) return;
  send({ type: "apply", conversationId: state.currentConversationId, jobId: state.currentDraft.jobId, expression: selectedExpression() });
});

els.applyAllBtn.addEventListener("click", () => {
  if (!state.currentConversationId || !state.currentDraft?.jobId) return;
  send({ type: "apply", conversationId: state.currentConversationId, jobId: state.currentDraft.jobId, expression: "all" });
});

els.keepAllBtn.addEventListener("click", () => {
  for (const radio of els.itemsList.querySelectorAll("input[type=radio][value=keep]")) radio.checked = true;
});

els.showUnclarifiedBtn.addEventListener("click", () => {
  send({ type: "show_unclarified", conversationId: state.currentConversationId });
});

setConnected(false);
connect();
