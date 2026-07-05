const state = {
  user: null,
  projects: [],
  epics: [],
  tasks: [],
  board: null,
  columns: [],
  boardTasks: [],
  activeProjectId: null,
  activeEpicId: null,
  activeTask: null,
  ws: null,
  shouldReconnect: true
};

const $ = (id) => document.getElementById(id);

const els = {
  identityLine: $("identityLine"),
  healthDot: $("healthDot"),
  healthText: $("healthText"),
  wsDot: $("wsDot"),
  wsText: $("wsText"),
  errorBanner: $("errorBanner"),
  includeArchived: $("includeArchived"),
  projectForm: $("projectForm"),
  projectKey: $("projectKey"),
  projectName: $("projectName"),
  projectDescription: $("projectDescription"),
  projectList: $("projectList"),
  activeProjectName: $("activeProjectName"),
  activeProjectMeta: $("activeProjectMeta"),
  refreshBtn: $("refreshBtn"),
  archiveProjectBtn: $("archiveProjectBtn"),
  epicForm: $("epicForm"),
  epicTitle: $("epicTitle"),
  epicList: $("epicList"),
  taskForm: $("taskForm"),
  taskTitle: $("taskTitle"),
  taskPriority: $("taskPriority"),
  taskList: $("taskList"),
  activeBoardLine: $("activeBoardLine"),
  ensureBoardBtn: $("ensureBoardBtn"),
  kanbanBoard: $("kanbanBoard"),
  statusFilter: $("statusFilter"),
  priorityFilter: $("priorityFilter"),
  taskDrawer: $("taskDrawer"),
  closeDrawerBtn: $("closeDrawerBtn"),
  drawerTitle: $("drawerTitle"),
  drawerMeta: $("drawerMeta"),
  taskEditForm: $("taskEditForm"),
  editTaskTitle: $("editTaskTitle"),
  editTaskStatus: $("editTaskStatus"),
  editTaskPriority: $("editTaskPriority"),
  editTaskDescription: $("editTaskDescription")
};

function setError(message) {
  els.errorBanner.hidden = !message;
  els.errorBanner.textContent = message || "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function refreshHealth() {
  try {
    const health = await api("/health", { headers: {} });
    els.healthDot.className = `dot ${health.status === "ok" ? "green" : "yellow"}`;
    els.healthText.textContent = `${health.status}${health.databaseReachable ? "" : " / db unavailable"}`;
  } catch (error) {
    els.healthDot.className = "dot red";
    els.healthText.textContent = error.message;
  }
}

async function loadIdentity() {
  const { user } = await api("/api/pm/me");
  state.user = user;
  els.identityLine.textContent = `${user.displayName || user.username} / ${user.email || "no email"}`;
}

async function loadProjects() {
  const { projects } = await api(`/api/pm/projects?includeArchived=${els.includeArchived.checked ? "true" : "false"}`);
  state.projects = projects;
  if (!state.activeProjectId && projects[0]) state.activeProjectId = projects[0].id;
  if (state.activeProjectId && !projects.some((project) => project.id === state.activeProjectId)) {
    state.activeProjectId = projects[0]?.id || null;
  }
  renderProjects();
  await loadProjectData();
}

async function loadProjectData() {
  const project = activeProject();
  els.archiveProjectBtn.disabled = !project;
  els.ensureBoardBtn.disabled = !project;
  els.epicForm.querySelector("button").disabled = !project;
  els.taskForm.querySelector("button").disabled = !project;
  if (!project) {
    state.epics = [];
    state.tasks = [];
    state.board = null;
    state.columns = [];
    state.boardTasks = [];
    renderActiveProject();
    renderEpics();
    renderTasks();
    renderBoard();
    return;
  }
  const [epicsBody, tasksBody, boardBody] = await Promise.all([
    api(`/api/pm/projects/${project.id}/epics`),
    api(`/api/pm/projects/${project.id}/tasks`),
    ensureDefaultBoard(project.id)
  ]);
  state.epics = epicsBody.epics;
  state.tasks = tasksBody.tasks;
  state.board = boardBody.board;
  state.columns = boardBody.columns;
  await loadBoardSnapshot();
  renderActiveProject();
  renderEpics();
  renderTasks();
  renderBoard();
}

