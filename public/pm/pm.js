const state = {
  user: null,
  projects: [],
  members: [],
  labels: [],
  epics: [],
  sprints: [],
  tasks: [],
  board: null,
  columns: [],
  boardTasks: [],
  activeProjectId: null,
  activeEpicId: null,
  activeSprintId: "__backlog",
  activeTask: null,
  taskLabels: [],
  dependencies: { blockingTasks: [], blockedTasks: [] },
  comments: [],
  attachments: [],
  activity: [],
  notifications: [],
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
  notificationToggle: $("notificationToggle"),
  notificationCount: $("notificationCount"),
  notificationPanel: $("notificationPanel"),
  notificationList: $("notificationList"),
  markAllNotificationsReadBtn: $("markAllNotificationsReadBtn"),
  includeArchived: $("includeArchived"),
  projectForm: $("projectForm"),
  projectKey: $("projectKey"),
  projectName: $("projectName"),
  projectDescription: $("projectDescription"),
  memberForm: $("memberForm"),
  memberIdentifier: $("memberIdentifier"),
  memberRole: $("memberRole"),
  memberList: $("memberList"),
  labelForm: $("labelForm"),
  labelName: $("labelName"),
  labelColor: $("labelColor"),
  labelList: $("labelList"),
  projectList: $("projectList"),
  activeProjectName: $("activeProjectName"),
  activeProjectMeta: $("activeProjectMeta"),
  refreshBtn: $("refreshBtn"),
  archiveProjectBtn: $("archiveProjectBtn"),
  epicForm: $("epicForm"),
  epicTitle: $("epicTitle"),
  epicList: $("epicList"),
  sprintForm: $("sprintForm"),
  sprintName: $("sprintName"),
  includeCompletedSprints: $("includeCompletedSprints"),
  backlogFilterBtn: $("backlogFilterBtn"),
  allSprintTasksBtn: $("allSprintTasksBtn"),
  sprintList: $("sprintList"),
  taskForm: $("taskForm"),
  taskTitle: $("taskTitle"),
  taskPriority: $("taskPriority"),
  taskAssignee: $("taskAssignee"),
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
  editTaskAssignee: $("editTaskAssignee"),
  editTaskSprint: $("editTaskSprint"),
  editTaskDescription: $("editTaskDescription"),
  taskLabelForm: $("taskLabelForm"),
  taskLabelSelect: $("taskLabelSelect"),
  taskLabelList: $("taskLabelList"),
  dependencyForm: $("dependencyForm"),
  dependencyTask: $("dependencyTask"),
  dependencyList: $("dependencyList"),
  commentList: $("commentList"),
  commentForm: $("commentForm"),
  commentBody: $("commentBody"),
  attachmentForm: $("attachmentForm"),
  attachmentFile: $("attachmentFile"),
  attachmentList: $("attachmentList"),
  activityList: $("activityList")
};

function setError(message) {
  els.errorBanner.hidden = !message;
  els.errorBanner.textContent = message || "";
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "content-type": "application/json" }),
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
  await loadNotifications();
}

