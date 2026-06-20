const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const THEME_STORAGE_KEY = "projectego-dashboard-theme";

const state = {
  ws: null,
  shouldReconnect: true,
  connected: false,
  conversations: [],
  showArchived: false,
  currentConversationId: null,
  messages: [],
  selectedRequestId: null,
  selectedResponseId: null,
  expandedRequestId: null,
  expandedResponseId: null,
  currentDraft: null,
  currentDraftItems: [],
  attachments: [],
  attachmentsByRequest: {},
  jobs: [],
  pendingFiles: [],
  requestMode: "chat",
  displayMode: "text",
  imageZoom: 1,
  imagePanX: 0,
  imagePanY: 0,
  imageDragging: null
};

const els = {
  wsSquare: document.getElementById("wsSquare"),
  wsText: document.getElementById("wsText"),
  planeSquare: document.getElementById("planeSquare"),
  planeText: document.getElementById("planeText"),
  n8nSquare: document.getElementById("n8nSquare"),
  n8nText: document.getElementById("n8nText"),
  llmSquare: document.getElementById("llmSquare"),
  llmText: document.getElementById("llmText"),
  dbSquare: document.getElementById("dbSquare"),
  dbText: document.getElementById("dbText"),
  userLine: document.getElementById("userLine"),
  conversationTitle: document.getElementById("conversationTitle"),
  conversationSelect: document.getElementById("conversationSelect"),
  newConversationBtn: document.getElementById("newConversationBtn"),
  showArchivedBtn: document.getElementById("showArchivedBtn"),
  renameConversationBtn: document.getElementById("renameConversationBtn"),
  archiveConversationBtn: document.getElementById("archiveConversationBtn"),
  unarchiveConversationBtn: document.getElementById("unarchiveConversationBtn"),
  deleteConversationBtn: document.getElementById("deleteConversationBtn"),
  themeButtons: Array.from(document.querySelectorAll("[data-theme]")),
  customBgColor: document.getElementById("customBgColor"),
  customFieldColor: document.getElementById("customFieldColor"),
  customTextColor: document.getElementById("customTextColor"),
  customLineColor: document.getElementById("customLineColor"),
  displayButtons: Array.from(document.querySelectorAll("[data-display]")),
  requestSearch: document.getElementById("requestSearch"),
  responseSearch: document.getElementById("responseSearch"),
  requestList: document.getElementById("requestList"),
  responseList: document.getElementById("responseList"),
  attachmentsList: document.getElementById("attachmentsList"),
  prompt: document.getElementById("prompt"),
  modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
  fileInput: document.getElementById("fileInput"),
  fileNotice: document.getElementById("fileNotice"),
  sendBtn: document.getElementById("sendBtn"),
  openEditorBtn: document.getElementById("openEditorBtn"),
  promptEditor: document.getElementById("promptEditor"),
  promptEditorHeader: document.getElementById("promptEditorHeader"),
  promptEditorText: document.getElementById("promptEditorText"),
  closeEditorBtn: document.getElementById("closeEditorBtn"),
  uploadInspector: document.getElementById("uploadInspector"),
  uploadInspectorList: document.getElementById("uploadInspectorList"),
  uploadInspectorHeader: document.getElementById("uploadInspectorHeader"),
  closeUploadInspectorBtn: document.getElementById("closeUploadInspectorBtn"),
  clearUploadsBtn: document.getElementById("clearUploadsBtn"),
  imageViewer: document.getElementById("imageViewer"),
  imageViewerHeader: document.getElementById("imageViewerHeader"),
  imageViewerTitle: document.getElementById("imageViewerTitle"),
  imageViewerBody: document.getElementById("imageViewerBody"),
  imageViewerImg: document.getElementById("imageViewerImg"),
  closeImageViewerBtn: document.getElementById("closeImageViewerBtn"),
  mediaViewer: document.getElementById("mediaViewer"),
  mediaViewerHeader: document.getElementById("mediaViewerHeader"),
  mediaViewerTitle: document.getElementById("mediaViewerTitle"),
  mediaViewerVideo: document.getElementById("mediaViewerVideo"),
  closeMediaViewerBtn: document.getElementById("closeMediaViewerBtn"),
  textPreview: document.getElementById("textPreview"),
  textPreviewHeader: document.getElementById("textPreviewHeader"),
  textPreviewTitle: document.getElementById("textPreviewTitle"),
  textPreviewText: document.getElementById("textPreviewText"),
  closeTextPreviewBtn: document.getElementById("closeTextPreviewBtn"),
  renameOverlay: document.getElementById("renameOverlay"),
  renameDialog: document.getElementById("renameDialog"),
  renameInput: document.getElementById("renameInput"),
  cancelRenameBtn: document.getElementById("cancelRenameBtn"),
  applyRenameBtn: document.getElementById("applyRenameBtn"),
  deleteStepOneOverlay: document.getElementById("deleteStepOneOverlay"),
  deleteStepTwoOverlay: document.getElementById("deleteStepTwoOverlay"),
  deleteUnderstoodBtn: document.getElementById("deleteUnderstoodBtn"),
  deleteCancelOneBtn: document.getElementById("deleteCancelOneBtn"),
  deleteFilesList: document.getElementById("deleteFilesList"),
  deleteConsequencesCheck: document.getElementById("deleteConsequencesCheck"),
  deleteConfirmBtn: document.getElementById("deleteConfirmBtn"),
  deleteCancelTwoBtn: document.getElementById("deleteCancelTwoBtn"),
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
  for (const button of [
    els.newConversationBtn,
    els.showArchivedBtn,
    els.renameConversationBtn,
    els.archiveConversationBtn,
    els.unarchiveConversationBtn,
    els.deleteConversationBtn,
    els.sendBtn,
    els.applySelectedBtn,
    els.applyAllBtn,
    els.keepAllBtn,
    els.showUnclarifiedBtn
  ]) {
    button.disabled = !value;
  }
  if (value) renderHeader();
}