async function ensureDefaultBoard(projectId) {
  return api(`/api/pm/projects/${projectId}/boards/kanban/default`, {
    method: "POST",
    body: JSON.stringify({ epicId: state.activeEpicId || undefined })
  });
}

async function loadBoardSnapshot() {
  if (!state.board) {
    state.boardTasks = [];
    return;
  }
  const snapshot = await api(`/api/pm/boards/${state.board.id}`);
  state.board = snapshot.board;
  state.columns = snapshot.columns;
  state.boardTasks = snapshot.tasks;
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function renderProjects() {
  els.projectList.replaceChildren(
    ...state.projects.map((project) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `project-card ${project.id === state.activeProjectId ? "active" : ""}`;
      button.innerHTML = `
        <div class="card-title">${escapeHtml(project.key)} / ${escapeHtml(project.name)}${project.archivedAt ? " / archived" : ""}</div>
        <div class="card-meta">role: ${escapeHtml(project.role || "viewer")} / v${project.version}</div>
        <div class="card-body">${escapeHtml(project.description || "")}</div>
      `;
      button.addEventListener("click", async () => {
        state.activeProjectId = project.id;
        state.activeEpicId = null;
        await loadProjectData();
      });
      return button;
    })
  );
}

function renderActiveProject() {
  const project = activeProject();
  if (!project) {
    els.activeProjectName.textContent = "No project selected";
    els.activeProjectMeta.textContent = "Create or select a project.";
    return;
  }
  els.activeProjectName.textContent = `${project.key} / ${project.name}`;
  els.activeProjectMeta.textContent = `role: ${project.role || "viewer"} / version ${project.version} / updated ${formatDate(project.updatedAt)}`;
  els.archiveProjectBtn.textContent = project.archivedAt ? "Unarchive" : "Archive";
}

function renderEpics() {
  els.epicList.replaceChildren(
    ...state.epics.map((epic) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `epic-card ${epic.id === state.activeEpicId ? "active" : ""}`;
      button.innerHTML = `<div class="card-title">${escapeHtml(epic.title)}</div><div class="card-meta">${escapeHtml(epic.status)} / ${escapeHtml(epic.priority)}</div>`;
      button.addEventListener("click", async () => {
        state.activeEpicId = state.activeEpicId === epic.id ? null : epic.id;
        await loadProjectData();
      });
      return button;
    })
  );
}

function renderTasks() {
  const statusFilter = els.statusFilter.value;
  const priorityFilter = els.priorityFilter.value;
  const tasks = state.tasks.filter((task) => {
    if (state.activeEpicId && task.epicId !== state.activeEpicId) return false;
    if (statusFilter && task.status !== statusFilter) return false;
    if (priorityFilter && task.priority !== priorityFilter) return false;
    return true;
  });
  els.taskList.replaceChildren(
    ...tasks.map((task) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `task-card ${state.activeTask?.id === task.id ? "active" : ""}`;
      button.innerHTML = `
        <div>
          <div class="card-title">${escapeHtml(task.title)}</div>
          <div class="card-body">${escapeHtml(task.description || "")}</div>
          <div class="card-meta">${escapeHtml(task.id)} / v${task.version}</div>
        </div>
        <div class="task-badges">
          <span class="badge">${escapeHtml(task.status)}</span>
          <span class="badge">${escapeHtml(task.priority)}</span>
        </div>
      `;
      button.addEventListener("click", () => openTask(task));
      return button;
    })
  );
}