async function loadNotifications() {
  const { notifications } = await api("/api/pm/notifications");
  state.notifications = notifications;
  renderNotifications();
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
  els.memberForm.querySelector("button").disabled = !project;
  els.labelForm.querySelector("button").disabled = !project;
  els.epicForm.querySelector("button").disabled = !project;
  els.sprintForm.querySelector("button").disabled = !project;
  els.backlogFilterBtn.disabled = !project;
  els.allSprintTasksBtn.disabled = !project;
  els.taskForm.querySelector("button").disabled = !project;
  if (!project) {
    state.members = [];
    state.labels = [];
    state.epics = [];
    state.sprints = [];
    state.tasks = [];
    state.board = null;
    state.columns = [];
    state.boardTasks = [];
    renderActiveProject();
    renderMembers();
    renderProjectLabels();
    renderEpics();
    renderSprints();
    renderTasks();
    renderBoard();
    return;
  }
  const [membersBody, labelsBody, epicsBody, sprintsBody, tasksBody, boardBody] = await Promise.all([
    api(`/api/pm/projects/${project.id}/members`),
    api(`/api/pm/projects/${project.id}/labels`),
    api(`/api/pm/projects/${project.id}/epics`),
    api(`/api/pm/projects/${project.id}/sprints?includeCompleted=${els.includeCompletedSprints.checked ? "true" : "false"}${state.activeEpicId ? `&epicId=${encodeURIComponent(state.activeEpicId)}` : ""}`),
    api(`/api/pm/projects/${project.id}/tasks`),
    ensureDefaultBoard(project.id)
  ]);
  state.members = membersBody.members;
  state.labels = labelsBody.labels;
  state.epics = epicsBody.epics;
  state.sprints = sprintsBody.sprints;
  if (state.activeSprintId && !["__all", "__backlog"].includes(state.activeSprintId) && !state.sprints.some((sprint) => sprint.id === state.activeSprintId)) {
    state.activeSprintId = "__backlog";
  }
  state.tasks = tasksBody.tasks;
  state.board = boardBody.board;
  state.columns = boardBody.columns;
  await loadBoardSnapshot();
  renderActiveProject();
  renderMembers();
  renderProjectLabels();
  renderEpics();
  renderSprints();
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
        state.activeSprintId = "__backlog";
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

function renderMembers() {
  const options = [optionEl("", "unassigned"), ...state.members.map((member) => optionEl(member.id, memberLabel(member)))];
  els.taskAssignee.replaceChildren(...options.map((option) => option.cloneNode(true)));
  els.editTaskAssignee.replaceChildren(...options.map((option) => option.cloneNode(true)));
  if (state.members.length === 0) {
    els.memberList.innerHTML = `<div class="drawer-empty">No project selected.</div>`;
    return;
  }
  els.memberList.replaceChildren(
    ...state.members.map((member) => {
      const card = document.createElement("article");
      card.className = "member-card";
      card.innerHTML = `
        <div class="card-title">${escapeHtml(memberLabel(member))}</div>
        <div class="card-meta">${escapeHtml(member.email || member.id)}</div>
        <div class="member-actions">
          <select>
            <option value="viewer">viewer</option>
            <option value="member">member</option>
            <option value="project_owner">project owner</option>
          </select>
          <button class="mini-button" type="button">Remove</button>
        </div>
      `;
      const select = card.querySelector("select");
      select.value = member.role;
      select.addEventListener("change", () => updateMemberRole(member, select.value).catch((error) => setError(error.message)));
      card.querySelector("button").addEventListener("click", () => removeMember(member).catch((error) => setError(error.message)));
      return card;
    })
  );
}

function renderProjectLabels() {
  if (!els.labelList) return;
  if (state.labels.length === 0) {
    els.labelList.innerHTML = activeProject() ? `<div class="drawer-empty">No labels yet.</div>` : `<div class="drawer-empty">No project selected.</div>`;
    return;
  }
  els.labelList.replaceChildren(
    ...state.labels.map((label) => {
      const card = document.createElement("article");
      card.className = "label-card";
      card.innerHTML = `
        <div class="label-chip">
          <span class="label-swatch" style="background:${escapeHtml(label.color)}"></span>
          <span>${escapeHtml(label.name)}</span>
        </div>
        <div class="card-meta">${escapeHtml(label.color)}</div>
      `;
      return card;
    })
  );
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
        state.activeSprintId = "__backlog";
        await loadProjectData();
      });
      return button;
    })
  );
}