function connect() {
  if (!state.shouldReconnect) return;
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.ws = ws;
  ws.addEventListener("open", () => {
    setConnected(true);
    requestConversationList();
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
    setStatusIndicator(els.dbSquare, els.dbText, message.db.status, statusLabel(message.db.status, message.db.path || message.db.message));
    setStatusIndicator(els.llmSquare, els.llmText, componentTone(message.llmAgent?.status), statusLabel(message.llmAgent?.status, message.llmAgent?.message || message.llmAgent?.lastError));
    setStatusIndicator(els.n8nSquare, els.n8nText, componentTone(message.n8n?.status), statusLabel(message.n8n?.status, message.n8n?.message || message.n8n?.lastError));
    setStatusIndicator(els.planeSquare, els.planeText, componentTone(message.plane?.status, { informational: true }), statusLabel(message.plane?.status, message.plane?.message || message.plane?.lastError));
  }

  if (message.type === "conversation_list") {
    state.conversations = state.showArchived ? message.conversations : message.conversations.filter((conversation) => !conversation.archived);
    if (state.currentConversationId && !state.conversations.some((conversation) => conversation.id === state.currentConversationId)) {
      state.currentConversationId = null;
      state.messages = [];
      state.attachments = [];
      state.attachmentsByRequest = {};
      state.jobs = [];
    }
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
    state.jobs = message.jobs || [];
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
    const conversation = state.conversations.find((item) => item.id === message.conversationId);
    if (conversation) conversation.archived = true;
    if (!state.showArchived && state.currentConversationId === message.conversationId) {
      state.currentConversationId = null;
      state.messages = [];
    }
    renderAll();
    requestConversationList();
  }

  if (message.type === "conversation_unarchived") {
    upsertConversation(message.conversation);
    renderAll();
    requestConversationList();
  }

  if (message.type === "conversation_deleted") {
    state.conversations = state.conversations.filter((item) => item.id !== message.conversationId);
    if (state.currentConversationId === message.conversationId) {
      state.currentConversationId = null;
      state.messages = [];
      state.attachments = [];
      state.attachmentsByRequest = {};
      state.jobs = [];
    }
    closeDeleteDialogs();
    renderAll();
    requestConversationList();
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

  if (message.type === "job_created" || message.type === "job_updated") {
    upsertJob(message.job);
    renderResponses();
  }

  if (message.type === "job_list" && message.conversationId === state.currentConversationId) {
    state.jobs = message.jobs || [];
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
  square.className = `sq ${status === "ok" ? "green" : status === "error" ? "red" : status === "warn" ? "yellow" : "gray"}`;
  text.textContent = label;
}

function componentTone(status, options = {}) {
  if (status === "reachable" || status === "configured") return "ok";
  if (options.informational && status === "unreachable") return "warn";
  if (status === "mock") return "ok";
  if (status === "unconfigured" || status === "misconfigured") return "warn";
  return "error";
}

function statusLabel(status, detail = "") {
  const label = formatStatus(status || "unknown");
  return detail ? `${label} (${detail})` : label;
}

function setTheme(theme, { persist = true } = {}) {
  document.body.classList.remove("theme-dark", "theme-contrast", "theme-custom");
  document.body.classList.add(theme);
  for (const button of els.themeButtons) button.classList.toggle("active", button.dataset.theme === theme);
  if (theme === "theme-custom") applyCustomTheme();
  if (persist) saveThemeSettings(theme);
}

function applyCustomTheme() {
  document.documentElement.style.setProperty("--custom-bg", els.customBgColor.value);
  document.documentElement.style.setProperty("--custom-panel", mixColor(els.customBgColor.value, "#ffffff", 0.06));
  document.documentElement.style.setProperty("--custom-field", els.customFieldColor.value);
  document.documentElement.style.setProperty("--custom-text", els.customTextColor.value);
  document.documentElement.style.setProperty("--custom-muted", mixColor(els.customTextColor.value, els.customBgColor.value, 0.35));
  document.documentElement.style.setProperty("--custom-line", els.customLineColor.value);
}

function saveThemeSettings(theme = activeTheme()) {
  try {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        theme,
        colors: customThemeColors()
      })
    );
  } catch {
    // Theme persistence is best-effort.
  }
}