function renderBoard() {
  if (!state.board) {
    els.activeBoardLine.textContent = "No board";
    els.kanbanBoard.replaceChildren();
    return;
  }
  els.activeBoardLine.textContent = `${state.board.name} / ${state.columns.length} columns`;
  const statusFilter = els.statusFilter.value;
  const priorityFilter = els.priorityFilter.value;
  els.kanbanBoard.replaceChildren(
    ...state.columns.map((column) => {
      const columnEl = document.createElement("section");
      columnEl.className = "kanban-column";
      columnEl.dataset.columnId = column.id;
      columnEl.dataset.statusKey = column.statusKey;
      columnEl.innerHTML = `
        <header>
          <span>${escapeHtml(column.name)}</span>
          <span>${state.boardTasks.filter((task) => task.columnId === column.id || (!task.columnId && task.status === column.statusKey)).length}</span>
        </header>
        <div class="kanban-dropzone"></div>
      `;
      const dropzone = columnEl.querySelector(".kanban-dropzone");
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        columnEl.classList.add("drag-over");
      });
      dropzone.addEventListener("dragleave", () => columnEl.classList.remove("drag-over"));
      dropzone.addEventListener("drop", (event) => handleTaskDrop(event, column).catch((error) => setError(error.message)));
      const tasks = state.boardTasks
        .filter((task) => (task.columnId === column.id || (!task.columnId && task.status === column.statusKey)))
        .filter((task) => !state.activeEpicId || task.epicId === state.activeEpicId)
        .filter((task) => !statusFilter || task.status === statusFilter)
        .filter((task) => !priorityFilter || task.priority === priorityFilter)
        .sort((a, b) => (a.boardPosition ?? 1000000000) - (b.boardPosition ?? 1000000000));
      dropzone.replaceChildren(...tasks.map(renderKanbanCard));
      return columnEl;
    })
  );
}

function renderKanbanCard(task) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "kanban-card";
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.innerHTML = `
    <div class="card-title">${escapeHtml(task.title)}</div>
    <div class="card-meta">${escapeHtml(task.priority)} / v${task.version}</div>
    <div class="card-body">${escapeHtml(task.description || "")}</div>
  `;
  card.addEventListener("click", () => openTask(task));
  card.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  return card;
}

async function handleTaskDrop(event, column) {
  event.preventDefault();
  const taskId = event.dataTransfer.getData("text/plain");
  const task = state.boardTasks.find((item) => item.id === taskId);
  if (!task || !state.board) return;
  const siblings = state.boardTasks.filter((item) => item.columnId === column.id || (!item.columnId && item.status === column.statusKey));
  const maxPosition = siblings.reduce((max, item) => Math.max(max, item.boardPosition ?? 0), 0);
  const { task: movedTask } = await api(`/api/pm/tasks/${task.id}/move`, {
    method: "POST",
    body: JSON.stringify({
      boardId: state.board.id,
      columnId: column.id,
      status: column.statusKey,
      position: maxPosition + 1000,
      expectedVersion: task.version
    })
  });
  setError("");
  await loadProjectData();
  openTask(movedTask);
}

function openTask(task) {
  state.activeTask = task;
  els.taskDrawer.hidden = false;
  els.drawerTitle.textContent = task.title;
  els.drawerMeta.textContent = `${task.id} / version ${task.version}`;
  els.editTaskTitle.value = task.title;
  els.editTaskStatus.value = task.status;
  els.editTaskPriority.value = task.priority;
  els.editTaskDescription.value = task.description || "";
  renderTasks();
}

function closeTask() {
  state.activeTask = null;
  els.taskDrawer.hidden = true;
  renderTasks();
}

async function createProject(event) {
  event.preventDefault();
  setError("");
  const project = await api("/api/pm/projects", {
    method: "POST",
    body: JSON.stringify({
      key: els.projectKey.value,
      name: els.projectName.value,
      description: els.projectDescription.value
    })
  });
  els.projectForm.reset();
  state.activeProjectId = project.project.id;
  await loadProjects();
}