function renderSprints() {
  els.backlogFilterBtn.classList.toggle("active", state.activeSprintId === "__backlog");
  els.allSprintTasksBtn.classList.toggle("active", state.activeSprintId === "__all");
  els.editTaskSprint.replaceChildren(
    optionEl("", "Backlog"),
    ...state.sprints.map((sprint) => optionEl(sprint.id, `${sprint.name} / ${sprint.status}`))
  );
  if (state.sprints.length === 0) {
    els.sprintList.innerHTML = `<div class="drawer-empty">No sprints yet.</div>`;
    return;
  }
  els.sprintList.replaceChildren(
    ...state.sprints.map((sprint) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sprint-card ${state.activeSprintId === sprint.id ? "active" : ""}`;
      button.innerHTML = `
        <div class="card-title">${escapeHtml(sprint.name)}</div>
        <div class="card-meta">${escapeHtml(sprint.status)} / v${sprint.version}</div>
        <div class="card-body">${escapeHtml(formatSprintDates(sprint))}</div>
        <div class="sprint-actions">
          ${sprint.status !== "active" ? `<span class="badge" data-action="active">active</span>` : ""}
          ${sprint.status !== "completed" ? `<span class="badge" data-action="completed">complete</span>` : ""}
          ${sprint.status !== "cancelled" ? `<span class="badge" data-action="cancelled">cancel</span>` : ""}
        </div>
      `;
      button.addEventListener("click", async (event) => {
        const action = event.target?.dataset?.action;
        if (action) {
          event.stopPropagation();
          await updateSprintStatus(sprint, action);
          return;
        }
        state.activeSprintId = sprint.id;
        renderSprints();
        renderTasks();
        renderBoard();
      });
      return button;
    })
  );
}

function renderNotifications() {
  els.notificationCount.textContent = String(state.notifications.filter((notification) => !notification.readAt).length);
  if (state.notifications.length === 0) {
    els.notificationList.innerHTML = `<div class="drawer-empty">No unread notifications.</div>`;
    return;
  }
  els.notificationList.replaceChildren(
    ...state.notifications.map((notification) => {
      const card = document.createElement("article");
      card.className = `notification-card ${notification.readAt ? "" : "unread"}`;
      card.innerHTML = `
        <div class="card-title">
          <span>${escapeHtml(notification.title)}</span>
          <button class="mini-button" type="button">Read</button>
        </div>
        <div class="card-meta">${escapeHtml(notification.actorName || notification.eventType)} / ${formatDate(notification.createdAt)}</div>
        <div class="card-body">${escapeHtml(notification.body)}</div>
      `;
      card.querySelector("button").addEventListener("click", () => markNotificationRead(notification).catch((error) => setError(error.message)));
      card.addEventListener("click", async (event) => {
        if (event.target.tagName === "BUTTON") return;
        if (notification.projectId) state.activeProjectId = notification.projectId;
        state.activeSprintId = "__all";
        await loadProjectData();
        const task = notification.taskId ? state.tasks.find((item) => item.id === notification.taskId) : null;
        if (task) openTask(task);
      });
      return card;
    })
  );
}

function renderTasks() {
  const statusFilter = els.statusFilter.value;
  const priorityFilter = els.priorityFilter.value;
  const tasks = state.tasks.filter((task) => {
    if (state.activeEpicId && task.epicId !== state.activeEpicId) return false;
    if (state.activeSprintId === "__backlog" && task.sprintId) return false;
    if (!["__all", "__backlog"].includes(state.activeSprintId) && task.sprintId !== state.activeSprintId) return false;
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
          <div class="card-meta">${escapeHtml(task.id)} / ${escapeHtml(sprintLabel(task.sprintId))} / v${task.version}</div>
        </div>
        <div class="task-badges">
          <span class="badge">${escapeHtml(task.status)}</span>
          <span class="badge">${escapeHtml(task.priority)}</span>
          <span class="badge">${escapeHtml(assigneeLabel(task.assigneeId))}</span>
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
        .filter((task) => state.activeSprintId !== "__backlog" || !task.sprintId)
        .filter((task) => ["__all", "__backlog"].includes(state.activeSprintId) || task.sprintId === state.activeSprintId)
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
    <div class="card-meta">${escapeHtml(task.priority)} / ${escapeHtml(assigneeLabel(task.assigneeId))} / ${escapeHtml(sprintLabel(task.sprintId))} / v${task.version}</div>
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
  els.editTaskAssignee.value = task.assigneeId || "";
  els.editTaskSprint.value = task.sprintId || "";
  els.editTaskDescription.value = task.description || "";
  state.comments = [];
  state.taskLabels = [];
  state.dependencies = { blockingTasks: [], blockedTasks: [] };
  state.attachments = [];
  state.activity = [];
  renderDrawerData();
  renderTasks();
  loadTaskDrawerData(task.id).catch((error) => setError(error.message));
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

async function addMember(event) {
  event.preventDefault();
  const project = activeProject();
  if (!project) return;
  await api(`/api/pm/projects/${project.id}/members`, {
    method: "POST",
    body: JSON.stringify({
      identifier: els.memberIdentifier.value,
      role: els.memberRole.value
    })
  });
  els.memberForm.reset();
  els.memberRole.value = "member";
  await loadProjectData();
}

async function updateMemberRole(member, role) {
  const project = activeProject();
  if (!project) return;
  await api(`/api/pm/projects/${project.id}/members/${member.id}`, {
    method: "PUT",
    body: JSON.stringify({ role })
  });
  await loadProjectData();
}

async function removeMember(member) {
  const project = activeProject();
  if (!project) return;
  await api(`/api/pm/projects/${project.id}/members/${member.id}`, { method: "DELETE" });
  await loadProjectData();
}

async function createLabel(event) {
  event.preventDefault();
  const project = activeProject();
  if (!project) return;
  const { label } = await api(`/api/pm/projects/${project.id}/labels`, {
    method: "POST",
    body: JSON.stringify({
      name: els.labelName.value,
      color: els.labelColor.value
    })
  });
  els.labelForm.reset();
  els.labelColor.value = "#6b7280";
  state.labels = [...state.labels.filter((item) => item.id !== label.id), label].sort((a, b) => a.name.localeCompare(b.name));
  renderProjectLabels();
  renderTaskLabels();
}

async function createSprint(event) {
  event.preventDefault();
  const project = activeProject();
  if (!project) return;
  const { sprint } = await api(`/api/pm/projects/${project.id}/sprints`, {
    method: "POST",
    body: JSON.stringify({
      name: els.sprintName.value,
      epicId: state.activeEpicId || undefined
    })
  });
  els.sprintForm.reset();
  state.activeSprintId = sprint.id;
  await loadProjectData();
}

async function updateSprintStatus(sprint, status) {
  const { sprint: updated } = await api(`/api/pm/sprints/${sprint.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, expectedVersion: sprint.version })
  });
  state.activeSprintId = updated.id;
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
      assigneeId: els.taskAssignee.value || undefined,
      epicId: state.activeEpicId || undefined,
      sprintId: selectedSprintIdForNewTask()
    })
  });
  els.taskForm.reset();
  els.taskPriority.value = "medium";
  els.taskAssignee.value = "";
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
  const desiredSprintId = els.editTaskSprint.value || "";
  const desiredAssigneeId = els.editTaskAssignee.value || "";
  let { task } = await api(`/api/pm/tasks/${state.activeTask.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: els.editTaskTitle.value,
      status: els.editTaskStatus.value,
      priority: els.editTaskPriority.value,
      description: els.editTaskDescription.value,
      expectedVersion: state.activeTask.version
    })
  });
  if ((task.sprintId || "") !== desiredSprintId) {
    const assigned = await api(`/api/pm/tasks/${task.id}/sprint`, {
      method: "POST",
      body: JSON.stringify({ sprintId: desiredSprintId || undefined })
    });
    task = assigned.task;
  }
  if ((task.assigneeId || "") !== desiredAssigneeId) {
    const assigned = await api(`/api/pm/tasks/${task.id}/assignee`, {
      method: "POST",
      body: JSON.stringify({ assigneeId: desiredAssigneeId || undefined })
    });
    task = assigned.task;
  }
  await loadProjectData();
  openTask(task);
}

async function addDependency(event) {
  event.preventDefault();
  if (!state.activeTask || !els.dependencyTask.value) return;
  await api(`/api/pm/tasks/${state.activeTask.id}/dependencies`, {
    method: "POST",
    body: JSON.stringify({ blockingTaskId: els.dependencyTask.value })
  });
  els.dependencyForm.reset();
  await loadTaskDrawerData(state.activeTask.id);
}

async function addTaskLabel(event) {
  event.preventDefault();
  if (!state.activeTask || !els.taskLabelSelect.value) return;
  const { label } = await api(`/api/pm/tasks/${state.activeTask.id}/labels`, {
    method: "POST",
    body: JSON.stringify({ labelId: els.taskLabelSelect.value })
  });
  els.taskLabelForm.reset();
  state.taskLabels = [...state.taskLabels.filter((item) => item.id !== label.id), label].sort((a, b) => a.name.localeCompare(b.name));
  await reloadActivityForActiveTask();
  renderDrawerData();
}

async function removeTaskLabel(label) {
  if (!state.activeTask) return;
  await api(`/api/pm/tasks/${state.activeTask.id}/labels/${encodeURIComponent(label.id)}`, { method: "DELETE" });
  state.taskLabels = state.taskLabels.filter((item) => item.id !== label.id);
  await reloadActivityForActiveTask();
  renderDrawerData();
}

async function removeDependency(dependency) {
  if (!state.activeTask) return;
  await api(`/api/pm/tasks/${state.activeTask.id}/dependencies/${encodeURIComponent(dependency.blockingTaskId)}`, { method: "DELETE" });
  await loadTaskDrawerData(state.activeTask.id);
}

async function loadTaskDrawerData(taskId) {
  const [labelsBody, dependenciesBody, commentsBody, attachmentsBody, activityBody] = await Promise.all([
    api(`/api/pm/tasks/${taskId}/labels`),
    api(`/api/pm/tasks/${taskId}/dependencies`),
    api(`/api/pm/tasks/${taskId}/comments`),
    api(`/api/pm/tasks/${taskId}/attachments`),
    api(`/api/pm/tasks/${taskId}/activity`)
  ]);
  if (!state.activeTask || state.activeTask.id !== taskId) return;
  state.taskLabels = labelsBody.labels;
  state.dependencies = dependenciesBody;
  state.comments = commentsBody.comments;
  state.attachments = attachmentsBody.attachments;
  state.activity = activityBody.activity;
  renderDrawerData();
}

function renderDrawerData() {
  renderTaskLabels();
  renderDependencies();
  renderComments();
  renderAttachments();
  renderActivity();
}

function renderTaskLabels() {
  if (!els.taskLabelList || !els.taskLabelSelect) return;
  const selectedIds = new Set(state.taskLabels.map((label) => label.id));
  els.taskLabelSelect.replaceChildren(
    optionEl("", "Select label"),
    ...state.labels.filter((label) => !selectedIds.has(label.id)).map((label) => optionEl(label.id, label.name))
  );
  if (!state.activeTask) {
    els.taskLabelList.innerHTML = `<div class="drawer-empty">No task selected.</div>`;
    return;
  }
  if (state.taskLabels.length === 0) {
    els.taskLabelList.innerHTML = `<div class="drawer-empty">No labels.</div>`;
    return;
  }
  els.taskLabelList.replaceChildren(
    ...state.taskLabels.map((label) => {
      const chip = document.createElement("span");
      chip.className = "label-chip";
      chip.innerHTML = `
        <span class="label-swatch" style="background:${escapeHtml(label.color)}"></span>
        <span>${escapeHtml(label.name)}</span>
        <button class="mini-button" type="button">Remove</button>
      `;
      chip.querySelector("button").addEventListener("click", () => removeTaskLabel(label).catch((error) => setError(error.message)));
      return chip;
    })
  );
}

function renderDependencies() {
  if (!els.dependencyList || !els.dependencyTask) return;
  const activeTaskId = state.activeTask?.id;
  const blockingIds = new Set((state.dependencies.blockingTasks || []).map((item) => item.blockingTaskId));
  const options = [
    optionEl("", "Select blocking task"),
    ...state.tasks
      .filter((task) => task.id !== activeTaskId && !blockingIds.has(task.id))
      .map((task) => optionEl(task.id, `${task.title} / ${task.status}`))
  ];
  els.dependencyTask.replaceChildren(...options);
  if (!state.activeTask) {
    els.dependencyList.innerHTML = `<div class="drawer-empty">No task selected.</div>`;
    return;
  }
  const blockingTasks = state.dependencies.blockingTasks || [];
  const blockedTasks = state.dependencies.blockedTasks || [];
  if (blockingTasks.length === 0 && blockedTasks.length === 0) {
    els.dependencyList.innerHTML = `<div class="drawer-empty">No dependencies.</div>`;
    return;
  }
  const nodes = [];
  if (blockingTasks.length > 0) {
    nodes.push(sectionLabel("Blocked by"));
    nodes.push(...blockingTasks.map((dependency) => renderDependencyCard(dependency, "blocking")));
  }
  if (blockedTasks.length > 0) {
    nodes.push(sectionLabel("Blocks"));
    nodes.push(...blockedTasks.map((dependency) => renderDependencyCard(dependency, "blocked")));
  }
  els.dependencyList.replaceChildren(...nodes);
}

function sectionLabel(label) {
  const element = document.createElement("div");
  element.className = "drawer-subtitle";
  element.textContent = label;
  return element;
}

function renderDependencyCard(dependency, direction) {
  const card = document.createElement("article");
  card.className = "dependency-card";
  const task = dependency.task || {};
  const removable = direction === "blocking";
  card.innerHTML = `
    <div class="attachment-head">
      <span>${escapeHtml(task.title || "Task")}</span>
      <span>${escapeHtml(task.status || "")}</span>
    </div>
    <div class="card-meta">${escapeHtml(task.id || "")} / ${escapeHtml(task.priority || "medium")} / ${escapeHtml(assigneeLabel(task.assigneeId))}</div>
    ${task.description ? `<div class="card-body">${escapeHtml(task.description)}</div>` : ""}
    <div class="attachment-actions">
      <button class="mini-button" data-action="open" type="button">Open</button>
      ${removable ? `<button class="mini-button" data-action="remove" type="button">Remove</button>` : ""}
    </div>
  `;
  card.querySelector('[data-action="open"]').addEventListener("click", () => {
    const localTask = state.tasks.find((item) => item.id === task.id) || task;
    openTask(localTask);
  });
  if (removable) {
    card.querySelector('[data-action="remove"]').addEventListener("click", () => removeDependency(dependency).catch((error) => setError(error.message)));
  }
  return card;
}

function renderComments() {
  if (!els.commentList) return;
  if (state.comments.length === 0) {
    els.commentList.innerHTML = `<div class="drawer-empty">No comments yet.</div>`;
    return;
  }
  els.commentList.replaceChildren(
    ...state.comments.map((comment) => {
      const card = document.createElement("article");
      card.className = "comment-card";
      const canEdit = state.user?.id && comment.authorId === state.user.id;
      card.innerHTML = `
        <div class="comment-head">
          <span>${escapeHtml(comment.authorName || comment.authorId || "unknown")}</span>
          <span>${formatDate(comment.createdAt)}</span>
        </div>
        <div class="comment-body">${escapeHtml(comment.body)}</div>
        ${canEdit ? `<div class="attachment-actions"><button class="mini-button" data-action="edit" type="button">Edit</button><button class="mini-button" data-action="delete" type="button">Delete</button></div>` : ""}
      `;
      if (canEdit) {
        card.querySelector('[data-action="edit"]').addEventListener("click", () => editComment(comment, card).catch((error) => setError(error.message)));
        card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteComment(comment).catch((error) => setError(error.message)));
      }
      return card;
    })
  );
}

async function editComment(comment, card) {
  const body = card.querySelector(".comment-body");
  const actions = card.querySelector(".attachment-actions");
  const textarea = document.createElement("textarea");
  textarea.rows = 4;
  textarea.value = comment.body;
  const save = document.createElement("button");
  save.type = "button";
  save.className = "mini-button";
  save.textContent = "Save";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "mini-button";
  cancel.textContent = "Cancel";
  body.replaceWith(textarea);
  actions.replaceChildren(save, cancel);
  cancel.addEventListener("click", renderComments);
  save.addEventListener("click", async () => {
    const { comment: updated } = await api(`/api/pm/comments/${comment.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body: textarea.value })
    });
    state.comments = state.comments.map((item) => (item.id === updated.id ? updated : item));
    await reloadActivityForActiveTask();
    renderDrawerData();
  });
}