function loadThemeSettings() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) {
      applyCustomTheme();
      setTheme("theme-dark", { persist: false });
      return;
    }
    const saved = JSON.parse(raw);
    if (saved?.colors && typeof saved.colors === "object") {
      setColorInput(els.customBgColor, saved.colors.bg);
      setColorInput(els.customFieldColor, saved.colors.field);
      setColorInput(els.customTextColor, saved.colors.text);
      setColorInput(els.customLineColor, saved.colors.line);
    }
    const theme = ["theme-dark", "theme-contrast", "theme-custom"].includes(saved?.theme) ? saved.theme : "theme-dark";
    setTheme(theme, { persist: false });
  } catch {
    applyCustomTheme();
    setTheme("theme-dark", { persist: false });
  }
}

function customThemeColors() {
  return {
    bg: els.customBgColor.value,
    field: els.customFieldColor.value,
    text: els.customTextColor.value,
    line: els.customLineColor.value
  };
}

function activeTheme() {
  if (document.body.classList.contains("theme-custom")) return "theme-custom";
  if (document.body.classList.contains("theme-contrast")) return "theme-contrast";
  return "theme-dark";
}

function setColorInput(input, value) {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) input.value = value;
}

function mixColor(first, second, secondRatio) {
  const a = parseHex(first);
  const b = parseHex(second);
  const mixed = a.map((value, index) => Math.round(value * (1 - secondRatio) + b[index] * secondRatio));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(value) {
  const normalized = value.replace("#", "");
  return [0, 2, 4].map((start) => parseInt(normalized.slice(start, start + 2), 16));
}

function setRequestMode(mode) {
  state.requestMode = mode;
  for (const button of els.modeButtons) button.classList.toggle("active", button.dataset.mode === mode);
}

function setDisplayMode(mode) {
  state.displayMode = mode;
  for (const button of els.displayButtons) button.classList.toggle("active", button.dataset.display === mode);
  renderRequests();
  renderResponses();
}

function toggleDisplayMode(mode) {
  setDisplayMode(state.displayMode === mode ? "text" : mode);
}

function syncEditorFromPrompt() {
  if (els.promptEditorText.value !== els.prompt.value) els.promptEditorText.value = els.prompt.value;
}

function syncPromptFromEditor() {
  if (els.prompt.value !== els.promptEditorText.value) els.prompt.value = els.promptEditorText.value;
}

function openPromptEditor({ auto = false } = {}) {
  if (auto && !shouldAutoOpenEditor()) return;
  const start = els.prompt.selectionStart ?? els.prompt.value.length;
  const end = els.prompt.selectionEnd ?? start;
  syncEditorFromPrompt();
  els.promptEditor.hidden = false;
  requestAnimationFrame(() => {
    els.promptEditorText.focus();
    els.promptEditorText.setSelectionRange(start, end);
  });
}

function closePromptEditor() {
  const start = els.promptEditorText.selectionStart ?? els.promptEditorText.value.length;
  const end = els.promptEditorText.selectionEnd ?? start;
  syncPromptFromEditor();
  els.promptEditor.hidden = true;
  requestAnimationFrame(() => {
    els.prompt.focus();
    els.prompt.setSelectionRange(start, end);
  });
}

function shouldAutoOpenEditor() {
  if (!els.prompt.value.trim()) return false;
  return els.prompt.value.split(/\r?\n/).some((line) => line.length > 100);
}

function maybeOpenPromptEditor() {
  if (!els.promptEditor.hidden) return;
  openPromptEditor({ auto: true });
}

function wireDraggableWindow(panel, handle, ignoredButton) {
  let drag = null;
  handle.addEventListener("pointerdown", (event) => {
    if (ignoredButton && event.target === ignoredButton) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const nextLeft = Math.max(0, Math.min(window.innerWidth - 80, drag.left + event.clientX - drag.x));
    const nextTop = Math.max(0, Math.min(window.innerHeight - 60, drag.top + event.clientY - drag.y));
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  handle.addEventListener("pointerup", () => {
    drag = null;
  });
  handle.addEventListener("pointercancel", () => {
    drag = null;
  });
}

function setImageZoom(zoom) {
  state.imageZoom = Math.max(0.2, Math.min(6, zoom));
  updateImageTransform();
}

function updateImageTransform() {
  els.imageViewerImg.style.transform = `translate(${state.imagePanX}px, ${state.imagePanY}px) scale(${state.imageZoom})`;
}

function openImageViewer(url, fileName) {
  const viewer = createFloatingWindow("image-viewer", fileName);
  const body = document.createElement("div");
  body.className = "image-viewer-body";
  const image = document.createElement("img");
  image.className = "image-viewer-img";
  image.src = url;
  image.alt = fileName;
  image.draggable = false;
  body.append(image);
  viewer.panel.append(body);
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let drag = null;
  const update = () => {
    image.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  };
  image.addEventListener("dragstart", (event) => event.preventDefault());
  body.addEventListener("dragstart", (event) => event.preventDefault());
  body.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom = Math.max(0.2, Math.min(6, zoom + (event.deltaY < 0 ? 0.12 : -0.12)));
    update();
  });
  body.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { x: event.clientX, y: event.clientY, panX, panY };
    document.body.classList.add("no-text-select");
    body.classList.add("dragging");
    body.setPointerCapture(event.pointerId);
  });
  body.addEventListener("pointermove", (event) => {
    if (!drag) return;
    panX = drag.panX + event.clientX - drag.x;
    panY = drag.panY + event.clientY - drag.y;
    update();
  });
  const stopDrag = () => {
    drag = null;
    document.body.classList.remove("no-text-select");
    body.classList.remove("dragging");
  };
  body.addEventListener("pointerup", stopDrag);
  body.addEventListener("pointercancel", stopDrag);
  viewer.onClose = () => document.body.classList.remove("no-text-select");
  update();
}

