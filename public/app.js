const state = {
  ws: null,
  connected: false,
  latestJobId: "latest",
  items: []
};

const els = {
  statusBadge: document.getElementById("statusBadge"),
  userLine: document.getElementById("userLine"),
  prompt: document.getElementById("prompt"),
  fileInput: document.getElementById("fileInput"),
  fileNotice: document.getElementById("fileNotice"),
  digestBtn: document.getElementById("digestBtn"),
  tasksBtn: document.getElementById("tasksBtn"),
  applyAllBtn: document.getElementById("applyAllBtn"),
  applySelectedBtn: document.getElementById("applySelectedBtn"),
  showUnclarifiedBtn: document.getElementById("showUnclarifiedBtn"),
  liveOutput: document.getElementById("liveOutput"),
  draftPreview: document.getElementById("draftPreview"),
  itemsList: document.getElementById("itemsList"),
  debugOutput: document.getElementById("debugOutput")
};

function append(pre, text) {
  pre.textContent += text;
  pre.scrollTop = pre.scrollHeight;
}

function setConnected(value) {
  state.connected = value;
  els.statusBadge.textContent = value ? "online" : "offline";
  els.statusBadge.className = `badge ${value ? "badge-online" : "badge-offline"}`;
  for (const button of [els.digestBtn, els.tasksBtn, els.applyAllBtn, els.applySelectedBtn, els.showUnclarifiedBtn]) {
    button.disabled = !value;
  }
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.ws = ws;

  ws.addEventListener("open", () => setConnected(true));
  ws.addEventListener("close", () => {
    setConnected(false);
    els.userLine.textContent = "Disconnected. Reconnecting...";
    window.setTimeout(connect, 1500);
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    append(els.debugOutput, `${JSON.stringify(message, null, 2)}\n\n`);
    handleServerMessage(message);
  });
}

function handleServerMessage(message) {
  if (message.type === "connected") {
    els.userLine.textContent = `Connected as ${message.user.username}${message.user.email ? ` <${message.user.email}>` : ""}`;
  }
  if (message.type === "status") append(els.liveOutput, `[status] ${message.message}\n`);
  if (message.type === "token") append(els.liveOutput, message.text);
  if (message.type === "draft_saved") {
    state.latestJobId = message.jobId;
    els.draftPreview.textContent = message.preview;
    append(els.liveOutput, `\n[draft_saved] ${message.jobId} (${message.itemsCount} items)\n`);
  }
  if (message.type === "draft_result") {
    state.items = message.result.items || [];
    renderItems();
  }
  if (message.type === "apply_result") {
    append(
      els.liveOutput,
      `\n[apply_result] applied=${message.appliedCount} kept=${message.keptCount} dropped=${message.droppedCount}. ${message.message}\n`
    );
  }
  if (message.type === "unclarified_index") {
    els.draftPreview.textContent = message.text;
  }
  if (message.type === "error") {
    append(els.liveOutput, `\n[error] ${message.message}${message.details ? `: ${message.details}` : ""}\n`);
  }
}

function send(message) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(message));
}

function sendPrompt(type) {
  els.liveOutput.textContent = "";
  els.debugOutput.textContent = "";
  send({ type, text: els.prompt.value, fileName: els.fileInput.files[0]?.name });
}

function renderItems() {
  els.itemsList.replaceChildren();
  state.items.forEach((item, index) => {
    const number = index + 1;
    const wrapper = document.createElement("div");
    wrapper.className = "item";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = `#${String(number).padStart(3, "0")} ${item.title}`;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `${item.project} / ${item.module} / ${item.type} / ${item.priority}`;

    const choices = document.createElement("div");
    choices.className = "choices";
    for (const choice of ["apply", "keep", "drop"]) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.item = String(number);
      checkbox.dataset.choice = choice;
      label.append(checkbox, choice);
      choices.append(label);
    }

    wrapper.append(title, meta, choices);
    els.itemsList.append(wrapper);
  });
}

function selectedExpression() {
  const groups = { apply: [], keep: [], drop: [] };
  for (const checkbox of els.itemsList.querySelectorAll("input[type=checkbox]:checked")) {
    groups[checkbox.dataset.choice].push(Number(checkbox.dataset.item));
  }
  const parts = [];
  if (groups.apply.length) parts.push(groups.apply.join(","));
  if (groups.keep.length) parts.push("keep", groups.keep.join(","));
  if (groups.drop.length) parts.push("drop", groups.drop.join(","));
  return parts.length ? parts.join(" ") : "all";
}

els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  els.fileNotice.textContent = "";
  if (!file) return;
  if (!/\.(txt|md)$/i.test(file.name)) {
    els.fileNotice.textContent = "Only .txt and .md files are accepted.";
    els.fileInput.value = "";
    return;
  }
  if (file.size > 256_000) {
    els.fileNotice.textContent = "File is large; only reasonably sized MVP inputs are supported.";
  }
  els.prompt.value = await file.text();
});

els.digestBtn.addEventListener("click", () => sendPrompt("digest"));
els.tasksBtn.addEventListener("click", () => sendPrompt("tasks"));
els.applyAllBtn.addEventListener("click", () => send({ type: "apply", jobId: state.latestJobId, expression: "all" }));
els.applySelectedBtn.addEventListener("click", () => send({ type: "apply", jobId: state.latestJobId, expression: selectedExpression() }));
els.showUnclarifiedBtn.addEventListener("click", () => send({ type: "show_unclarified" }));

setConnected(false);
connect();