async function deleteComment(comment) {
  await api(`/api/pm/comments/${comment.id}`, { method: "DELETE" });
  state.comments = state.comments.filter((item) => item.id !== comment.id);
  await reloadActivityForActiveTask();
  renderDrawerData();
}

function renderAttachments() {
  if (!els.attachmentList) return;
  if (state.attachments.length === 0) {
    els.attachmentList.innerHTML = `<div class="drawer-empty">No attachments.</div>`;
    return;
  }
  els.attachmentList.replaceChildren(
    ...state.attachments.map((attachment) => {
      const card = document.createElement("article");
      card.className = "attachment-card";
      card.innerHTML = `
        <div class="attachment-head">
          <span>${escapeHtml(attachment.originalFileName)}</span>
          <span>${formatBytes(attachment.sizeBytes)}</span>
        </div>
        <div class="card-meta">${escapeHtml(attachment.mimeType || "application/octet-stream")} / ${escapeHtml(attachment.storedFileName)}</div>
        <div class="attachment-actions">
          <a href="/api/pm/attachments/${encodeURIComponent(attachment.id)}">Download</a>
          <button class="mini-button" type="button">Delete</button>
        </div>
      `;
      card.querySelector("button").addEventListener("click", () => deleteAttachment(attachment).catch((error) => setError(error.message)));
      return card;
    })
  );
}