function closeImageViewer() {
  els.imageViewer.hidden = true;
  els.imageViewerImg.removeAttribute("src");
  els.imageViewerBody.classList.remove("dragging");
  document.body.classList.remove("no-text-select");
  state.imageDragging = null;
}

function openMediaViewer(url, fileName) {
  const viewer = createFloatingWindow("media-viewer", fileName);
  const body = document.createElement("div");
  body.className = "media-viewer-body";
  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.src = url;
  body.append(video);
  viewer.panel.append(body);
  viewer.onClose = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}

function closeMediaViewer() {
  els.mediaViewer.hidden = true;
  els.mediaViewerVideo.pause();
  els.mediaViewerVideo.removeAttribute("src");
  els.mediaViewerVideo.load();
}

function createFloatingWindow(className, title) {
  const panel = document.createElement("section");
  panel.className = `${className} floating-window`;
  const offset = document.querySelectorAll(".floating-window").length * 18;
  panel.style.left = `calc(12.5vw + ${offset}px)`;
  panel.style.top = `calc(12.5vh + ${offset}px)`;
  const header = document.createElement("header");
  header.className = `${className}-header`;
  const label = document.createElement("span");
  label.textContent = title;
  const close = document.createElement("button");
  close.className = "window-close";
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  header.append(label, close);
  panel.append(header);
  document.body.append(panel);
  const floating = { panel, onClose: null };
  close.addEventListener("click", () => {
    if (floating.onClose) floating.onClose();
    panel.remove();
  });
  wireDraggableWindow(panel, header, close);
  return floating;
}