async function createEpic(event) {
  event.preventDefault();
  const project = activeProject();
  if (!project) return;
  const { epic } = await api(`/api/pm/projects/${project.id}/epics`, {
    method: "POST",
    body: JSON.stringify({ title: els.epicTitle.value })
  });
  els.epicForm.reset();
  state.activeEpicId = epic.id;
  await loadProjectData();
}

async function createTask(event) {
  event.preventDefault();
  const project = activeProject();
  if (!project) return;
  let { task } = await api(`/api/pm/projects/${project.id}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: els.taskTitle.value,
      priority: els.taskPriority.value,
      epicId: state.activeEpicId || undefined
    })
  });
  els.taskForm.reset();
  els.taskPriority.value = "medium";
  if (state.board) {
    const todoColumn = state.columns.find((column) => column.statusKey === "todo") || state.columns[0];
    if (todoColumn) {
      const moved = await api(`/api/pm/tasks/${task.id}/move`, {
        method: "POST",
        body: JSON.stringify({
          boardId: state.board.id,
          columnId: todoColumn.id,
          status: todoColumn.statusKey,
          position: Date.now(),
          expectedVersion: task.version
        })
      });
      task = moved.task;
    }
  }
  await loadProjectData();
  openTask(task);
}

async function saveTask(event) {
  event.preventDefault();
  if (!state.activeTask) return;
  const { task } = await api(`/api/pm/tasks/${state.activeTask.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: els.editTaskTitle.value,
      status: els.editTaskStatus.value,
      priority: els.editTaskPriority.value,
      description: els.editTaskDescription.value,
      expectedVersion: state.activeTask.version
    })
  });
  await loadProjectData();
  openTask(task);
}

async function toggleArchive() {
  const project = activeProject();
  if (!project) return;
  await api(`/api/pm/projects/${project.id}/archive`, {
    method: "POST",
    body: JSON.stringify({ archived: !project.archivedAt })
  });
  await loadProjects();
}

function connectWs() {
  if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/pm/ws`);
  state.ws = ws;
  ws.addEventListener("open", () => {
    els.wsDot.className = "dot green";
    els.wsText.textContent = "ws connected";
  });
  ws.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type && message.type !== "presence.updated") await loadProjects();
  });
  ws.addEventListener("close", () => {
    els.wsDot.className = "dot red";
    els.wsText.textContent = "ws disconnected";
    if (state.shouldReconnect) setTimeout(connectWs, 1500);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "unknown";
}

async function boot() {
  try {
    await refreshHealth();
    await loadIdentity();
    await loadProjects();
    connectWs();
    setInterval(refreshHealth, 15000);
  } catch (error) {
    setError(error.message);
  }
}

els.projectForm.addEventListener("submit", (event) => createProject(event).catch((error) => setError(error.message)));
els.epicForm.addEventListener("submit", (event) => createEpic(event).catch((error) => setError(error.message)));
els.taskForm.addEventListener("submit", (event) => createTask(event).catch((error) => setError(error.message)));
els.taskEditForm.addEventListener("submit", (event) => saveTask(event).catch((error) => setError(error.message)));
els.includeArchived.addEventListener("change", () => loadProjects().catch((error) => setError(error.message)));
els.refreshBtn.addEventListener("click", () => loadProjects().catch((error) => setError(error.message)));
els.archiveProjectBtn.addEventListener("click", () => toggleArchive().catch((error) => setError(error.message)));
els.ensureBoardBtn.addEventListener("click", () => loadProjectData().catch((error) => setError(error.message)));
els.closeDrawerBtn.addEventListener("click", closeTask);
els.statusFilter.addEventListener("change", () => {
  renderTasks();
  renderBoard();
});
els.priorityFilter.addEventListener("change", () => {
  renderTasks();
  renderBoard();
});

boot();