async function deleteAttachment(attachment) {
  await api(`/api/pm/attachments/${attachment.id}`, { method: "DELETE" });
  state.attachments = state.attachments.filter((item) => item.id !== attachment.id);
  await reloadActivityForActiveTask();
  renderDrawerData();
}

function renderActivity() {
  if (!els.activityList) return;
  if (state.activity.length === 0) {
    els.activityList.innerHTML = `<div class="drawer-empty">No activity yet.</div>`;
    return;
  }
  els.activityList.replaceChildren(
    ...state.activity.map((event) => {
      const card = document.createElement("article");
      card.className = "activity-card";
      card.innerHTML = `
        <div class="activity-head">
          <span>${escapeHtml(event.eventType)}</span>
          <span>${formatDate(event.createdAt)}</span>
        </div>
        <div class="activity-body">${escapeHtml(activitySummary(event))}</div>
      `;
      return card;
    })
  );
}

function activitySummary(event) {
  const actor = event.actorName || event.actorId || event.actorType;
  const payload = event.payload && Object.keys(event.payload).length > 0 ? ` / ${JSON.stringify(event.payload)}` : "";
  return `${actor}${payload}`;
}

async function reloadActivityForActiveTask() {
  if (!state.activeTask) return;
  const { activity } = await api(`/api/pm/tasks/${state.activeTask.id}/activity`);
  state.activity = activity;
}