async function openTextPreview(url, fileName) {
  els.textPreviewTitle.textContent = fileName;
  els.textPreviewText.value = "Loading...";
  els.textPreview.hidden = false;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    els.textPreviewText.value = await response.text();
  } catch (error) {
    els.textPreviewText.value = `Failed to load text preview: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function closeTextPreview() {
  els.textPreview.hidden = true;
  els.textPreviewText.value = "";
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

function upsertJob(job) {
  const index = state.jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) state.jobs[index] = job;
  else state.jobs.push(job);
  state.jobs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function requestConversationList() {
  send({ type: "conversation_list", includeArchived: state.showArchived });
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
  els.conversationTitle.textContent = conversation ? displayConversationTitle(conversation) : "PROJECTEGO / CHAT TITLE";
  els.archiveConversationBtn.disabled = !conversation || conversation.archived;
  els.unarchiveConversationBtn.disabled = !conversation || !conversation.archived;
  els.renameConversationBtn.disabled = !conversation;
  els.deleteConversationBtn.disabled = !conversation;
  els.showArchivedBtn.classList.toggle("active", state.showArchived);
}

function renderConversationSelect() {
  els.conversationSelect.replaceChildren();
  for (const conversation of state.conversations) {
    const option = document.createElement("option");
    option.value = conversation.id;
    option.textContent = displayConversationTitle(conversation);
    option.selected = conversation.id === state.currentConversationId;
    els.conversationSelect.append(option);
  }
}

function displayConversationTitle(conversation) {
  return `${conversation.title}${conversation.archived ? " Archived" : ""}`;
}

function openRenameDialog() {
  const conversation = state.conversations.find((item) => item.id === state.currentConversationId);
  if (!conversation) return;
  els.renameInput.value = conversation.title.slice(0, 64);
  els.renameOverlay.hidden = false;
  requestAnimationFrame(() => {
    els.renameInput.focus();
    els.renameInput.select();
  });
}

function closeRenameDialog() {
  els.renameOverlay.hidden = true;
}

function applyRename() {
  const title = els.renameInput.value.trim().slice(0, 64);
  if (!state.currentConversationId || !title) return;
  send({ type: "conversation_rename", conversationId: state.currentConversationId, title });
  closeRenameDialog();
}

function openDeleteStepOne() {
  if (!state.currentConversationId) return;
  els.deleteStepOneOverlay.hidden = false;
}

function openDeleteStepTwo() {
  els.deleteConsequencesCheck.checked = false;
  els.deleteConfirmBtn.disabled = true;
  renderDeleteFilesList();
  els.deleteStepTwoOverlay.hidden = false;
}

function closeDeleteDialogs() {
  els.deleteStepTwoOverlay.hidden = true;
  els.deleteStepOneOverlay.hidden = true;
}

function renderDeleteFilesList() {
  els.deleteFilesList.replaceChildren();
  const attachments = state.attachments || [];
  if (!attachments.length) {
    const empty = document.createElement("div");
    empty.className = "attachment-empty";
    empty.textContent = "No files attached to this Workbench.";
    els.deleteFilesList.append(empty);
    return;
  }
  for (const attachment of attachments) {
    const row = document.createElement("div");
    row.className = "delete-file-row";
    const info = document.createElement("div");
    info.className = "delete-file-info";
    info.textContent = `${attachment.fileName}\n${kb(attachment.sizeBytes)} / ${attachment.mimeType || "unknown"}`;
    const actions = document.createElement("div");
    actions.className = "delete-file-actions";
    const url = `/api/attachments/${encodeURIComponent(attachment.id)}`;
    if (attachment.fileName.match(/\.(jpg|png|svg)$/i)) {
      actions.append(previewButton("Preview", () => openImageViewer(url, attachment.fileName)));
    } else if (attachment.fileName.match(/\.mp4$/i)) {
      actions.append(previewButton("Preview", () => openMediaViewer(url, attachment.fileName)));
    } else if (attachment.fileName.match(/\.(txt|md)$/i)) {
      actions.append(previewButton("Preview", () => openTextPreview(url, attachment.fileName)));
    }
    const download = document.createElement("a");
    download.className = "download-icon";
    download.href = url;
    download.download = attachment.fileName;
    download.setAttribute("aria-label", `Download ${attachment.fileName}`);
    download.title = "Download";
    download.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>';
    actions.append(download);
    row.append(info, actions);
    els.deleteFilesList.append(row);
  }
}

function previewButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function confirmDeleteWorkbench() {
  if (!state.currentConversationId || !els.deleteConsequencesCheck.checked) return;
  send({ type: "conversation_delete", conversationId: state.currentConversationId });
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

function fileExt(fileName) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
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
    status.className = "status-stack";
    const decision = document.createElement("span");
    decision.className = `sq ${decisionClass(response)}`;
    decision.title = `Decision: ${formatStatus(decisionStatus(response))}`;
    const execution = document.createElement("span");
    execution.className = `sq ${executionClass(response)}`;
    execution.title = `Execution: ${formatStatus(executionStatus(response))}`;
    status.append(decision, execution);
    row.append(status);

    if (expanded) {
      const main = document.createElement("div");
      main.className = "row-main";
      appendLine(main, `${shortDate(response.createdAt)} / ${response.kind} / ${projectHint(response)} / ${kb(byteSize(response.content))}`);
      appendLine(main, `Decision: ${formatStatus(decisionStatus(response))}`);
      appendStatusLine(main, "Execution", executionStatus(response), executionClass(response));
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
    empty.className = "attachment-empty";
    empty.textContent = "No attachments for selected request.";
    els.attachmentsList.append(empty);
    return;
  }
  for (const attachment of attachments) {
    const card = document.createElement("div");
    card.className = "attachment-card";
    const icon = attachment.fileName.match(/\.mp3$/i) ? "[audio]" : attachment.fileName.match(/\.mp4$/i) ? "[video]" : attachment.fileName.match(/\.(jpg|png|svg)$/i) ? "[image]" : "[text]";
    const label = document.createElement("div");
    label.className = "attachment-info";
    label.textContent = `${icon}\n${attachment.fileName}\n${kb(attachment.sizeBytes)}\nrequest: ${attachment.messageId || "-"}`;
    card.append(label);
    const url = `/api/attachments/${encodeURIComponent(attachment.id)}`;
    if (attachment.fileName.match(/\.mp3$/i)) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = url;
      card.append(audio);
    } else if (attachment.fileName.match(/\.mp4$/i)) {
      const preview = document.createElement("button");
      preview.type = "button";
      preview.textContent = "Preview video";
      preview.addEventListener("click", () => openMediaViewer(url, attachment.fileName));
      card.append(preview);
    } else if (attachment.fileName.match(/\.(jpg|png|svg)$/i)) {
      const thumbButton = document.createElement("button");
      thumbButton.type = "button";
      thumbButton.className = "attachment-thumb-button";
      const image = document.createElement("img");
      image.className = "attachment-thumb";
      image.src = url;
      image.alt = attachment.fileName;
      thumbButton.append(image);
      thumbButton.addEventListener("click", () => openImageViewer(url, attachment.fileName));
      card.append(thumbButton);
    } else if (attachment.fileName.match(/\.(txt|md)$/i)) {
      const preview = document.createElement("button");
      preview.type = "button";
      preview.textContent = "Preview";
      preview.addEventListener("click", () => openTextPreview(url, attachment.fileName));
      card.append(preview);
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
  if (state.displayMode === "json") return JSON.stringify(message, null, 2);
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

function jobForResponse(response) {
  return state.jobs.find((job) => job.responseMessageId === response.id);
}

function executionStatus(response) {
  return jobForResponse(response)?.status || "not_started";
}

function executionClass(response) {
  const status = executionStatus(response);
  if (status === "succeeded") return "green";
  if (status === "failed") return "red";
  if (status === "running") return "blue";
  if (status === "partial") return "yellow";
  if (status === "cancelled" || status === "not_started") return "gray";
  return "white";
}

function formatStatus(status) {
  return String(status).replace(/_/g, " ").replace(/^\w/, (match) => match.toUpperCase());
}

function appendStatusLine(parent, label, status, className) {
  const line = document.createElement("div");
  const square = document.createElement("span");
  square.className = `sq inline-sq ${className}`;
  line.append(`${label}: `, square, ` ${formatStatus(status)}`);
  parent.append(line);
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
  const text = `${response.createdAt} ${response.kind} ${projectHint(response)} ${decisionStatus(response)} ${executionStatus(response)} ${response.content} ${JSON.stringify(response.metadata || {})}`.toLowerCase();
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
  const files = selectedFiles();
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
    mode: state.requestMode,
    text,
    attachmentUploadIds
  });
  els.prompt.value = "";
  els.promptEditorText.value = "";
  els.promptEditor.hidden = true;
  els.fileInput.value = "";
  state.pendingFiles = [];
  els.uploadInspector.hidden = true;
  updateSelectedFileNotice();
}

async function uploadSelectedFiles() {
  const files = selectedFiles();
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

function selectedFiles() {
  return state.pendingFiles;
}

function setSelectedFiles(files) {
  state.pendingFiles = files;
  els.fileInput.value = "";
  updateSelectedFileNotice();
  renderUploadInspector();
}

function clearSelectedFiles() {
  els.fileInput.value = "";
  state.pendingFiles = [];
  updateSelectedFileNotice();
  renderUploadInspector();
  els.uploadInspector.hidden = true;
}

function removeSelectedFile(indexToRemove) {
  setSelectedFiles(selectedFiles().filter((_file, index) => index !== indexToRemove));
}

function updateSelectedFileNotice() {
  const files = selectedFiles();
  els.fileNotice.textContent = files.length ? `${files.length} file(s) ready to upload` : "";
  els.fileNotice.classList.toggle("has-files", files.length > 0);
}

function renderUploadInspector() {
  els.uploadInspectorList.replaceChildren();
  const files = selectedFiles();
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "attachment-empty";
    empty.textContent = "No files selected.";
    els.uploadInspectorList.append(empty);
    return;
  }
  for (const [index, file] of files.entries()) {
    const row = document.createElement("div");
    row.className = "upload-row";
    const details = document.createElement("div");
    const name = document.createElement("div");
    name.className = "upload-name";
    name.textContent = file.name;
    const meta = document.createElement("div");
    meta.className = "upload-meta";
    meta.textContent = `${fileExt(file.name) || "no extension"} / ${kb(file.size)}`;
    details.append(name, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeSelectedFile(index));
    row.append(details, remove);
    els.uploadInspectorList.append(row);
  }
}

function openUploadInspector() {
  if (!selectedFiles().length) return;
  renderUploadInspector();
  els.uploadInspector.hidden = false;
}

for (const button of els.themeButtons) button.addEventListener("click", () => setTheme(button.dataset.theme));
for (const input of [els.customBgColor, els.customFieldColor, els.customTextColor, els.customLineColor]) {
  input.addEventListener("input", () => {
    applyCustomTheme();
    setTheme("theme-custom");
  });
}
for (const button of els.modeButtons) button.addEventListener("click", () => setRequestMode(button.dataset.mode));
for (const button of els.displayButtons) button.addEventListener("click", () => toggleDisplayMode(button.dataset.display));
els.conversationSelect.addEventListener("change", () => openConversation(els.conversationSelect.value));
els.newConversationBtn.addEventListener("click", () => send({ type: "conversation_create", title: "ProjectEGO Workbench" }));
els.showArchivedBtn.addEventListener("click", () => {
  state.showArchived = !state.showArchived;
  renderHeader();
  requestConversationList();
});
els.renameConversationBtn.addEventListener("click", openRenameDialog);
els.archiveConversationBtn.addEventListener("click", () => {
  if (state.currentConversationId) send({ type: "conversation_archive", conversationId: state.currentConversationId });
});
els.unarchiveConversationBtn.addEventListener("click", () => {
  if (state.currentConversationId) send({ type: "conversation_unarchive", conversationId: state.currentConversationId });
});
els.deleteConversationBtn.addEventListener("click", openDeleteStepOne);
els.renameDialog.addEventListener("submit", (event) => {
  event.preventDefault();
  applyRename();
});
els.cancelRenameBtn.addEventListener("click", closeRenameDialog);
els.renameOverlay.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeRenameDialog();
});
els.deleteUnderstoodBtn.addEventListener("click", openDeleteStepTwo);
els.deleteCancelOneBtn.addEventListener("click", closeDeleteDialogs);
els.deleteCancelTwoBtn.addEventListener("click", closeDeleteDialogs);
els.deleteConsequencesCheck.addEventListener("change", () => {
  els.deleteConfirmBtn.disabled = !els.deleteConsequencesCheck.checked;
});
els.deleteConfirmBtn.addEventListener("click", confirmDeleteWorkbench);
els.requestSearch.addEventListener("input", renderRequests);
els.responseSearch.addEventListener("input", renderResponses);
els.sendBtn.addEventListener("click", sendCurrentRequest);
els.openEditorBtn.addEventListener("click", () => openPromptEditor());
els.closeEditorBtn.addEventListener("click", closePromptEditor);
els.fileNotice.addEventListener("click", openUploadInspector);
els.closeUploadInspectorBtn.addEventListener("click", () => {
  els.uploadInspector.hidden = true;
});
els.clearUploadsBtn.addEventListener("click", clearSelectedFiles);
els.closeImageViewerBtn.addEventListener("click", closeImageViewer);
els.closeMediaViewerBtn.addEventListener("click", closeMediaViewer);
els.imageViewerImg.draggable = false;
els.imageViewerImg.addEventListener("dragstart", (event) => event.preventDefault());
els.imageViewerBody.addEventListener("dragstart", (event) => event.preventDefault());
els.imageViewerBody.addEventListener("wheel", (event) => {
  if (els.imageViewer.hidden) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 0.12 : -0.12;
  setImageZoom(state.imageZoom + delta);
});
els.imageViewerBody.addEventListener("pointerdown", (event) => {
  if (els.imageViewer.hidden || event.button !== 0) return;
  event.preventDefault();
  state.imageDragging = { x: event.clientX, y: event.clientY, panX: state.imagePanX, panY: state.imagePanY };
  document.body.classList.add("no-text-select");
  els.imageViewerBody.classList.add("dragging");
  els.imageViewerBody.setPointerCapture(event.pointerId);
});
els.imageViewerBody.addEventListener("pointermove", (event) => {
  if (!state.imageDragging) return;
  state.imagePanX = state.imageDragging.panX + event.clientX - state.imageDragging.x;
  state.imagePanY = state.imageDragging.panY + event.clientY - state.imageDragging.y;
  updateImageTransform();
});
els.imageViewerBody.addEventListener("pointerup", () => {
  state.imageDragging = null;
  document.body.classList.remove("no-text-select");
  els.imageViewerBody.classList.remove("dragging");
});
els.imageViewerBody.addEventListener("pointercancel", () => {
  state.imageDragging = null;
  document.body.classList.remove("no-text-select");
  els.imageViewerBody.classList.remove("dragging");
});
els.closeTextPreviewBtn.addEventListener("click", closeTextPreview);
els.prompt.addEventListener("input", () => {
  syncEditorFromPrompt();
  maybeOpenPromptEditor();
});
els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) sendCurrentRequest();
});
els.promptEditorText.addEventListener("input", syncPromptFromEditor);
els.promptEditorText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) sendCurrentRequest();
  if (event.key === "Escape") closePromptEditor();
});
els.fileInput.addEventListener("change", async () => {
  const incomingFiles = Array.from(els.fileInput.files || []);
  if (!incomingFiles.length) return;
  for (const file of incomingFiles) {
    if (!/\.(txt|md|mp3|mp4|jpg|png|svg)$/i.test(file.name)) {
      els.fileNotice.textContent = "Supported: .txt, .md, .mp3, .mp4, .jpg, .png, .svg";
      els.fileNotice.classList.remove("has-files");
      els.fileInput.value = "";
      renderUploadInspector();
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      els.fileNotice.textContent = "Attachment limit is 25 MB per file.";
      els.fileNotice.classList.remove("has-files");
      els.fileInput.value = "";
      renderUploadInspector();
      return;
    }
  }
  setSelectedFiles([...selectedFiles(), ...incomingFiles]);
  renderUploadInspector();
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
loadThemeSettings();
wireDraggableWindow(els.promptEditor, els.promptEditorHeader, els.closeEditorBtn);
wireDraggableWindow(els.uploadInspector, els.uploadInspectorHeader, els.closeUploadInspectorBtn);
wireDraggableWindow(els.imageViewer, els.imageViewerHeader, els.closeImageViewerBtn);
wireDraggableWindow(els.mediaViewer, els.mediaViewerHeader, els.closeMediaViewerBtn);
wireDraggableWindow(els.textPreview, els.textPreviewHeader, els.closeTextPreviewBtn);
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
  state.jobs = [];
  setConnected(false);
  showAuth("Logged out.");
});

bootAuth();