async function markNotificationRead(notification) {
  await api(`/api/pm/notifications/${notification.id}/read`, { method: "POST" });
  state.notifications = state.notifications.filter((item) => item.id !== notification.id);
  renderNotifications();
}

async function markAllNotificationsRead() {
  await api("/api/pm/notifications/read-all", { method: "POST" });
  state.notifications = [];
  renderNotifications();
}

async function createComment(event) {
  event.preventDefault();
  if (!state.activeTask) return;
  const body = els.commentBody.value.trim();
  if (!body) return;
  const { comment } = await api(`/api/pm/tasks/${state.activeTask.id}/comments`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
  els.commentForm.reset();
  state.comments = [...state.comments, comment];
  await reloadActivityForActiveTask();
  renderDrawerData();
}

async function uploadAttachment(event) {
  event.preventDefault();
  if (!state.activeTask || !els.attachmentFile.files?.[0]) return;
  const formData = new FormData();
  formData.append("file", els.attachmentFile.files[0]);
  const { attachment } = await api(`/api/pm/tasks/${state.activeTask.id}/attachments`, {
    method: "POST",
    body: formData
  });
  els.attachmentForm.reset();
  state.attachments = [attachment, ...state.attachments];
  await reloadActivityForActiveTask();
  renderDrawerData();
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
    if (message.type && message.type !== "presence.updated") {
      if (message.type.startsWith("notification.")) {
        if (message.payload?.userId === state.user?.id) await loadNotifications();
        return;
      }
      await loadProjects();
      if (state.activeTask) await loadTaskDrawerData(state.activeTask.id);
    }
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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function optionEl(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function sprintLabel(sprintId) {
  if (!sprintId) return "backlog";
  const sprint = state.sprints.find((item) => item.id === sprintId);
  return sprint ? sprint.name : "sprint";
}

function memberLabel(member) {
  return member.displayName || member.username || member.email || member.id;
}

function assigneeLabel(assigneeId) {
  if (!assigneeId) return "unassigned";
  const member = state.members.find((item) => item.id === assigneeId);
  return member ? memberLabel(member) : "assigned";
}

function formatSprintDates(sprint) {
  const start = sprint.startsAt ? new Date(sprint.startsAt).toLocaleDateString() : "no start";
  const end = sprint.endsAt ? new Date(sprint.endsAt).toLocaleDateString() : "no end";
  return `${start} -> ${end}`;
}

function selectedSprintIdForNewTask() {
  return ["__all", "__backlog"].includes(state.activeSprintId) ? undefined : state.activeSprintId;
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
els.memberForm.addEventListener("submit", (event) => addMember(event).catch((error) => setError(error.message)));
els.labelForm.addEventListener("submit", (event) => createLabel(event).catch((error) => setError(error.message)));
els.epicForm.addEventListener("submit", (event) => createEpic(event).catch((error) => setError(error.message)));
els.sprintForm.addEventListener("submit", (event) => createSprint(event).catch((error) => setError(error.message)));
els.taskForm.addEventListener("submit", (event) => createTask(event).catch((error) => setError(error.message)));
els.taskEditForm.addEventListener("submit", (event) => saveTask(event).catch((error) => setError(error.message)));
els.taskLabelForm.addEventListener("submit", (event) => addTaskLabel(event).catch((error) => setError(error.message)));
els.dependencyForm.addEventListener("submit", (event) => addDependency(event).catch((error) => setError(error.message)));
els.commentForm.addEventListener("submit", (event) => createComment(event).catch((error) => setError(error.message)));
els.attachmentForm.addEventListener("submit", (event) => uploadAttachment(event).catch((error) => setError(error.message)));
els.notificationToggle.addEventListener("click", () => {
  els.notificationPanel.hidden = !els.notificationPanel.hidden;
});
els.markAllNotificationsReadBtn.addEventListener("click", () => markAllNotificationsRead().catch((error) => setError(error.message)));
els.includeArchived.addEventListener("change", () => loadProjects().catch((error) => setError(error.message)));
els.includeCompletedSprints.addEventListener("change", () => loadProjectData().catch((error) => setError(error.message)));
els.backlogFilterBtn.addEventListener("click", () => {
  state.activeSprintId = "__backlog";
  renderSprints();
  renderTasks();
  renderBoard();
});
els.allSprintTasksBtn.addEventListener("click", () => {
  state.activeSprintId = "__all";
  renderSprints();
  renderTasks();
  renderBoard();
});
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
