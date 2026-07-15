const THEME_STORAGE_KEY = "projectego-pm-theme";
const PM_HOME_GRID_STEP_KEY = "projectego-pm-home-grid-step";
const PM_PROJECT_ORDER_KEY = "projectego-pm-project-order";
const PM_PROJECT_SHEETS_KEY = "projectego-pm-project-sheets";
const PM_PROJECT_BOARDS_EXPANDED_KEY = "projectego-pm-project-boards-expanded";
const PM_COMMENT_MODE_KEY = "projectego-pm-comment-mode";

const state = {
  user: null,
  projects: [],
  members: [],
  labels: [],
  savedFilters: [],
  epics: [],
  globalEpics: [],
  epicTaskPool: [],
  epicTaskBoards: [],
  epicTaskTargetTaskId: null,
  sprints: [],
  boards: [],
  tasks: [],
  board: null,
  projectBoardMap: new Map(),
  projectBoardsExpanded: false,
  boardViewMode: "kanban",
  boardListSort: "created_desc",
  columns: [],
  boardTasks: [],
  activeProjectId: null,
  activeEpicId: null,
  activeBoardId: null,
  editingProjectId: null,
  editingEpicId: null,
  activeSprintId: "__backlog",
  activeTask: null,
  taskDrawerMode: "view",
  taskLabels: [],
  dependencies: { blockingTasks: [], blockedTasks: [] },
  comments: [],
  attachments: [],
  activity: [],
  floatingWindows: [],
  currentView: "home",
  routeTaskId: null,
  homeEditing: false,
  homeWidgets: [],
  homeTemplates: [],
  homeData: {},
  projectSheetEditing: false,
  projectSheetWidgets: [],
  projectSheetBackground: "#050808",
  projectSheetBackgroundImage: "",
  projectSheetBackgroundMode: "cover",
  projectOrder: [],
  commentMode: "fast",
  projectDragSuppressClickUntil: 0,
  timerAlerts: new Set(),
  notifications: [],
  webhookDeliveries: [],
  webhookSummary: { pending: 0, retrying: 0, delivered: 0, dead: 0 },
  opsStatus: null,
  apiTerminalSessions: new Map(),
  ws: null,
  shouldReconnect: true
};

const $ = (id) => document.getElementById(id);
let taskSearchReloadTimer = 0;

const els = {
  identityLine: $("identityLine"),
  healthDot: $("healthDot"),
  healthText: $("healthText"),
  wsDot: $("wsDot"),
  wsText: $("wsText"),
  themeButtons: Array.from(document.querySelectorAll("[data-theme]")),
  customBgColor: $("customBgColor"),
  customFieldColor: $("customFieldColor"),
  customTextColor: $("customTextColor"),
  customLineColor: $("customLineColor"),
  fontFamilySelect: $("fontFamilySelect"),
  fontSizeInput: $("fontSizeInput"),
  errorBanner: $("errorBanner"),
  toastStack: $("toastStack"),
  notificationToggle: $("notificationToggle"),
  notificationCount: $("notificationCount"),
  notificationPanel: $("notificationPanel"),
  notificationList: $("notificationList"),
  markAllNotificationsReadBtn: $("markAllNotificationsReadBtn"),
  webhookToggle: $("webhookToggle"),
  webhookDeadCount: $("webhookDeadCount"),
  opsToggle: $("opsToggle"),
  opsProblemCount: $("opsProblemCount"),
  pmLogoutBtn: $("pmLogoutBtn"),
  pmLoginPanel: $("pmLoginPanel"),
  pmLoginForm: $("pmLoginForm"),
  pmLoginName: $("pmLoginName"),
  pmLoginPassword: $("pmLoginPassword"),
  pmLoginMessage: $("pmLoginMessage"),
  pmGrid: $("pmGrid"),
  pmHomeBtn: $("pmHomeBtn"),
  pmKanbanBtn: $("pmKanbanBtn"),
  pmHomeView: $("pmHomeView"),
  pmKanbanView: $("pmKanbanView"),
  homeEditToggle: $("homeEditToggle"),
  homeGridStep: $("homeGridStep"),
  homeWidgetKind: $("homeWidgetKind"),
  addHomeWidgetBtn: $("addHomeWidgetBtn"),
  saveWidgetTemplateBtn: $("saveWidgetTemplateBtn"),
  homeTemplateVisibility: $("homeTemplateVisibility"),
  homeTemplateSelect: $("homeTemplateSelect"),
  useWidgetTemplateBtn: $("useWidgetTemplateBtn"),
  homeGrid: $("homeGrid"),
  projectSidebarToggle: $("projectSidebarToggle"),
  epicSidebarToggle: $("epicSidebarToggle"),
  projectSidebarBackdrop: $("projectSidebarBackdrop"),
  epicSidebarBackdrop: $("epicSidebarBackdrop"),
  closeProjectSidebarBtn: $("closeProjectSidebarBtn"),
  closeEpicSidebarBtn: $("closeEpicSidebarBtn"),
  toggleProjectBoardsBtn: $("toggleProjectBoardsBtn"),
  openCreateProjectBtn: $("openCreateProjectBtn"),
  projectModal: $("projectModal"),
  projectModalTitle: $("projectModalTitle"),
  cancelProjectModalBtn: $("cancelProjectModalBtn"),
  boardModal: $("boardModal"),
  boardForm: $("boardForm"),
  boardName: $("boardName"),
  boardEpic: $("boardEpic"),
  boardDeleteSelect: $("boardDeleteSelect"),
  deleteBoardBtn: $("deleteBoardBtn"),
  boardViewMode: $("boardViewMode"),
  boardListSort: $("boardListSort"),
  cancelBoardModalBtn: $("cancelBoardModalBtn"),
  taskSidebarToggle: $("taskSidebarToggle"),
  webhookPanel: $("webhookPanel"),
  webhookStatusFilter: $("webhookStatusFilter"),
  refreshWebhooksBtn: $("refreshWebhooksBtn"),
  webhookSummary: $("webhookSummary"),
  webhookDeliveryList: $("webhookDeliveryList"),
  opsPanel: $("opsPanel"),
  refreshOpsBtn: $("refreshOpsBtn"),
  opsStatusList: $("opsStatusList"),
  bootstrapForm: $("bootstrapForm"),
  bootstrapToken: $("bootstrapToken"),
  bootstrapProjectKey: $("bootstrapProjectKey"),
  bootstrapProjectName: $("bootstrapProjectName"),
  includeArchived: $("includeArchived"),
  projectForm: $("projectForm"),
  projectManagementFields: $("projectManagementFields"),
  openTeamModalBtn: $("openTeamModalBtn"),
  openLabelsModalBtn: $("openLabelsModalBtn"),
  deleteProjectBtn: $("deleteProjectBtn"),
  teamModal: $("teamModal"),
  labelsModal: $("labelsModal"),
  closeTeamModalBtn: $("closeTeamModalBtn"),
  closeLabelsModalBtn: $("closeLabelsModalBtn"),
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
  globalEpicList: $("globalEpicList"),
  activeProjectName: $("activeProjectName"),
  activeProjectMeta: $("activeProjectMeta"),
  projectInfoBtn: $("projectInfoBtn"),
  projectInfoModal: $("projectInfoModal"),
  closeProjectInfoBtn: $("closeProjectInfoBtn"),
  projectInfoList: $("projectInfoList"),
  projectTitleSheet: $("projectTitleSheet"),
  projectTitleSheetMeta: $("projectTitleSheetMeta"),
  projectSheetEditToggle: $("projectSheetEditToggle"),
  projectSheetCreateBoardBtn: $("projectSheetCreateBoardBtn"),
  projectSheetGridStep: $("projectSheetGridStep"),
  projectSheetBgColor: $("projectSheetBgColor"),
  projectSheetBgImage: $("projectSheetBgImage"),
  projectSheetBgMode: $("projectSheetBgMode"),
  projectSheetClearBgImageBtn: $("projectSheetClearBgImageBtn"),
  projectSheetWidgetKind: $("projectSheetWidgetKind"),
  projectSheetWidgetBoard: $("projectSheetWidgetBoard"),
  addProjectSheetWidgetBtn: $("addProjectSheetWidgetBtn"),
  projectSheetGrid: $("projectSheetGrid"),
  projectKanbanArea: $("projectKanbanArea"),
  refreshBtn: $("refreshBtn"),
  archiveProjectBtn: $("archiveProjectBtn"),
  epicForm: $("epicForm"),
  epicModal: $("epicModal"),
  epicModalTitle: $("epicModalTitle"),
  epicKey: $("epicKey"),
  openCreateEpicBtn: $("openCreateEpicBtn"),
  cancelEpicModalBtn: $("cancelEpicModalBtn"),
  epicTitle: $("epicTitle"),
  deleteEpicBtn: $("deleteEpicBtn"),
  epicList: $("epicList"),
  sprintForm: $("sprintForm"),
  sprintName: $("sprintName"),
  includeCompletedSprints: $("includeCompletedSprints"),
  backlogFilterBtn: $("backlogFilterBtn"),
  allSprintTasksBtn: $("allSprintTasksBtn"),
  sprintList: $("sprintList"),
  openTaskCreateModalBtn: $("openTaskCreateModalBtn"),
  taskCreateModal: $("taskCreateModal"),
  taskCreateForm: $("taskCreateForm"),
  taskCreateTitle: $("taskCreateTitle"),
  taskCreatePriority: $("taskCreatePriority"),
  taskCreateAssignee: $("taskCreateAssignee"),
  taskCreateDueAt: $("taskCreateDueAt"),
  taskCreateEpic: $("taskCreateEpic"),
  cancelTaskCreateModalBtn: $("cancelTaskCreateModalBtn"),
  epicTaskModal: $("epicTaskModal"),
  epicTaskEpicFilter: $("epicTaskEpicFilter"),
  epicTaskSearch: $("epicTaskSearch"),
  epicTaskProjectFilter: $("epicTaskProjectFilter"),
  epicTaskBoardFilter: $("epicTaskBoardFilter"),
  epicTaskList: $("epicTaskList"),
  cancelEpicTaskModalBtn: $("cancelEpicTaskModalBtn"),
  taskList: $("taskList"),
  activeBoardLine: $("activeBoardLine"),
  kanbanBoard: $("kanbanBoard"),
  statusFilter: $("statusFilter"),
  priorityFilter: $("priorityFilter"),
  labelFilter: $("labelFilter"),
  dueFilter: $("dueFilter"),
  taskSearch: $("taskSearch"),
  savedFilterSelect: $("savedFilterSelect"),
  savedFilterName: $("savedFilterName"),
  saveFilterBtn: $("saveFilterBtn"),
  updateFilterBtn: $("updateFilterBtn"),
  deleteFilterBtn: $("deleteFilterBtn"),
  taskDrawer: $("taskDrawer"),
  closeDrawerBtn: $("closeDrawerBtn"),
  activityDrawerBtn: $("activityDrawerBtn"),
  editTaskModeBtn: $("editTaskModeBtn"),
  activityDrawer: $("activityDrawer"),
  closeActivityDrawerBtn: $("closeActivityDrawerBtn"),
  archiveTaskBtn: $("archiveTaskBtn"),
  addTaskToEpicBtn: $("addTaskToEpicBtn"),
  deleteTaskBtn: $("deleteTaskBtn"),
  drawerTitle: $("drawerTitle"),
  drawerMeta: $("drawerMeta"),
  taskViewPanel: $("taskViewPanel"),
  taskEditForm: $("taskEditForm"),
  editTaskTitle: $("editTaskTitle"),
  editTaskStatus: $("editTaskStatus"),
  editTaskPriority: $("editTaskPriority"),
  editTaskAssignee: $("editTaskAssignee"),
  editTaskSprint: $("editTaskSprint"),
  editTaskDueAt: $("editTaskDueAt"),
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
  commentFastModeBtn: $("commentFastModeBtn"),
  commentAdvancedModeBtn: $("commentAdvancedModeBtn"),
  commentToolbar: $("commentToolbar"),
  attachmentForm: $("attachmentForm"),
  attachmentFile: $("attachmentFile"),
  attachmentList: $("attachmentList"),
  activityList: $("activityList"),
  confirmModal: $("confirmModal"),
  confirmTitle: $("confirmTitle"),
  confirmMessage: $("confirmMessage"),
  confirmCancelBtn: $("confirmCancelBtn"),
  confirmOkBtn: $("confirmOkBtn"),
  mediaModal: $("mediaModal"),
  mediaTitle: $("mediaTitle"),
  mediaContent: $("mediaContent"),
  closeMediaModalBtn: $("closeMediaModalBtn"),
  pmWindowDockList: $("pmWindowDockList")
};

function setError(message) {
  if (els.errorBanner) {
    els.errorBanner.hidden = true;
    els.errorBanner.textContent = "";
  }
  if (!message) return;
  showToast(message, "error");
}

function showToast(message, kind = "error") {
  if (!els.toastStack) return;
  const toast = document.createElement("article");
  toast.className = `toast ${kind}`;
  const text = document.createElement("div");
  text.className = "toast-message";
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Close notification");
  close.textContent = "x";
  toast.append(text, close);
  els.toastStack.append(toast);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    toast.classList.add("closing");
    window.setTimeout(() => toast.remove(), 180);
  };
  close.addEventListener("click", remove);
  window.setTimeout(remove, 7000);
}

function setTheme(theme, { persist = true } = {}) {
  document.body.classList.remove("theme-dark", "theme-contrast", "theme-custom");
  document.body.classList.add(theme);
  for (const button of els.themeButtons) button.classList.toggle("active", button.dataset.theme === theme);
  if (theme === "theme-custom") applyCustomTheme();
  applyFontSettings();
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

function applyFontSettings() {
  const size = Math.max(10, Math.min(16, Number(els.fontSizeInput.value || 12)));
  const font = {
    mono: `"Cascadia Mono", "Consolas", ui-monospace, monospace`,
    compact: `"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", Arial, sans-serif`,
    system: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  }[els.fontFamilySelect.value] || `"Cascadia Mono", "Consolas", ui-monospace, monospace`;
  document.documentElement.style.setProperty("--pm-font-family", font);
  document.documentElement.style.setProperty("--pm-font-size", `${size}px`);
}

function saveThemeSettings(theme = activeTheme()) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme, colors: customThemeColors(), font: customFontSettings() }));
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
    if (saved?.font && typeof saved.font === "object") {
      if (["mono", "compact", "system"].includes(saved.font.family)) els.fontFamilySelect.value = saved.font.family;
      const size = Number(saved.font.size);
      if (Number.isFinite(size)) els.fontSizeInput.value = String(Math.max(10, Math.min(16, Math.floor(size))));
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

function customFontSettings() {
  return {
    family: els.fontFamilySelect.value,
    size: Math.max(10, Math.min(16, Number(els.fontSizeInput.value || 12)))
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
  return [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)].map((part) => Number.parseInt(part, 16));
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
    els.healthDot.className = `sq ${health.status === "ok" ? "green" : "yellow"}`;
    els.healthText.textContent = `${health.status}${health.databaseReachable ? "" : " / db unavailable"}`;
  } catch (error) {
    els.healthDot.className = "sq red";
    els.healthText.textContent = error.message;
  }
}

async function loadIdentity() {
  const { user } = await api("/api/pm/me");
  state.user = user;
  els.identityLine.textContent = `${user.displayName || user.username} / ${user.email || "no email"}`;
  showPmApp();
}

function showPmLogin(message = "") {
  state.user = null;
  state.shouldReconnect = false;
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  els.identityLine.textContent = "Not signed in";
  els.pmLoginMessage.textContent = message;
  els.pmLoginPanel.hidden = false;
  els.pmGrid.hidden = true;
  els.pmLogoutBtn.hidden = true;
  els.pmHomeBtn.hidden = true;
  els.pmKanbanBtn.hidden = true;
}

function showPmApp() {
  state.shouldReconnect = true;
  els.pmLoginPanel.hidden = true;
  els.pmGrid.hidden = false;
  els.pmLogoutBtn.hidden = false;
  els.pmHomeBtn.hidden = false;
  els.pmKanbanBtn.hidden = false;
  applyPmRouteState();
  setPmView(state.currentView || "home");
}

async function loadAfterAuth() {
  applyPmRouteState();
  await loadHome();
  await loadNotifications();
  await loadWebhookDeliveries();
  await loadOpsStatus();
  await loadProjects();
  await openTaskFromRoute();
}

function setPmView(view) {
  state.currentView = view === "kanban" ? "kanban" : "home";
  els.pmHomeView.hidden = state.currentView !== "home";
  els.pmKanbanView.hidden = state.currentView !== "kanban";
  els.pmHomeBtn.classList.toggle("active", state.currentView === "home");
  els.pmKanbanBtn.classList.toggle("active", state.currentView === "kanban");
}

function applyPmRouteState() {
  const route = pmRouteFromLocation();
  state.currentView = route.view;
  if (route.projectId !== undefined) state.activeProjectId = route.projectId;
  if (route.boardId !== undefined) state.activeBoardId = route.boardId;
  if (route.epicId !== undefined) state.activeEpicId = route.epicId;
  state.routeTaskId = route.taskId || null;
}

function pmRouteFromLocation() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const pmIndex = parts[0] === "pm" ? 0 : -1;
  const route = pmIndex >= 0 ? parts.slice(1) : parts;
  if (pmIndex < 0 && route.length > 0 && route[0] !== "projects" && route[0] !== "home") {
    return { view: "kanban", projectKey: route[0] || null, boardId: route[1] || null, taskId: route[2] || null };
  }
  if (route[0] === "home" || route.length === 0) return { view: "home" };
  if (route[0] !== "projects") return legacyHashRoute() || { view: "home" };
  const projectId = route[1] || null;
  if (!projectId) return { view: "kanban", projectId: null };
  if (route[2] === "boards") {
    return { view: "kanban", projectId, boardId: route[3] || null, taskId: route[4] === "tasks" ? route[5] || null : null };
  }
  if (route[2] === "epics") {
    return { view: "kanban", projectId, epicId: route[3] || null, taskId: route[4] === "tasks" ? route[5] || null : null };
  }
  if (route[2] === "tasks") return { view: "kanban", projectId, taskId: route[3] || null };
  return { view: "kanban", projectId };
}

function legacyHashRoute() {
  const params = pmHashParams();
  if (!params.project && !params.task) return null;
  return { view: "kanban", projectId: params.project || null, taskId: params.task || null };
}

function navigatePm(path, { replace = false } = {}) {
  if (window.location.pathname === path && !window.location.hash) return;
  const method = replace ? "replaceState" : "pushState";
  history[method](null, "", path);
  applyPmRouteState();
  setPmView(state.currentView);
}

async function applyPmRoute() {
  applyPmRouteState();
  setPmView(state.currentView);
  if (state.currentView === "home") {
    closeTask({ navigate: false });
    await loadHome();
    return;
  }
  await loadProjects();
  if (!state.routeTaskId) closeTask({ navigate: false });
  await openTaskFromRoute();
}

async function loginPm(event) {
  event.preventDefault();
  try {
    setError("");
    await api("/api/pm/auth/login", {
      method: "POST",
      body: JSON.stringify({ usernameOrEmail: els.pmLoginName.value, password: els.pmLoginPassword.value })
    });
    els.pmLoginPassword.value = "";
    await loadIdentity();
    await loadAfterAuth();
    connectWs();
  } catch (error) {
    showPmLogin(error.message);
  }
}

async function logoutPm() {
  await api("/api/pm/auth/logout", { method: "POST" }).catch(() => undefined);
  showPmLogin();
}

async function loadHome() {
  const { widgets, templates, data } = await api("/api/pm/home");
  state.homeWidgets = widgets;
  state.homeTemplates = templates;
  state.homeData = data || {};
  renderHomeTemplates();
  renderHome();
  checkHomeTimers();
}

async function addHomeWidget() {
  const kind = els.homeWidgetKind.value;
  const width = kind === "notes" ? 4 : 5;
  const height = kind === "timer" ? 2 : 4;
  const next = nextWidgetPosition(width, height);
  if (!next) throw new Error("No free grid space for this widget.");
  const { widget } = await api("/api/pm/home/widgets", {
    method: "POST",
    body: JSON.stringify({
      kind,
      title: defaultWidgetTitle(kind),
      x: next.x,
      y: next.y,
      width,
      height,
      clickable: true,
      content: kind === "notes" ? { text: "" } : kind === "timer" ? { targetAt: new Date(Date.now() + 3600000).toISOString() } : {}
    })
  });
  state.homeWidgets.push(widget);
  renderHome();
}

async function saveSelectedWidgetTemplate() {
  const widget = state.homeWidgets[0];
  if (!widget) return;
  const { template } = await api("/api/pm/home/templates", {
    method: "POST",
    body: JSON.stringify({
      kind: widget.kind,
      name: widget.title,
      visibility: els.homeTemplateVisibility.value,
      config: widget.config,
      content: widget.content
    })
  });
  state.homeTemplates = [...state.homeTemplates, template];
  renderHomeTemplates();
  setError("Widget template saved.");
}

async function useSelectedWidgetTemplate() {
  const template = state.homeTemplates.find((item) => item.id === els.homeTemplateSelect.value);
  if (!template) return;
  const width = 5;
  const height = template.kind === "timer" ? 2 : 4;
  const next = nextWidgetPosition(width, height);
  if (!next) throw new Error("No free grid space for this widget.");
  const { widget } = await api("/api/pm/home/widgets", {
    method: "POST",
    body: JSON.stringify({
      templateId: template.id,
      kind: template.kind,
      title: template.name,
      x: next.x,
      y: next.y,
      width,
      height,
      clickable: true,
      config: template.config,
      content: template.content
    })
  });
  state.homeWidgets.push(widget);
  renderHome();
}

function renderHomeTemplates() {
  els.homeTemplateSelect.replaceChildren(optionEl("", "Templates"));
  for (const template of state.homeTemplates) {
    els.homeTemplateSelect.append(optionEl(template.id, `${template.visibility}: ${template.name}`));
  }
  els.useWidgetTemplateBtn.disabled = state.homeTemplates.length === 0;
}

function renderHome() {
  const step = homeGridStep();
  els.homeGrid.style.setProperty("--home-grid-step", `${step}px`);
  els.homeGrid.className = `home-grid${state.homeEditing ? " editing" : ""}`;
  els.homeEditToggle.textContent = state.homeEditing ? "Done" : "Edit";
  for (const control of document.querySelectorAll(".home-edit-control")) control.hidden = !state.homeEditing;
  els.homeGrid.replaceChildren(...state.homeWidgets.map(renderHomeWidget));
}

function renderHomeWidget(widget) {
  const card = document.createElement("article");
  const size = clampWidgetSize(widget, Number(widget.width || 1), Number(widget.height || 1));
  const position = clampWidgetPosition({ ...widget, width: size.width, height: size.height }, Number(widget.x || 1), Number(widget.y || 1));
  card.className = `home-widget ${widget.clickable ? "clickable" : ""} ${state.homeEditing ? "editing" : ""}`;
  card.style.gridColumn = `${position.x} / span ${size.width}`;
  card.style.gridRow = `${position.y} / span ${size.height}`;
  card.draggable = false;
  card.dataset.widgetId = widget.id;
  card.innerHTML = `
    <header>
      <span>${escapeHtml(widget.title)}</span>
      <span>${escapeHtml(widget.kind)}</span>
    </header>
    <div class="home-widget-body"></div>
  `;
  card.querySelector(".home-widget-body").replaceChildren(...homeWidgetBody(widget));
  if (state.homeEditing) {
    card.append(renderWidgetAnchor(widget));
    card.append(renderWidgetSettings(widget));
    card.append(renderWidgetResizeHandle(widget));
  }
  return card;
}

function homeWidgetBody(widget) {
  if (widget.kind === "activity") return listWidgetRows(state.homeData.activity || [], "createdAt");
  if (widget.kind === "changes") return listWidgetRows(state.homeData.changes || [], "updatedAt");
  if (widget.kind === "my_epics") return listEpicWidgetRows(state.homeData.myEpics || []);
  if (widget.kind === "announcement") return listAnnouncementRows(state.homeData.announcements || []);
  if (widget.kind === "timer") return [timerWidgetNode(widget)];
  if (widget.kind === "api") return [apiWidgetNode(widget)];
  return [notesWidgetNode(widget)];
}

function listEpicWidgetRows(items) {
  if (!items.length) return [plainWidgetNode("No epics.")];
  return items.slice(0, 8).map((item) => {
    const row = document.createElement("div");
    row.className = "widget-row widget-link-row";
    row.tabIndex = 0;
    row.innerHTML = `<div class="widget-row-title">${escapeHtml(item.title || "Epic")}</div><div class="widget-row-meta">${escapeHtml(item.projectName || "")} / ${escapeHtml(item.status || "")} / ${Number(item.taskCount || 0)} tasks</div>`;
    const open = (newTab = false) => {
      const url = pmEpicPath(item.projectId, item.id);
      if (newTab) window.open(url, "_blank", "noopener");
      else navigatePm(url);
    };
    row.addEventListener("click", (event) => open(event.ctrlKey || event.metaKey));
    row.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        open(true);
      }
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") open(event.ctrlKey || event.metaKey);
    });
    return row;
  });
}

function listWidgetRows(items, dateKey) {
  if (!items.length) return [plainWidgetNode("No items.")];
  return items.slice(0, 8).map((item) => {
    const row = document.createElement("div");
    row.className = "widget-row widget-link-row";
    row.tabIndex = 0;
    row.innerHTML = `<div class="widget-row-title">${escapeHtml(item.title || "Task")}</div><div class="widget-row-meta">${escapeHtml(item.projectName || "")} / ${escapeHtml(item.status || "")} / ${formatDate(item[dateKey])}</div>`;
    row.addEventListener("click", (event) => openTaskReference(item, event.ctrlKey || event.metaKey).catch((error) => setError(error.message)));
    row.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        openTaskReference(item, true).catch((error) => setError(error.message));
      }
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openTaskReference(item, event.ctrlKey || event.metaKey).catch((error) => setError(error.message));
    });
    row.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    return row;
  });
}

function listAnnouncementRows(items) {
  if (!items.length) return [plainWidgetNode("No announcements.")];
  return items.map((item) => {
    const row = document.createElement("div");
    row.className = "widget-row";
    row.innerHTML = `<div class="widget-row-title">${escapeHtml(item.title)}</div><div class="widget-row-meta">${formatDate(item.createdAt)}</div><div class="card-body">${escapeHtml(item.body || "")}</div>`;
    return row;
  });
}

function notesWidgetNode(widget) {
  const wrap = document.createElement("div");
  wrap.className = "notes-widget";
  const textarea = document.createElement("textarea");
  textarea.value = widget.content?.text || "";
  textarea.readOnly = !state.homeEditing;
  textarea.addEventListener("change", () => updateHomeWidget(widget.id, { content: { ...widget.content, text: textarea.value } }).catch((error) => setError(error.message)));
  wrap.append(textarea);
  return wrap;
}

function timerWidgetNode(widget) {
  const target = widget.content?.targetAt ? new Date(widget.content.targetAt) : new Date(Date.now() + 3600000);
  const seconds = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
  const wrap = document.createElement("div");
  wrap.className = "timer-widget";
  if (state.homeEditing) {
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.value = localDateTimeInputValue(target);
    input.addEventListener("change", () => updateHomeWidget(widget.id, { content: { ...widget.content, targetAt: new Date(input.value).toISOString() } }).catch((error) => setError(error.message)));
    wrap.append(input);
  }
  const output = plainWidgetNode(`${target.toLocaleString()}\n${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`);
  wrap.append(output);
  return wrap;
}

function plainWidgetNode(text) {
  const node = document.createElement("pre");
  node.className = "widget-row";
  node.textContent = text;
  return node;
}

const API_TERMINAL_COMMANDS = [
  ["GET", "/api/pm/home", "front page widgets and data"],
  ["GET", "/api/pm/projects?includeArchived=true", "projects visible to current user"],
  ["GET", "/api/pm/projects/:projectId/boards", "boards for a project"],
  ["GET", "/api/pm/boards/:boardId", "board snapshot"],
  ["GET", "/api/pm/projects/:projectId/tasks", "tasks for a project"],
  ["GET", "/api/pm/tasks/:taskId/comments", "task comments"],
  ["GET", "/api/pm/tasks/:taskId/activity", "task activity log"],
  ["GET", "/api/pm/notifications", "user notifications"],
  ["GET", "/api/pm/operator/status", "PM DB / webhook / SMTP status"],
  ["POST", "/api/pm/projects", "create project with JSON body"],
  ["POST", "/api/pm/boards/:boardId/tasks", "create task on a board with JSON body"],
  ["DELETE", "/api/pm/tasks/:taskId/permanent", "permanently delete a task"],
  ["DELETE", "/api/pm/boards/:boardId/permanent", "permanently delete a board"],
  ["DELETE", "/api/pm/projects/:projectId/permanent", "permanently delete a project"]
];

function apiWidgetNode(widget) {
  const node = document.createElement("div");
  node.className = "api-terminal-widget";
  const session = apiTerminalSession(widget.id);
  node.innerHTML = `
    <div class="api-terminal-toolbar">
      <button type="button" data-terminal-command="help">Help</button>
      <button type="button" data-terminal-command="catalog">Catalog</button>
      <button type="button" data-terminal-command="clear">Clear</button>
    </div>
    <div class="api-terminal-output" role="log" aria-live="polite"></div>
    <form class="api-terminal-form">
      <span class="api-terminal-prompt">pm$</span>
      <input class="api-terminal-input" autocomplete="off" spellcheck="false" placeholder="GET /api/pm/projects?includeArchived=true">
    </form>
  `;
  const output = node.querySelector(".api-terminal-output");
  const input = node.querySelector(".api-terminal-input");
  renderApiTerminalOutput(session, output);

  for (const button of node.querySelectorAll("[data-terminal-command]")) {
    button.addEventListener("click", () => {
      const command = button.dataset.terminalCommand || "";
      runApiTerminalCommand(session, command, output, input).catch((error) => {
        appendApiTerminalLine(session, "error", error.message);
        renderApiTerminalOutput(session, output);
      });
    });
  }

  node.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const command = input.value.trim();
    input.value = "";
    runApiTerminalCommand(session, command, output, input).catch((error) => {
      appendApiTerminalLine(session, "error", error.message);
      renderApiTerminalOutput(session, output);
    });
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!session.history.length) return;
      session.historyIndex = Math.max(0, session.historyIndex < 0 ? session.history.length - 1 : session.historyIndex - 1);
      input.value = session.history[session.historyIndex] || "";
      input.setSelectionRange(input.value.length, input.value.length);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!session.history.length) return;
      session.historyIndex += 1;
      if (session.historyIndex >= session.history.length) {
        session.historyIndex = -1;
        input.value = "";
      } else {
        input.value = session.history[session.historyIndex] || "";
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  });
  return node;
}

function apiTerminalSession(widgetId) {
  const key = widgetId || "default";
  if (!state.apiTerminalSessions.has(key)) {
    state.apiTerminalSessions.set(key, {
      history: [],
      historyIndex: -1,
      lines: [
        { type: "system", text: "ProjectEGO PM API terminal. Type help or catalog." },
        { type: "system", text: "Only /api/pm/* paths are executable from this widget." }
      ]
    });
  }
  return state.apiTerminalSessions.get(key);
}

async function runApiTerminalCommand(session, rawCommand, output, input) {
  const command = rawCommand.trim();
  if (!command) return;
  appendApiTerminalLine(session, "input", `pm$ ${command}`);
  session.history.push(command);
  session.historyIndex = -1;

  if (command === "clear") {
    session.lines = [];
    renderApiTerminalOutput(session, output);
    input?.focus();
    return;
  }
  if (command === "help") {
    appendApiTerminalLine(session, "output", apiTerminalHelpText());
    renderApiTerminalOutput(session, output);
    input?.focus();
    return;
  }
  if (command === "catalog") {
    appendApiTerminalLine(session, "output", apiTerminalCatalogText());
    renderApiTerminalOutput(session, output);
    input?.focus();
    return;
  }

  const request = parseApiTerminalCommand(command);
  appendApiTerminalLine(session, "system", `${request.method} ${request.path}`);
  renderApiTerminalOutput(session, output);

  try {
    const result = await api(request.path, {
      method: request.method,
      body: request.body === undefined ? undefined : JSON.stringify(request.body)
    });
    appendApiTerminalLine(session, "output", formatApiTerminalPayload(result));
  } catch (error) {
    appendApiTerminalLine(session, "error", error.message);
  }
  renderApiTerminalOutput(session, output);
  input?.focus();
}

function parseApiTerminalCommand(command) {
  const alias = parseApiTerminalAlias(command);
  if (alias) return alias;
  const match = command.match(/^(GET|POST|PATCH|DELETE)\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (!match) throw new Error("Use: GET /api/pm/path or POST /api/pm/path {json}");
  const method = match[1].toUpperCase();
  const path = match[2];
  const bodyText = match[3]?.trim();
  if (!path.startsWith("/api/pm/")) throw new Error("Only /api/pm/* paths are allowed.");
  if ((method === "POST" || method === "PATCH") && !bodyText) throw new Error(`${method} requires a JSON body.`);
  if ((method === "GET" || method === "DELETE") && bodyText) throw new Error(`${method} does not accept a body in this terminal.`);
  return {
    method,
    path,
    body: bodyText ? parseTerminalJson(bodyText) : undefined
  };
}

function parseApiTerminalAlias(command) {
  const [name, ...parts] = command.split(/\s+/);
  const first = parts[0];
  if (name === "home") return { method: "GET", path: "/api/pm/home" };
  if (name === "projects") return { method: "GET", path: "/api/pm/projects?includeArchived=true" };
  if (name === "status") return { method: "GET", path: "/api/pm/operator/status" };
  if (name === "notifications") return { method: "GET", path: "/api/pm/notifications" };
  if (name === "boards" && first) return { method: "GET", path: `/api/pm/projects/${encodeURIComponent(first)}/boards` };
  if (name === "board" && first) return { method: "GET", path: `/api/pm/boards/${encodeURIComponent(first)}` };
  if (name === "tasks" && first) return { method: "GET", path: `/api/pm/projects/${encodeURIComponent(first)}/tasks` };
  return null;
}

function parseTerminalJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function apiTerminalHelpText() {
  return [
    "Commands:",
    "  help",
    "  catalog",
    "  clear",
    "  home | projects | status | notifications",
    "  boards <projectId> | board <boardId> | tasks <projectId>",
    "  GET /api/pm/path",
    "  POST /api/pm/path {\"title\":\"Task\"}",
    "  PATCH /api/pm/path {\"title\":\"Updated\"}",
    "  DELETE /api/pm/path",
    "",
    "The terminal uses your current PM browser session and refuses non-/api/pm paths."
  ].join("\n");
}

function apiTerminalCatalogText() {
  return API_TERMINAL_COMMANDS.map(([method, path, description], index) => {
    return `${String(index + 1).padStart(2, "0")}. ${method.padEnd(6)} ${path} - ${description}`;
  }).join("\n");
}

function appendApiTerminalLine(session, type, text) {
  session.lines.push({ type, text });
  if (session.lines.length > 80) session.lines.splice(0, session.lines.length - 80);
}

function renderApiTerminalOutput(session, output) {
  output.replaceChildren(...session.lines.map((line) => {
    const row = document.createElement("pre");
    row.className = `api-terminal-entry ${line.type}`;
    row.textContent = line.text;
    return row;
  }));
  output.scrollTop = output.scrollHeight;
}

function formatApiTerminalPayload(payload) {
  const text = JSON.stringify(payload, null, 2);
  if (text.length <= 12000) return text;
  return `${text.slice(0, 12000)}\n... truncated ${text.length - 12000} chars`;
}

async function openTaskReference(item, newTab = false) {
  if (!item?.id || !item?.projectId) return;
  const url = pmTaskPath(item.projectId, null, item.id);
  if (newTab) {
    window.open(url, "_blank", "noopener");
    return;
  }
  navigatePm(url);
  state.currentView = "kanban";
  state.activeProjectId = item.projectId;
  state.activeSprintId = "__all";
  setPmView("kanban");
  await loadProjectData();
  const task = state.tasks.find((entry) => entry.id === item.id) || state.boardTasks.find((entry) => entry.id === item.id);
  if (task) openTask(task);
  else setError("Task is not visible in the current filters.");
}

function pmHomePath() {
  return "/pm/home";
}

function pmProjectPath(projectId) {
  const project = projectById(projectId);
  return project ? `/${encodeURIComponent(project.key)}` : "/pm/projects";
}

function pmBoardPath(projectId, boardId) {
  return projectId && boardId ? `${pmProjectPath(projectId)}/${encodeURIComponent(boardId)}` : pmProjectPath(projectId);
}

function pmEpicPath(projectId, epicId) {
  return projectId && epicId ? `/pm/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}` : pmProjectPath(projectId);
}

function pmTaskPath(projectId, boardId, taskId) {
  if (!projectId || !taskId) return pmProjectPath(projectId);
  if (!boardId && state.activeEpicId) return `${pmEpicPath(projectId, state.activeEpicId)}/tasks/${encodeURIComponent(taskId)}`;
  if (!boardId) return `/pm/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
  return `${pmBoardPath(projectId, boardId)}/${encodeURIComponent(taskId)}`;
}

function pmHashParams() {
  const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return Object.fromEntries(new URLSearchParams(raw));
}

async function openTaskFromRoute() {
  const route = pmRouteFromLocation();
  if (!route.projectId || !route.taskId) return;
  if (state.activeProjectId !== route.projectId) {
    if (!state.projects.some((project) => project.id === route.projectId)) return;
    state.activeProjectId = route.projectId;
    if (route.boardId) state.activeBoardId = route.boardId;
    state.activeSprintId = "__all";
    await loadProjectData();
    return;
  }
  if (route.epicId && state.activeEpicId !== route.epicId) {
    state.activeEpicId = route.epicId;
    state.activeBoardId = null;
    await loadProjectData();
    return;
  }
  if (route.boardId && state.activeBoardId !== route.boardId) {
    state.activeBoardId = route.boardId;
    await loadProjectData();
    return;
  }
  const task = state.tasks.find((entry) => entry.id === route.taskId) || state.boardTasks.find((entry) => entry.id === route.taskId);
  if (!task || state.activeTask?.id === task.id) return;
  setPmView("kanban");
  openTask(task, "view", { navigate: false });
}

function checkHomeTimers() {
  const now = Date.now();
  for (const widget of state.homeWidgets) {
    if (widget.kind !== "timer") continue;
    const targetAt = widget.content?.targetAt;
    if (!targetAt) continue;
    const target = new Date(targetAt).getTime();
    if (!Number.isFinite(target) || target > now) continue;
    const key = `${widget.id}:${targetAt}`;
    if (state.timerAlerts.has(key)) continue;
    state.timerAlerts.add(key);
    showToast(`${widget.title || "Timer"} fired.`, "info");
  }
}

function renderWidgetSettings(widget) {
  const form = document.createElement("div");
  form.className = "home-widget-settings";
  form.innerHTML = `
    <button type="button">${widget.clickable ? "Clickable" : "Static"}</button>
    <button type="button">Delete</button>
  `;
  const [clickable, remove] = Array.from(form.querySelectorAll("button"));
  clickable.addEventListener("click", () => updateHomeWidget(widget.id, { clickable: !widget.clickable }).catch((error) => setError(error.message)));
  remove.addEventListener("click", () => deleteHomeWidget(widget.id).catch((error) => setError(error.message)));
  return form;
}

function renderWidgetAnchor(widget) {
  const anchor = document.createElement("button");
  anchor.type = "button";
  anchor.className = "home-widget-anchor";
  anchor.title = "Move widget";
  anchor.setAttribute("aria-label", "Move widget");
  anchor.addEventListener("dragstart", (event) => event.preventDefault());
  anchor.addEventListener("pointerdown", (event) => startHomeWidgetMove(event, widget));
  return anchor;
}

function startHomeWidgetMove(event, widget) {
  event.preventDefault();
  event.stopPropagation();
  const card = event.currentTarget.closest(".home-widget");
  if (!card) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const size = clampWidgetSize(widget, Number(widget.width || 1), Number(widget.height || 1));
  const startPosition = clampWidgetPosition({ ...widget, width: size.width, height: size.height }, Number(widget.x || 1), Number(widget.y || 1));
  const step = homeGridStep();
  let nextPosition = startPosition;
  card.classList.add("moving");
  document.body.classList.add("dragging-home-widget");

  const move = (moveEvent) => {
    moveEvent.preventDefault();
    const deltaX = Math.round((moveEvent.clientX - startX) / step);
    const deltaY = Math.round((moveEvent.clientY - startY) / step);
    const candidate = clampWidgetPosition({ ...widget, width: size.width, height: size.height }, startPosition.x + deltaX, startPosition.y + deltaY);
    if (homeWidgetCollides({ id: widget.id, ...candidate, width: size.width, height: size.height })) {
      card.classList.add("blocked");
      return;
    }
    card.classList.remove("blocked");
    nextPosition = candidate;
    card.style.gridColumn = `${nextPosition.x} / span ${size.width}`;
    card.style.gridRow = `${nextPosition.y} / span ${size.height}`;
  };

  const stop = () => {
    card.classList.remove("moving");
    card.classList.remove("blocked");
    document.body.classList.remove("dragging-home-widget");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", stop);
    if (nextPosition.x !== startPosition.x || nextPosition.y !== startPosition.y) {
      updateHomeWidget(widget.id, nextPosition).catch((error) => setError(error.message));
    }
  };

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", stop);
}

function renderWidgetResizeHandle(widget) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "home-widget-resize";
  handle.title = "Resize widget";
  handle.setAttribute("aria-label", "Resize widget");
  handle.addEventListener("dragstart", (event) => event.preventDefault());
  handle.addEventListener("pointerdown", (event) => startHomeWidgetResize(event, widget));
  return handle;
}

function startHomeWidgetResize(event, widget) {
  event.preventDefault();
  event.stopPropagation();
  const card = event.currentTarget.closest(".home-widget");
  if (!card) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const startWidth = Number(widget.width || 1);
  const startHeight = Number(widget.height || 1);
  const position = clampWidgetPosition(widget, Number(widget.x || 1), Number(widget.y || 1));
  const step = homeGridStep();
  let nextSize = { width: startWidth, height: startHeight };
  document.body.classList.add("resizing-home-widget");

  const move = (moveEvent) => {
    moveEvent.preventDefault();
    const deltaWidth = Math.round((moveEvent.clientX - startX) / step);
    const deltaHeight = Math.round((moveEvent.clientY - startY) / step);
    const candidate = clampWidgetSize({ ...widget, x: position.x, y: position.y }, startWidth + deltaWidth, startHeight + deltaHeight);
    if (homeWidgetCollides({ id: widget.id, x: position.x, y: position.y, width: candidate.width, height: candidate.height })) {
      card.classList.add("blocked");
      return;
    }
    card.classList.remove("blocked");
    nextSize = candidate;
    card.style.gridColumn = `${position.x} / span ${nextSize.width}`;
    card.style.gridRow = `${position.y} / span ${nextSize.height}`;
  };

  const stop = () => {
    card.classList.remove("blocked");
    document.body.classList.remove("resizing-home-widget");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", stop);
    if (nextSize.width !== startWidth || nextSize.height !== startHeight) {
      updateHomeWidget(widget.id, nextSize).catch((error) => setError(error.message));
    }
  };

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", stop);
}

async function updateHomeWidget(id, patch) {
  const { widget } = await api(`/api/pm/home/widgets/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  state.homeWidgets = state.homeWidgets.map((item) => (item.id === widget.id ? widget : item));
  renderHome();
}

async function deleteHomeWidget(id) {
  await api(`/api/pm/home/widgets/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.homeWidgets = state.homeWidgets.filter((widget) => widget.id !== id);
  renderHome();
}

function nextWidgetPosition(width = 4, height = 3) {
  const { columns, rows } = homeGridMetrics();
  const maxX = Math.max(1, columns - width + 1);
  const maxY = Math.max(1, rows - height + 1);
  for (let y = 1; y <= maxY; y += 1) {
    for (let x = 1; x <= maxX; x += 1) {
      if (!homeWidgetCollides({ x, y, width, height })) return { x, y };
    }
  }
  return null;
}

function defaultWidgetTitle(kind) {
  return { activity: "New activity", changes: "New changes", announcement: "Announcements", notes: "Notes", timer: "Timer", api: "API widget" }[kind] || "Widget";
}

function homeGridMetrics() {
  const step = homeGridStep();
  const rect = els.homeGrid.getBoundingClientRect();
  const columns = Math.max(1, Math.floor((rect.width - 20) / step));
  const rows = Math.max(1, Math.floor((rect.height - 20) / step));
  return { columns, rows, step };
}

function clampWidgetPosition(widget, x, y) {
  const { columns, rows } = homeGridMetrics();
  return {
    x: Math.max(1, Math.min(columns - Number(widget.width || 1) + 1, x)),
    y: Math.max(1, Math.min(rows - Number(widget.height || 1) + 1, y))
  };
}

function clampWidgetSize(widget, width, height) {
  const { columns, rows } = homeGridMetrics();
  return {
    width: Math.max(1, Math.min(columns - Number(widget.x || 1) + 1, width)),
    height: Math.max(1, Math.min(rows - Number(widget.y || 1) + 1, height))
  };
}

function homeWidgetCollides(candidate) {
  return state.homeWidgets.some((widget) => {
    if (candidate.id && widget.id === candidate.id) return false;
    return rectanglesOverlap(normalizeWidgetRect(candidate), normalizeWidgetRect(widget));
  });
}

function normalizeWidgetRect(widget) {
  const width = Math.max(1, Number(widget.width || 1));
  const height = Math.max(1, Number(widget.height || 1));
  return {
    x1: Number(widget.x || 1),
    y1: Number(widget.y || 1),
    x2: Number(widget.x || 1) + width - 1,
    y2: Number(widget.y || 1) + height - 1
  };
}

function rectanglesOverlap(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

function homeGridStep() {
  const value = Number(els.homeGridStep.value || 56);
  if (!Number.isFinite(value)) return 56;
  return Math.max(12, Math.min(160, Math.floor(value)));
}

function loadHomeGridStep() {
  try {
    const saved = Number(localStorage.getItem(PM_HOME_GRID_STEP_KEY));
    if (Number.isFinite(saved)) els.homeGridStep.value = String(Math.max(12, Math.min(160, Math.floor(saved))));
  } catch {
    // Grid step persistence is best-effort.
  }
}

function projectSheetGridStep() {
  const value = Number(els.projectSheetGridStep.value || 56);
  if (!Number.isFinite(value)) return 56;
  return Math.max(12, Math.min(160, Math.floor(value)));
}

function loadProjectSheetWidgets(projectId) {
  const all = loadProjectSheets();
  const sheet = all[projectId];
  if (Array.isArray(sheet)) {
    state.projectSheetWidgets = sheet;
    state.projectSheetBackground = "#050808";
    state.projectSheetBackgroundImage = "";
    state.projectSheetBackgroundMode = "cover";
    return;
  }
  state.projectSheetWidgets = Array.isArray(sheet?.widgets) ? sheet.widgets : [];
  state.projectSheetBackground = typeof sheet?.background === "string" ? sheet.background : "#050808";
  state.projectSheetBackgroundImage = typeof sheet?.backgroundImage === "string" ? sheet.backgroundImage : "";
  state.projectSheetBackgroundMode = ["cover", "stretch", "tile"].includes(sheet?.backgroundMode) ? sheet.backgroundMode : "cover";
  els.projectSheetBgColor.value = /^#[0-9a-fA-F]{6}$/.test(state.projectSheetBackground) ? state.projectSheetBackground : "#050808";
  els.projectSheetBgMode.value = state.projectSheetBackgroundMode;
}

function loadProjectSheets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PM_PROJECT_SHEETS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveProjectSheetWidgets() {
  const project = activeProject();
  if (!project) return;
  const all = loadProjectSheets();
  all[project.id] = {
    background: state.projectSheetBackground,
    backgroundImage: state.projectSheetBackgroundImage,
    backgroundMode: state.projectSheetBackgroundMode,
    widgets: state.projectSheetWidgets
  };
  try {
    localStorage.setItem(PM_PROJECT_SHEETS_KEY, JSON.stringify(all));
  } catch {
    // Project title sheet is local until project widgets are backed by API.
  }
}

async function uploadProjectSheetBackgroundImage() {
  const project = activeProject();
  const file = els.projectSheetBgImage.files?.[0];
  if (!project || !file) return;
  const formData = new FormData();
  formData.append("file", file);
  const { background } = await api(`/api/pm/projects/${encodeURIComponent(project.id)}/background`, {
    method: "POST",
    body: formData
  });
  state.projectSheetBackgroundImage = background.url;
  saveProjectSheetWidgets();
  els.projectSheetBgImage.value = "";
  renderProjectTitleSheet();
}

async function clearProjectSheetBackgroundImage() {
  const project = activeProject();
  if (!project) return;
  await api(`/api/pm/projects/${encodeURIComponent(project.id)}/background`, { method: "DELETE" });
  state.projectSheetBackgroundImage = "";
  saveProjectSheetWidgets();
  renderProjectTitleSheet();
}

function addProjectSheetWidget() {
  const next = nextProjectSheetWidgetPosition(4, 3);
  if (!next) {
    setError("No free grid space for this widget.");
    return;
  }
  const kind = els.projectSheetWidgetKind.value;
  const boardId = els.projectSheetWidgetBoard.value || state.activeBoardId || state.boards[0]?.id || "";
  state.projectSheetWidgets = [
    ...state.projectSheetWidgets,
    {
      id: `project-widget-${Date.now()}`,
      kind,
      boardId: ["board_latest", "board_new", "completion_pie"].includes(kind) ? boardId : "",
      title: projectSheetWidgetTitle(kind),
      x: next.x,
      y: next.y,
      width: kind === "completion_pie" ? 3 : 4,
      height: kind === "stickers" ? 4 : 3,
      opacity: 1,
      content: kind === "stickers" ? "Project note" : ""
    }
  ];
  saveProjectSheetWidgets();
  renderProjectTitleSheet();
}

function projectSheetWidgetTitle(kind) {
  return {
    board_latest: "Last board activity",
    board_new: "New board activity",
    completion_pie: "Done / not done",
    stickers: "Stickers",
    due_soon: "Due under 24h"
  }[kind] || "Project widget";
}

function updateProjectSheetWidget(id, patch) {
  state.projectSheetWidgets = state.projectSheetWidgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget));
  saveProjectSheetWidgets();
  renderProjectTitleSheet();
}

function deleteProjectSheetWidget(id) {
  state.projectSheetWidgets = state.projectSheetWidgets.filter((widget) => widget.id !== id);
  saveProjectSheetWidgets();
  renderProjectTitleSheet();
}

function projectSheetGridMetrics() {
  const step = projectSheetGridStep();
  const rect = els.projectSheetGrid.getBoundingClientRect();
  return {
    columns: Math.max(1, Math.floor((rect.width - 20) / step)),
    rows: Math.max(1, Math.floor((rect.height - 20) / step)),
    step
  };
}

function nextProjectSheetWidgetPosition(width = 4, height = 3) {
  const { columns, rows } = projectSheetGridMetrics();
  for (let y = 1; y <= Math.max(1, rows - height + 1); y += 1) {
    for (let x = 1; x <= Math.max(1, columns - width + 1); x += 1) {
      if (!projectSheetWidgetCollides({ x, y, width, height })) return { x, y };
    }
  }
  return null;
}

function clampProjectSheetWidgetPosition(widget, x, y) {
  const { columns, rows } = projectSheetGridMetrics();
  return {
    x: Math.max(1, Math.min(columns - Number(widget.width || 1) + 1, x)),
    y: Math.max(1, Math.min(rows - Number(widget.height || 1) + 1, y))
  };
}

function clampProjectSheetWidgetSize(widget, width, height) {
  const { columns, rows } = projectSheetGridMetrics();
  return {
    width: Math.max(1, Math.min(columns - Number(widget.x || 1) + 1, width)),
    height: Math.max(1, Math.min(rows - Number(widget.y || 1) + 1, height))
  };
}

function projectSheetWidgetCollides(candidate) {
  return state.projectSheetWidgets.some((widget) => {
    if (candidate.id && widget.id === candidate.id) return false;
    return rectanglesOverlap(normalizeWidgetRect(candidate), normalizeWidgetRect(widget));
  });
}

function startProjectSheetWidgetMove(event, widget) {
  event.preventDefault();
  event.stopPropagation();
  const card = event.currentTarget.closest(".home-widget");
  if (!card) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const size = clampProjectSheetWidgetSize(widget, Number(widget.width || 1), Number(widget.height || 1));
  const startPosition = clampProjectSheetWidgetPosition({ ...widget, width: size.width, height: size.height }, Number(widget.x || 1), Number(widget.y || 1));
  const step = projectSheetGridStep();
  let nextPosition = startPosition;
  card.classList.add("moving");
  document.body.classList.add("dragging-home-widget");
  const move = (moveEvent) => {
    moveEvent.preventDefault();
    const candidate = clampProjectSheetWidgetPosition({ ...widget, width: size.width, height: size.height }, startPosition.x + Math.round((moveEvent.clientX - startX) / step), startPosition.y + Math.round((moveEvent.clientY - startY) / step));
    if (projectSheetWidgetCollides({ id: widget.id, ...candidate, width: size.width, height: size.height })) {
      card.classList.add("blocked");
      return;
    }
    card.classList.remove("blocked");
    nextPosition = candidate;
    card.style.gridColumn = `${nextPosition.x} / span ${size.width}`;
    card.style.gridRow = `${nextPosition.y} / span ${size.height}`;
  };
  const stop = () => {
    card.classList.remove("moving", "blocked");
    document.body.classList.remove("dragging-home-widget");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", stop);
    updateProjectSheetWidget(widget.id, nextPosition);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", stop);
}

function startProjectSheetWidgetResize(event, widget) {
  event.preventDefault();
  event.stopPropagation();
  const card = event.currentTarget.closest(".home-widget");
  if (!card) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const position = clampProjectSheetWidgetPosition(widget, Number(widget.x || 1), Number(widget.y || 1));
  const startWidth = Number(widget.width || 1);
  const startHeight = Number(widget.height || 1);
  const step = projectSheetGridStep();
  let nextSize = { width: startWidth, height: startHeight };
  document.body.classList.add("resizing-home-widget");
  const move = (moveEvent) => {
    moveEvent.preventDefault();
    const candidate = clampProjectSheetWidgetSize({ ...widget, x: position.x, y: position.y }, startWidth + Math.round((moveEvent.clientX - startX) / step), startHeight + Math.round((moveEvent.clientY - startY) / step));
    if (projectSheetWidgetCollides({ id: widget.id, x: position.x, y: position.y, width: candidate.width, height: candidate.height })) {
      card.classList.add("blocked");
      return;
    }
    card.classList.remove("blocked");
    nextSize = candidate;
    card.style.gridColumn = `${position.x} / span ${nextSize.width}`;
    card.style.gridRow = `${position.y} / span ${nextSize.height}`;
  };
  const stop = () => {
    card.classList.remove("blocked");
    document.body.classList.remove("resizing-home-widget");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", stop);
    updateProjectSheetWidget(widget.id, nextSize);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", stop);
}

async function loadNotifications() {
  const { notifications } = await api("/api/pm/notifications");
  state.notifications = notifications;
  renderNotifications();
}

async function loadWebhookDeliveries() {
  const status = els.webhookStatusFilter.value;
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const { deliveries, summary } = await api(`/api/pm/webhook-deliveries${query}`);
  state.webhookDeliveries = deliveries;
  state.webhookSummary = summary;
  renderWebhookDeliveries();
}

async function loadOpsStatus() {
  state.opsStatus = await api("/api/pm/operator/status");
  renderOpsStatus();
}

async function loadProjects() {
  const { projects } = await api(`/api/pm/projects?includeArchived=${els.includeArchived.checked ? "true" : "false"}`);
  state.projectOrder = loadProjectOrder();
  state.projectBoardsExpanded = loadProjectBoardsExpanded();
  state.projects = applyProjectOrder(projects);
  const route = pmRouteFromLocation();
  if (route.projectKey) {
    const matched = projects.find((project) => project.key.toLowerCase() === String(route.projectKey).toLowerCase());
    if (matched) state.activeProjectId = matched.id;
  }
  if (route.projectId && projects.some((project) => project.id === route.projectId)) state.activeProjectId = route.projectId;
  if (!state.activeProjectId && projects[0]) state.activeProjectId = projects[0].id;
  if (state.activeProjectId && !projects.some((project) => project.id === state.activeProjectId)) {
    state.activeProjectId = projects[0]?.id || null;
  }
  renderProjects();
  if (state.projectBoardsExpanded) await loadProjectSidebarBoards();
  await loadProjectData();
}

async function loadProjectData() {
  const project = activeProject();
  els.archiveProjectBtn.disabled = !project;
  els.memberForm.querySelector("button").disabled = !project;
  els.labelForm.querySelector("button").disabled = !project;
  els.saveFilterBtn.disabled = !project;
  els.updateFilterBtn.disabled = !project || !els.savedFilterSelect.value;
  els.deleteFilterBtn.disabled = !project || !els.savedFilterSelect.value;
  els.openCreateEpicBtn.disabled = !project;
  els.sprintForm.querySelector("button").disabled = !project;
  els.backlogFilterBtn.disabled = !project;
  els.allSprintTasksBtn.disabled = !project;
  els.openTaskCreateModalBtn.disabled = !project;
  els.openTaskCreateModalBtn.textContent = state.activeEpicId ? "Add task" : "Create task";
  if (!project) {
    state.members = [];
    state.labels = [];
    state.savedFilters = [];
    state.epics = [];
    state.sprints = [];
    state.boards = [];
    state.tasks = [];
    state.board = null;
    state.columns = [];
    state.boardTasks = [];
    renderActiveProject();
    renderMembers();
    renderProjectLabels();
    renderSavedFilters();
    renderBoardSelect();
    renderEpics();
    renderSprints();
    renderTasks();
    renderBoard();
    renderProjectTitleSheet();
    return;
  }
  const [membersBody, labelsBody, filtersBody, epicsBody, sprintsBody, tasksBody, boardsBody] = await Promise.all([
    api(`/api/pm/projects/${project.id}/members`),
    api(`/api/pm/projects/${project.id}/labels`),
    api(`/api/pm/projects/${project.id}/filters`),
    api(`/api/pm/projects/${project.id}/epics`),
    api(`/api/pm/projects/${project.id}/sprints?includeCompleted=${els.includeCompletedSprints.checked ? "true" : "false"}${state.activeEpicId ? `&epicId=${encodeURIComponent(state.activeEpicId)}` : ""}`),
    api(`/api/pm/projects/${project.id}/tasks${taskSearchQuery()}`),
    api(`/api/pm/projects/${project.id}/boards${state.activeEpicId ? `?epicId=${encodeURIComponent(state.activeEpicId)}` : ""}`)
  ]);
  state.members = membersBody.members;
  state.labels = labelsBody.labels;
  state.savedFilters = filtersBody.filters;
  state.epics = epicsBody.epics;
  state.sprints = sprintsBody.sprints;
  state.boards = boardsBody.boards;
  state.projectBoardMap.set(project.id, state.boards);
  const route = pmRouteFromLocation();
  if (route.boardId && state.boards.some((board) => board.id === route.boardId)) state.activeBoardId = route.boardId;
  if (route.epicId && state.epics.some((epic) => epic.id === route.epicId)) state.activeEpicId = route.epicId;
  if (state.activeEpicId && !state.epics.some((epic) => epic.id === state.activeEpicId)) state.activeEpicId = null;
  if (state.activeBoardId && !state.boards.some((board) => board.id === state.activeBoardId)) state.activeBoardId = null;
  if (state.activeSprintId && !["__all", "__backlog"].includes(state.activeSprintId) && !state.sprints.some((sprint) => sprint.id === state.activeSprintId)) {
    state.activeSprintId = "__backlog";
  }
  state.tasks = tasksBody.tasks;
  if (state.activeBoardId) {
    await loadSelectedBoard();
  } else {
    state.board = null;
    state.columns = [];
    state.boardTasks = [];
  }
  loadProjectSheetWidgets(project.id);
  renderActiveProject();
  renderMembers();
  renderProjectLabels();
  renderSavedFilters();
  renderBoardSelect();
  renderProjects();
  renderEpics();
  renderSprints();
  renderTasks();
  renderBoard();
  renderProjectTitleSheet();
  await openTaskFromRoute();
}

function applyProjectOrder(projects) {
  const order = new Map(state.projectOrder.map((id, index) => [id, index]));
  return [...projects].sort((a, b) => {
    const left = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const right = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    return left - right || projects.indexOf(a) - projects.indexOf(b);
  });
}

function loadProjectOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PM_PROJECT_ORDER_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveProjectOrder() {
  state.projectOrder = state.projects.map((project) => project.id);
  try {
    localStorage.setItem(PM_PROJECT_ORDER_KEY, JSON.stringify(state.projectOrder));
  } catch {
    // Project order is a local preference.
  }
}

function loadProjectBoardsExpanded() {
  try {
    return localStorage.getItem(PM_PROJECT_BOARDS_EXPANDED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveProjectBoardsExpanded() {
  try {
    localStorage.setItem(PM_PROJECT_BOARDS_EXPANDED_KEY, state.projectBoardsExpanded ? "true" : "false");
  } catch {
    // Sidebar expansion is a local preference.
  }
}

async function toggleProjectBoardsExpanded() {
  state.projectBoardsExpanded = !state.projectBoardsExpanded;
  saveProjectBoardsExpanded();
  if (state.projectBoardsExpanded) await loadProjectSidebarBoards();
  renderProjects();
}

async function loadProjectSidebarBoards() {
  const entries = await Promise.all(state.projects.map(async (project) => {
    if (project.id === state.activeProjectId && state.boards.length) return [project.id, state.boards];
    try {
      const body = await api(`/api/pm/projects/${encodeURIComponent(project.id)}/boards`);
      return [project.id, body.boards || []];
    } catch {
      return [project.id, []];
    }
  }));
  state.projectBoardMap = new Map(entries);
}

async function ensureDefaultBoard(projectId) {
  return api(`/api/pm/projects/${projectId}/boards/kanban/default`, {
    method: "POST",
    body: JSON.stringify({ epicId: state.activeEpicId || undefined })
  });
}

async function loadSelectedBoard() {
  if (!state.activeBoardId) {
    state.board = null;
    state.columns = [];
    state.boardTasks = [];
    return;
  }
  const snapshot = await api(`/api/pm/boards/${state.activeBoardId}`);
  state.board = snapshot.board;
  state.columns = snapshot.columns;
  state.boardTasks = snapshot.tasks;
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

function renderBoardSelect() {
  els.boardEpic.replaceChildren(
    option("Project board", ""),
    ...state.epics.map((epic) => option(epic.title, epic.id))
  );
}

function option(label, value) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function projectById(projectId) {
  return state.projects.find((project) => project.id === projectId) || null;
}

function taskSearchQuery() {
  const search = els.taskSearch.value.trim();
  return search ? `?search=${encodeURIComponent(search)}` : "";
}

function renderProjects() {
  if (els.toggleProjectBoardsBtn) els.toggleProjectBoardsBtn.textContent = state.projectBoardsExpanded ? "Collapse" : "Expand";
  els.projectList.replaceChildren(
    ...state.projects.map((project, index) => {
      const button = document.createElement("article");
      button.className = `project-card ${project.id === state.activeProjectId ? "active" : ""}`;
      button.dataset.projectId = project.id;
      button.tabIndex = 0;
      const activeProjectBoards = project.id === state.activeProjectId ? state.boards : [];
      const boardTree = activeProjectBoards.length > 1 ? `
        <div class="project-board-tree">
          ${activeProjectBoards.map((board, boardIndex) => `
            <button class="project-board-node ${board.id === state.activeBoardId ? "active" : ""}" type="button" data-board-id="${escapeHtml(board.id)}">
              <span>${boardIndex === activeProjectBoards.length - 1 ? "└──" : "├──"}</span>
              <span>${escapeHtml(board.name)}${board.isDefault ? " / default" : ""}</span>
            </button>
          `).join("")}
        </div>
      ` : "";
      button.innerHTML = `
        <div class="card-title">${escapeHtml(project.name)}${project.archivedAt ? " / archived" : ""}</div>
        ${boardTree}
        <span class="project-drop-line"></span>
        <button class="project-edit-button" type="button" title="Edit project">⚙</button>
      `;
      const activate = async () => {
        state.activeProjectId = project.id;
        state.activeEpicId = null;
        state.activeBoardId = null;
        state.activeSprintId = "__backlog";
        navigatePm(pmProjectPath(project.id));
        await loadProjectData();
      };
      button.addEventListener("click", activate);
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate().catch((error) => setError(error.message));
        }
      });
      button.querySelector(".project-edit-button").addEventListener("click", (event) => {
        event.stopPropagation();
        openProjectModal(project);
      });
      for (const boardButton of button.querySelectorAll(".project-board-node")) {
        boardButton.addEventListener("click", (event) => {
          event.stopPropagation();
          state.activeBoardId = boardButton.dataset.boardId || null;
          closeProjectSidebar();
          navigatePm(pmBoardPath(project.id, state.activeBoardId));
          loadSelectedBoard()
            .then(() => {
              renderBoardSelect();
              renderProjects();
              renderBoard();
            })
            .catch((error) => setError(error.message));
        });
      }
      wireProjectDrag(button, index);
      return button;
    })
  );
}

function renderProjects() {
  els.projectList.replaceChildren(
    ...state.projects.map((project, index) => {
      const card = document.createElement("article");
      card.className = `project-card ${project.id === state.activeProjectId ? "active" : ""}`;
      card.dataset.projectId = project.id;
      card.tabIndex = 0;
      const boards = state.projectBoardsExpanded ? state.projectBoardMap.get(project.id) || [] : project.id === state.activeProjectId ? state.boards : [];
      const boardTree = boards.length > (state.projectBoardsExpanded ? 0 : 1) ? `
        <div class="project-board-tree">
          ${boards.map((board, boardIndex) => `
            <button class="project-board-node ${board.id === state.activeBoardId ? "active" : ""}" type="button" data-board-id="${escapeHtml(board.id)}">
              <span>${boardIndex === boards.length - 1 ? "\\--" : "|--"}</span>
              <span>${escapeHtml(board.name)}${board.isDefault ? " / default" : ""}</span>
            </button>
          `).join("")}
        </div>
      ` : "";
      card.innerHTML = `
        <div class="card-title">${escapeHtml(project.name)}${project.archivedAt ? " / archived" : ""}</div>
        ${boardTree}
        <span class="project-drop-line"></span>
        <button class="project-edit-button" type="button" title="Edit project" aria-label="Edit project">&#9881;</button>
      `;
      const activate = async () => {
        if (Date.now() < state.projectDragSuppressClickUntil) return;
        if (card.classList.contains("project-drag-ready")) return;
        state.activeProjectId = project.id;
        state.activeEpicId = null;
        state.activeBoardId = null;
        state.activeSprintId = "__backlog";
        navigatePm(pmProjectPath(project.id));
        await loadProjectData();
      };
      card.addEventListener("click", () => activate().catch((error) => setError(error.message)));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate().catch((error) => setError(error.message));
        }
      });
      card.querySelector(".project-edit-button").addEventListener("click", (event) => {
        event.stopPropagation();
        openProjectModal(project);
      });
      for (const boardButton of card.querySelectorAll(".project-board-node")) {
        boardButton.addEventListener("click", (event) => {
          event.stopPropagation();
          state.activeBoardId = boardButton.dataset.boardId || null;
          closeProjectSidebar();
          navigatePm(pmBoardPath(project.id, state.activeBoardId));
          loadSelectedBoard()
            .then(() => {
              renderBoardSelect();
              renderProjects();
              renderBoard();
              renderProjectTitleSheet();
            })
            .catch((error) => setError(error.message));
        });
      }
      wireProjectDrag(card, index);
      return card;
    })
  );
}

function renderActiveProject() {
  const project = activeProject();
  els.projectInfoBtn.disabled = !project;
  if (!project) {
    els.activeProjectName.textContent = "No project selected";
    els.activeProjectMeta.textContent = "Create or select a project.";
    return;
  }
  const epic = state.epics.find((item) => item.id === state.activeEpicId);
  const board = state.boards.find((item) => item.id === state.activeBoardId);
  els.activeProjectName.textContent = epic
    ? `Epic / ${epic.title}`
    : board
      ? `${project.name} / ${truncateText(board.name, 16)}`
      : project.name;
  els.activeProjectMeta.textContent = "";
  els.archiveProjectBtn.textContent = project.archivedAt ? "Unarchive" : "Archive";
  els.archiveProjectBtn.hidden = Boolean(epic);
  els.boardViewMode.hidden = Boolean(epic);
  els.boardListSort.hidden = Boolean(epic) || els.boardViewMode.value !== "list";
}

function openProjectInfoModal() {
  const project = activeProject();
  if (!project) return;
  const epic = state.epics.find((item) => item.id === state.activeEpicId);
  const board = state.boards.find((item) => item.id === state.activeBoardId);
  const rows = epic
    ? [
        ["Type", "Epic"],
        ["Title", epic.title],
        ["Key", epic.key || "-"],
        ["ID", epic.id],
        ["Project", `${project.key} / ${project.name}`],
        ["Status", epic.status],
        ["Priority", epic.priority],
        ["Version", epic.version],
        ["Created by", epic.createdBy || "-"],
        ["Updated", formatDate(epic.updatedAt)]
      ]
    : [
        ["Type", board ? "Board" : "Project"],
        ["Project", project.name],
        ["Key", project.key],
        ["Project ID", project.id],
        ["Board", board?.name || "-"],
        ["Board ID", board?.id || "-"],
        ["Role", project.role || "viewer"],
        ["Version", project.version],
        ["Created by", project.createdBy || "-"],
        ["Updated", formatDate(project.updatedAt)]
      ];
  els.projectInfoList.replaceChildren(...rows.map(([label, value]) => taskInfoRow(label, value)));
  els.projectInfoModal.hidden = false;
}

function closeProjectInfoModal() {
  els.projectInfoModal.hidden = true;
}

function renderProjectTitleSheet() {
  const project = activeProject();
  const showingSheet = Boolean(project && !state.activeBoardId && !state.activeEpicId);
  els.projectTitleSheet.hidden = !showingSheet;
  els.projectKanbanArea.hidden = showingSheet;
  if (!showingSheet) return;
  const step = projectSheetGridStep();
  els.projectSheetGrid.style.setProperty("--home-grid-step", `${step}px`);
  els.projectSheetGrid.style.setProperty("--project-sheet-bg", state.projectSheetBackground);
  els.projectSheetGrid.style.setProperty("--project-sheet-bg-image", state.projectSheetBackgroundImage ? `url("${cssUrl(state.projectSheetBackgroundImage)}")` : "none");
  els.projectSheetGrid.style.setProperty("--project-sheet-bg-size", state.projectSheetBackgroundMode === "stretch" ? "100% 100%" : state.projectSheetBackgroundMode === "tile" ? "auto" : "cover");
  els.projectSheetGrid.style.setProperty("--project-sheet-bg-repeat", state.projectSheetBackgroundMode === "tile" ? "repeat" : "no-repeat");
  els.projectSheetGrid.className = `home-grid project-sheet-grid${state.projectSheetEditing ? " editing" : ""}`;
  els.projectSheetEditToggle.textContent = state.projectSheetEditing ? "Done" : "Edit";
  for (const control of document.querySelectorAll(".project-sheet-edit-control")) control.hidden = !state.projectSheetEditing;
  els.projectTitleSheetMeta.textContent = `${project.key} / ${project.name}`;
  els.projectSheetWidgetBoard.replaceChildren(option("Project", ""), ...state.boards.map((board) => option(board.name, board.id)));
  els.projectSheetGrid.replaceChildren(...state.projectSheetWidgets.map(renderProjectSheetWidget));
}

function cssUrl(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "");
}

function renderProjectSheetWidget(widget) {
  const card = document.createElement("article");
  const size = clampProjectSheetWidgetSize(widget, Number(widget.width || 4), Number(widget.height || 3));
  const position = clampProjectSheetWidgetPosition({ ...widget, width: size.width, height: size.height }, Number(widget.x || 1), Number(widget.y || 1));
  card.className = `home-widget ${state.projectSheetEditing ? "editing" : ""}`;
  card.style.gridColumn = `${position.x} / span ${size.width}`;
  card.style.gridRow = `${position.y} / span ${size.height}`;
  card.style.setProperty("--widget-opacity", String(Math.max(0.15, Math.min(1, Number(widget.opacity ?? 1)))));
  card.dataset.widgetId = widget.id;
  card.innerHTML = `
    <header>
      <span>${escapeHtml(widget.title || "Project widget")}</span>
      <span>${escapeHtml(projectSheetWidgetScope(widget))}</span>
    </header>
    <div class="home-widget-body project-widget-body">${projectSheetWidgetLoadingHtml(widget)}</div>
  `;
  if (state.projectSheetEditing) {
    card.append(renderProjectSheetAnchor(widget));
    card.append(renderProjectSheetSettings(widget));
    card.append(renderProjectSheetResizeHandle(widget));
  }
  hydrateProjectSheetWidget(card, widget).catch((error) => {
    const body = card.querySelector(".project-widget-body");
    if (body) body.innerHTML = `<div class="drawer-empty">${escapeHtml(error.message)}</div>`;
  });
  return card;
}

function projectSheetWidgetScope(widget) {
  if (!widget.boardId) return "project";
  return state.boards.find((board) => board.id === widget.boardId)?.name || "board";
}

function projectSheetWidgetLoadingHtml(widget) {
  if ((widget.kind || "stickers") === "stickers") {
    return state.projectSheetEditing
      ? `<textarea class="project-sticker-editor">${escapeHtml(widget.content || "")}</textarea>`
      : `<pre class="widget-row">${escapeHtml(widget.content || "Empty sticker.")}</pre>`;
  }
  return `<div class="drawer-empty">Loading...</div>`;
}

async function hydrateProjectSheetWidget(card, widget) {
  const kind = widget.kind || "stickers";
  const body = card.querySelector(".project-widget-body");
  if (!body) return;
  if (kind === "stickers") {
    const textarea = body.querySelector(".project-sticker-editor");
    if (textarea) textarea.addEventListener("change", () => updateProjectSheetWidget(widget.id, { content: textarea.value }));
    return;
  }
  const tasks = await projectSheetWidgetTasks(widget);
  if (kind === "board_latest") {
    body.replaceChildren(...taskWidgetRows(tasks.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 8), "updatedAt"));
    return;
  }
  if (kind === "board_new") {
    body.replaceChildren(...taskWidgetRows(tasks.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 8), "createdAt"));
    return;
  }
  if (kind === "completion_pie") {
    body.innerHTML = completionPieHtml(tasks);
    return;
  }
  if (kind === "due_soon") {
    body.replaceChildren(...taskWidgetRows(tasks.filter(isDueWithin24h).sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0)).slice(0, 8), "dueAt"));
  }
}

async function projectSheetWidgetTasks(widget) {
  if (widget.boardId) {
    const snapshot = await api(`/api/pm/boards/${encodeURIComponent(widget.boardId)}`);
    return snapshot.tasks || [];
  }
  return state.tasks || [];
}

function taskWidgetRows(tasks, dateKey) {
  if (!tasks.length) return [plainWidgetNode("No matching tasks.")];
  return tasks.map((task) => {
    const row = document.createElement("div");
    row.className = "widget-row widget-link-row";
    row.innerHTML = `<div class="widget-row-title">${escapeHtml(task.title || "Task")}</div><div class="widget-row-meta">${escapeHtml(task.status || "")} / ${escapeHtml(task.priority || "")} / ${formatDate(task[dateKey])}</div>`;
    row.addEventListener("click", () => openTaskReference({ ...task, projectId: task.projectId || state.activeProjectId }).catch((error) => setError(error.message)));
    return row;
  });
}

function completionPieHtml(tasks) {
  const done = tasks.filter((task) => task.status === "done").length;
  const total = tasks.length || 1;
  const percent = Math.round((done / total) * 100);
  return `
    <div class="project-pie-widget">
      <div class="project-pie" style="--done:${percent}%"></div>
      <div class="widget-row-title">${done} done / ${tasks.length - done} not done</div>
      <div class="widget-row-meta">${percent}% complete</div>
    </div>
  `;
}

function isDueWithin24h(task) {
  if (!task.dueAt || task.status === "done") return false;
  const due = new Date(task.dueAt).getTime();
  if (!Number.isFinite(due)) return false;
  const delta = due - Date.now();
  return delta >= 0 && delta <= 24 * 60 * 60 * 1000;
}

function renderProjectSheetSettings(widget) {
  const form = document.createElement("div");
  form.className = "home-widget-settings";
  const usesBoard = ["board_latest", "board_new", "completion_pie"].includes(widget.kind);
  form.innerHTML = `
    ${usesBoard ? `<select>${state.boards.map((board) => `<option value="${escapeHtml(board.id)}">${escapeHtml(board.name)}</option>`).join("")}</select>` : ""}
    <label class="widget-opacity-control">Opacity <input type="range" min="15" max="100" value="${Math.round(Math.max(0.15, Math.min(1, Number(widget.opacity ?? 1))) * 100)}"></label>
    <button type="button">Rename</button>
    <button type="button">Delete</button>
  `;
  const boardSelect = form.querySelector("select");
  if (boardSelect) {
    boardSelect.value = widget.boardId || state.boards[0]?.id || "";
    boardSelect.addEventListener("change", () => updateProjectSheetWidget(widget.id, { boardId: boardSelect.value }));
  }
  const opacityInput = form.querySelector('input[type="range"]');
  opacityInput?.addEventListener("input", () => updateProjectSheetWidget(widget.id, { opacity: Number(opacityInput.value) / 100 }));
  const [rename, remove] = Array.from(form.querySelectorAll("button"));
  rename.addEventListener("click", () => {
    const title = window.prompt("Widget title", widget.title || "Project widget");
    if (!title) return;
    updateProjectSheetWidget(widget.id, { title: title.slice(0, 80) });
  });
  remove.addEventListener("click", () => deleteProjectSheetWidget(widget.id));
  return form;
}

function renderProjectSheetAnchor(widget) {
  const anchor = document.createElement("button");
  anchor.type = "button";
  anchor.className = "home-widget-anchor";
  anchor.title = "Move widget";
  anchor.addEventListener("dragstart", (event) => event.preventDefault());
  anchor.addEventListener("pointerdown", (event) => startProjectSheetWidgetMove(event, widget));
  return anchor;
}

function renderProjectSheetResizeHandle(widget) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "home-widget-resize";
  handle.title = "Resize widget";
  handle.addEventListener("dragstart", (event) => event.preventDefault());
  handle.addEventListener("pointerdown", (event) => startProjectSheetWidgetResize(event, widget));
  return handle;
}

function openProjectSidebar() {
  els.projectSidebarBackdrop.hidden = false;
  if (state.projectBoardsExpanded) {
    loadProjectSidebarBoards()
      .then(renderProjects)
      .catch((error) => setError(error.message));
  }
}

function closeProjectSidebar() {
  els.projectSidebarBackdrop.hidden = true;
}

async function openEpicSidebar() {
  els.epicSidebarBackdrop.hidden = false;
  await loadGlobalEpics();
}

function closeEpicSidebar() {
  els.epicSidebarBackdrop.hidden = true;
}

async function loadGlobalEpics() {
  const epics = [];
  for (const project of state.projects) {
    try {
      const { epics: projectEpics } = await api(`/api/pm/projects/${project.id}/epics`);
      for (const epic of projectEpics || []) epics.push({ ...epic, projectName: project.name, projectKey: project.key });
    } catch (error) {
      console.debug("Failed to load project epics", { projectId: project.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  state.globalEpics = epics;
  renderGlobalEpics();
}

function renderGlobalEpics() {
  if (!els.globalEpicList) return;
  if (!state.globalEpics.length) {
    els.globalEpicList.innerHTML = `<div class="drawer-empty">No epics.</div>`;
    return;
  }
  els.globalEpicList.replaceChildren(...state.globalEpics.map((epic) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-card ${epic.id === state.activeEpicId ? "active" : ""}`;
    button.innerHTML = `<div><div class="card-title">${escapeHtml(epic.title)}</div><div class="card-meta">${escapeHtml(epic.projectKey || "")} / ${escapeHtml(epic.key || "")} / ${escapeHtml(epic.status || "")}</div></div><button class="project-edit-button" type="button" title="Edit epic">⚙</button>`;
    button.querySelector(".project-edit-button").addEventListener("click", (event) => {
      event.stopPropagation();
      state.activeProjectId = epic.projectId;
      openEpicModal(epic);
    });
    button.addEventListener("click", () => {
      closeEpicSidebar();
      state.activeProjectId = epic.projectId;
      state.activeEpicId = epic.id;
      state.activeBoardId = null;
      navigatePm(pmEpicPath(epic.projectId, epic.id));
      loadProjects().catch((error) => setError(error.message));
    });
    return button;
  }));
}

function openProjectModal(project = null) {
  state.editingProjectId = project?.id || null;
  els.projectModalTitle.textContent = project ? "Edit project" : "Create project";
  els.projectKey.value = project?.key || "";
  els.projectName.value = project?.name || "";
  els.projectDescription.value = project?.description || "";
  if (els.projectManagementFields) els.projectManagementFields.hidden = !project;
  if (els.deleteProjectBtn) els.deleteProjectBtn.hidden = !project;
  els.projectModal.hidden = false;
}

function closeProjectModal() {
  state.editingProjectId = null;
  els.projectModal.hidden = true;
  els.projectForm.reset();
}

function openTeamModal() {
  if (!activeProject()) return;
  els.teamModal.hidden = false;
}

function closeTeamModal() {
  els.teamModal.hidden = true;
}

function openLabelsModal() {
  if (!activeProject()) return;
  els.labelsModal.hidden = false;
}

function closeLabelsModal() {
  els.labelsModal.hidden = true;
}

function openBoardModal() {
  if (!activeProject()) return;
  if (state.activeBoardId || state.activeEpicId) return;
  els.boardName.value = "";
  renderBoardManagementModal();
  els.boardModal.hidden = false;
}

function closeBoardModal() {
  els.boardModal.hidden = true;
  els.boardForm.reset();
}

function renderBoardManagementModal() {
  els.boardEpic.replaceChildren(option("Project board", ""), ...state.epics.map((epic) => option(`${epic.key || ""} / ${epic.title}`, epic.id)));
  els.boardEpic.value = "";
  els.boardDeleteSelect.replaceChildren(option("Select board to delete", ""), ...state.boards.map((board) => option(board.name, board.id)));
  els.deleteBoardBtn.disabled = true;
}

function openEpicModal(epic = null) {
  if (!activeProject()) return;
  state.editingEpicId = epic?.id || null;
  els.epicModalTitle.textContent = epic ? "Edit epic" : "Create epic";
  els.epicKey.value = epic?.key || "";
  els.epicTitle.value = epic?.title || "";
  els.deleteEpicBtn.hidden = !epic;
  els.epicForm.querySelector('button[type="submit"]').disabled = !els.epicTitle.value.trim();
  els.epicModal.hidden = false;
  (epic ? els.epicTitle : els.epicKey).focus();
}

function closeEpicModal() {
  state.editingEpicId = null;
  els.epicModal.hidden = true;
  els.epicForm.reset();
}

function wireProjectDrag(button, startIndex) {
  let timer = 0;
  button.addEventListener("mousedown", () => {
    timer = window.setTimeout(() => {
      button.draggable = true;
      button.classList.add("project-drag-ready");
    }, 500);
  });
  for (const eventName of ["mouseup", "mouseleave"]) {
    button.addEventListener(eventName, () => {
      clearTimeout(timer);
      if (!button.classList.contains("dragging")) button.draggable = false;
      button.classList.remove("project-drag-ready");
    });
  }
  button.addEventListener("dragstart", (event) => {
    if (!button.draggable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(startIndex));
    button.classList.add("dragging");
  });
  button.addEventListener("dragover", (event) => {
    event.preventDefault();
    clearProjectDropLines();
    button.classList.add("drop-before");
  });
  button.addEventListener("drop", (event) => {
    event.preventDefault();
    const from = Number(event.dataTransfer.getData("text/plain"));
    const to = Number(startIndex);
    clearProjectDropLines();
    if (!Number.isFinite(from) || from === to) return;
    const next = [...state.projects];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    state.projects = next;
    renderProjects();
  });
  button.addEventListener("dragend", () => {
    button.classList.remove("dragging", "project-drag-ready");
    button.draggable = false;
    clearProjectDropLines();
    renderProjects();
  });
}

function clearProjectDropLines() {
  for (const item of els.projectList.querySelectorAll(".drop-before")) item.classList.remove("drop-before");
}

function wireProjectDrag(button, startIndex) {
  let timer = 0;
  let dragging = false;
  let targetIndex = startIndex;
  button.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    timer = window.setTimeout(() => {
      dragging = true;
      button.classList.add("project-drag-ready");
      document.body.classList.add("dragging-project-card");
    }, 500);
  });
  button.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    const cards = Array.from(els.projectList.querySelectorAll(".project-card"));
    const target = cards.find((card) => {
      const rect = card.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (!target) return;
    targetIndex = cards.indexOf(target);
    clearProjectDropLines();
    target.classList.add("drop-before");
  });
  const stop = () => {
    clearTimeout(timer);
    if (dragging && targetIndex !== startIndex) {
      const next = [...state.projects];
      const [moved] = next.splice(startIndex, 1);
      next.splice(targetIndex, 0, moved);
      state.projects = next;
      saveProjectOrder();
    }
    dragging = false;
    button.classList.remove("project-drag-ready");
    document.body.classList.remove("dragging-project-card");
    clearProjectDropLines();
    renderProjects();
  };
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("pointerleave", () => clearTimeout(timer));
}

function wireProjectDrag(button, startIndex) {
  let timer = 0;
  let dragging = false;
  let targetIndex = startIndex;
  const stopDrag = () => {
    clearTimeout(timer);
    document.removeEventListener("pointermove", moveDrag);
    document.removeEventListener("pointerup", stopDrag);
    document.removeEventListener("pointercancel", stopDrag);
    if (dragging && targetIndex !== startIndex) {
      const next = [...state.projects];
      const [moved] = next.splice(startIndex, 1);
      next.splice(targetIndex, 0, moved);
      state.projects = next;
      saveProjectOrder();
      state.projectDragSuppressClickUntil = Date.now() + 500;
    }
    dragging = false;
    button.classList.remove("project-drag-ready");
    document.body.classList.remove("dragging-project-card");
    clearProjectDropLines();
    renderProjects();
  };
  const moveDrag = (event) => {
    if (!dragging) return;
    event.preventDefault();
    const cards = Array.from(els.projectList.querySelectorAll(".project-card"));
    const target = cards.find((card) => {
      const rect = card.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (!target) return;
    targetIndex = cards.indexOf(target);
    clearProjectDropLines();
    target.classList.add("drop-before");
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      dragging = true;
      targetIndex = startIndex;
      button.classList.add("project-drag-ready");
      document.body.classList.add("dragging-project-card");
      document.addEventListener("pointermove", moveDrag);
      document.addEventListener("pointerup", stopDrag);
      document.addEventListener("pointercancel", stopDrag);
    }, 500);
  });
  button.addEventListener("pointerup", () => clearTimeout(timer));
  button.addEventListener("pointercancel", () => clearTimeout(timer));
}

function renderMembers() {
  const options = [optionEl("", "unassigned"), ...state.members.map((member) => optionEl(member.id, memberLabel(member)))];
  els.taskCreateAssignee.replaceChildren(...options.map((option) => option.cloneNode(true)));
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
        <div class="label-edit-row">
          <input maxlength="40" value="${escapeHtml(label.name)}" />
          <input type="color" value="${escapeHtml(label.color)}" />
          <button class="mini-button" data-action="save" type="button">Save</button>
          <button class="mini-button" data-action="delete" type="button">Delete</button>
        </div>
      `;
      const [nameInput, colorInput] = card.querySelectorAll("input");
      card.querySelector('[data-action="save"]').addEventListener("click", () => updateLabel(label, nameInput.value, colorInput.value).catch((error) => setError(error.message)));
      card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteLabel(label).catch((error) => setError(error.message)));
      return card;
    })
  );
}

function renderSavedFilters() {
  if (!els.labelFilter || !els.savedFilterSelect) return;
  const currentLabel = els.labelFilter.value;
  els.labelFilter.replaceChildren(
    optionEl("", "All labels"),
    ...state.labels.map((label) => optionEl(label.id, label.name))
  );
  if (state.labels.some((label) => label.id === currentLabel)) els.labelFilter.value = currentLabel;

  const currentFilter = els.savedFilterSelect.value;
  els.savedFilterSelect.replaceChildren(
    optionEl("", "Saved filters"),
    ...state.savedFilters.map((filter) => optionEl(filter.id, filter.name))
  );
  if (state.savedFilters.some((filter) => filter.id === currentFilter)) els.savedFilterSelect.value = currentFilter;
  const selected = state.savedFilters.find((filter) => filter.id === els.savedFilterSelect.value);
  if (selected) els.savedFilterName.value = selected.name;
  els.updateFilterBtn.disabled = !activeProject() || !els.savedFilterSelect.value;
  els.deleteFilterBtn.disabled = !activeProject() || !els.savedFilterSelect.value;
}

function renderEpics() {
  els.epicList.replaceChildren(
    ...state.epics.map((epic) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `epic-card ${epic.id === state.activeEpicId ? "active" : ""}`;
      button.innerHTML = `<div><div class="card-title">${escapeHtml(epic.title)}</div><div class="card-meta">${escapeHtml(epic.key || "")} / ${escapeHtml(epic.status)} / ${escapeHtml(epic.priority)}</div></div><button class="project-edit-button" type="button" data-action="edit" title="Edit epic">⚙</button>`;
      button.addEventListener("click", async (event) => {
        if (event.target?.closest?.("[data-action='edit']")) {
          openEpicModal(epic);
          return;
        }
        state.activeEpicId = epic.id;
        state.activeBoardId = null;
        state.activeSprintId = "__backlog";
        navigatePm(pmEpicPath(activeProject()?.id, epic.id));
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

function renderWebhookDeliveries() {
  const summary = state.webhookSummary || {};
  els.webhookDeadCount.textContent = String((summary.dead || 0) + (summary.retrying || 0));
  els.webhookSummary.replaceChildren(
    webhookSummaryChip("pending", summary.pending || 0),
    webhookSummaryChip("retrying", summary.retrying || 0),
    webhookSummaryChip("delivered", summary.delivered || 0),
    webhookSummaryChip("dead", summary.dead || 0)
  );
  if (state.webhookDeliveries.length === 0) {
    els.webhookDeliveryList.innerHTML = `<div class="drawer-empty">No webhook deliveries.</div>`;
    return;
  }
  els.webhookDeliveryList.replaceChildren(
    ...state.webhookDeliveries.map((delivery) => {
      const card = document.createElement("article");
      card.className = `webhook-card ${delivery.status}`;
      const canRetry = delivery.status !== "delivered";
      card.innerHTML = `
        <div class="webhook-head">
          <div>
            <div class="webhook-url">${escapeHtml(delivery.url)}</div>
            <div class="card-meta">${escapeHtml(delivery.eventType)} / ${escapeHtml(delivery.deliveryId)}</div>
          </div>
          <span class="badge">${escapeHtml(delivery.status)}</span>
        </div>
        <div class="card-meta">attempts: ${escapeHtml(delivery.attempts)} / HTTP: ${escapeHtml(delivery.responseStatus || "-")} / created: ${formatDate(delivery.createdAt)}</div>
        <div class="card-meta">next: ${escapeHtml(delivery.nextAttemptAt ? formatDate(delivery.nextAttemptAt) : "-")} / delivered: ${escapeHtml(delivery.deliveredAt ? formatDate(delivery.deliveredAt) : "-")}</div>
        ${delivery.error ? `<div class="webhook-error">${escapeHtml(delivery.error)}</div>` : ""}
        <div class="attachment-actions">
          <button class="mini-button" type="button" ${canRetry ? "" : "disabled"}>Retry</button>
        </div>
      `;
      card.querySelector("button").addEventListener("click", () => retryWebhookDelivery(delivery).catch((error) => setError(error.message)));
      return card;
    })
  );
}

function webhookSummaryChip(label, count) {
  const element = document.createElement("span");
  element.textContent = `${label}: ${count}`;
  return element;
}

function renderOpsStatus() {
  const status = state.opsStatus;
  if (!status) {
    els.opsProblemCount.textContent = "0";
    els.opsStatusList.innerHTML = `<div class="drawer-empty">No operator status loaded.</div>`;
    return;
  }
  const problems = [
    !status.bootstrap?.bootstrapped,
    !status.bootstrap?.tokenConfigured && !status.bootstrap?.bootstrapped,
    !status.database?.reachable,
    !status.database?.schemaApplied,
    status.webhooks?.summary?.dead > 0,
    status.webhooks?.summary?.retrying > 0,
    !status.smtp?.configured,
    !status.automation?.configured
  ].filter(Boolean).length;
  els.opsProblemCount.textContent = String(problems);
  els.bootstrapForm.hidden = Boolean(status.bootstrap?.bootstrapped);
  if (!status.bootstrap?.bootstrapped) {
    els.bootstrapProjectKey.value ||= "PROJECTEGO";
    els.bootstrapProjectName.value ||= "ProjectEGO";
  }
  els.opsStatusList.replaceChildren(
    opsCard("Bootstrap", status.bootstrap?.bootstrapped ? "ok" : "warn", [
      `bootstrapped: ${yesNo(status.bootstrap?.bootstrapped)}`,
      `bootstrap token configured: ${yesNo(status.bootstrap?.tokenConfigured)}`,
      `expected user: ${status.bootstrap?.expectedUsername || "current authenticated user"}`,
      `owners/projects/users: ${status.bootstrap?.ownerCount || 0}/${status.bootstrap?.projectCount || 0}/${status.bootstrap?.userCount || 0}`,
      status.bootstrap?.bootstrapped ? "" : "POST /api/pm/bootstrap with PM_BOOTSTRAP_TOKEN to initialize the first owner."
    ]),
    opsCard("Database", status.database?.reachable && status.database?.schemaApplied ? "ok" : "error", [
      `configured: ${yesNo(status.database?.configured)}`,
      `reachable: ${yesNo(status.database?.reachable)}`,
      `schema applied: ${yesNo(status.database?.schemaApplied)}`,
      `migrations: ${(status.database?.schemaMigrations || []).join(", ") || "none"}`,
      status.database?.message ? `message: ${status.database.message}` : ""
    ]),
    opsCard("Webhooks", status.webhooks?.summary?.dead || status.webhooks?.summary?.retrying ? "warn" : "ok", [
      `configured: ${yesNo(status.webhooks?.configured)}`,
      `urls: ${status.webhooks?.urls || 0}`,
      `max attempts: ${status.webhooks?.maxAttempts || 0}`,
      `retry interval: ${status.webhooks?.retryIntervalMs || 0} ms`,
      `pending/retrying/dead: ${status.webhooks?.summary?.pending || 0}/${status.webhooks?.summary?.retrying || 0}/${status.webhooks?.summary?.dead || 0}`
    ]),
    opsCard("SMTP", status.smtp?.configured ? "ok" : "warn", [
      `configured: ${yesNo(status.smtp?.configured)}`,
      `host: ${yesNo(status.smtp?.hostConfigured)}`,
      `from: ${yesNo(status.smtp?.fromConfigured)}`
    ]),
    opsCard("Automation", status.automation?.configured ? "ok" : "warn", [
      `PM_AUTOMATION_TOKEN configured: ${yesNo(status.automation?.configured)}`
    ])
  );
}

function opsCard(title, level, lines) {
  const card = document.createElement("article");
  card.className = `ops-card ${level}`;
  card.innerHTML = `
    <div class="card-title">${escapeHtml(title)}</div>
    <div class="card-body">${lines.filter(Boolean).map((line) => escapeHtml(line)).join("<br />")}</div>
  `;
  return card;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function renderTasks() {
  const statusFilter = els.statusFilter.value;
  const priorityFilter = els.priorityFilter.value;
  const labelFilter = els.labelFilter.value;
  const dueFilter = els.dueFilter.value;
  const search = els.taskSearch.value.trim();
  const tasks = state.tasks.filter((task) => {
    if (state.activeEpicId && task.epicId !== state.activeEpicId) return false;
    if (state.activeSprintId === "__backlog" && task.sprintId) return false;
    if (!["__all", "__backlog"].includes(state.activeSprintId) && task.sprintId !== state.activeSprintId) return false;
    if (statusFilter && task.status !== statusFilter) return false;
    if (priorityFilter && task.priority !== priorityFilter) return false;
    if (labelFilter && !taskHasLabel(task, labelFilter)) return false;
    if (dueFilter && !taskMatchesDueFilter(task, dueFilter)) return false;
    if (search && !taskMatchesSearch(task, search)) return false;
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
          ${taskLabelChips(task)}
        </div>
        <div class="task-badges">
          <span class="badge">${escapeHtml(task.status)}</span>
          <span class="badge">${escapeHtml(task.priority)}</span>
          <span class="badge">${escapeHtml(assigneeLabel(task.assigneeId))}</span>
          <span class="badge ${isOverdue(task) ? "overdue" : ""}">${escapeHtml(dueLabel(task))}</span>
        </div>
      `;
      button.addEventListener("click", () => openTask(task));
      return button;
    })
  );
}

function renderBoard() {
  if (!state.board) {
    if (state.activeEpicId) {
      const epic = state.epics.find((item) => item.id === state.activeEpicId);
      els.activeBoardLine.textContent = `${epic?.title || "Epic"} / task list`;
      els.kanbanBoard.replaceChildren();
      els.kanbanBoard.hidden = true;
      els.taskList.style.display = "grid";
      return;
    }
    els.activeBoardLine.textContent = "No board";
    els.kanbanBoard.replaceChildren();
    els.taskList.replaceChildren();
    els.kanbanBoard.hidden = false;
    els.taskList.style.display = "none";
    return;
  }
  els.activeBoardLine.textContent = `${state.columns.length} columns`;
  state.boardViewMode = els.boardViewMode.value || "kanban";
  state.boardListSort = els.boardListSort.value || "created_desc";
  els.kanbanBoard.hidden = state.boardViewMode === "list";
  els.taskList.style.display = state.boardViewMode === "list" ? "grid" : "none";
  if (state.boardViewMode === "list") {
    els.kanbanBoard.replaceChildren();
    renderBoardTaskList();
    return;
  }
  els.taskList.replaceChildren();
  const statusFilter = els.statusFilter.value;
  const priorityFilter = els.priorityFilter.value;
  const labelFilter = els.labelFilter.value;
  const dueFilter = els.dueFilter.value;
  const search = els.taskSearch.value.trim();
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
        .filter((task) => !labelFilter || taskHasLabel(task, labelFilter))
        .filter((task) => !dueFilter || taskMatchesDueFilter(task, dueFilter))
        .filter((task) => !search || taskMatchesSearch(task, search))
        .sort((a, b) => (a.boardPosition ?? 1000000000) - (b.boardPosition ?? 1000000000));
      dropzone.replaceChildren(...tasks.map(renderKanbanCard));
      return columnEl;
    })
  );
}

function filteredBoardTasks() {
  const statusFilter = els.statusFilter.value;
  const priorityFilter = els.priorityFilter.value;
  const labelFilter = els.labelFilter.value;
  const dueFilter = els.dueFilter.value;
  const search = els.taskSearch.value.trim();
  return state.boardTasks
    .filter((task) => !state.activeEpicId || task.epicId === state.activeEpicId)
    .filter((task) => state.activeSprintId !== "__backlog" || !task.sprintId)
    .filter((task) => ["__all", "__backlog"].includes(state.activeSprintId) || task.sprintId === state.activeSprintId)
    .filter((task) => !statusFilter || task.status === statusFilter)
    .filter((task) => !priorityFilter || task.priority === priorityFilter)
    .filter((task) => !labelFilter || taskHasLabel(task, labelFilter))
    .filter((task) => !dueFilter || taskMatchesDueFilter(task, dueFilter))
    .filter((task) => !search || taskMatchesSearch(task, search));
}

function renderBoardTaskList() {
  const sorted = [...filteredBoardTasks()].sort((a, b) => {
    const sort = els.boardListSort.value || "created_desc";
    const key = sort.startsWith("updated") ? "updatedAt" : "createdAt";
    const left = new Date(a[key] || 0).getTime();
    const right = new Date(b[key] || 0).getTime();
    return sort.endsWith("_asc") ? left - right : right - left;
  });
  els.taskList.replaceChildren(...sorted.map(renderBoardTaskListRow));
}

function renderBoardTaskListRow(task) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `board-task-row ${state.activeTask?.id === task.id ? "active" : ""}`;
  row.innerHTML = `
    <span class="status-badge">${escapeHtml(task.status)}</span>
    <span class="board-task-main">
      <span class="board-task-title">${escapeHtml(task.title)}</span>
      <span class="board-task-meta">${escapeHtml(task.priority)} / ${escapeHtml(assigneeLabel(task.assigneeId))} / created ${formatDate(task.createdAt)} / updated ${formatDate(task.updatedAt)}</span>
    </span>
  `;
  row.addEventListener("click", () => openTask(task));
  return row;
}

function renderKanbanCard(task) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "kanban-card";
  card.draggable = true;
  card.dataset.taskId = task.id;
  let pointerStart = null;
  let dragged = false;
  card.innerHTML = `
    <div class="card-title">${escapeHtml(task.title)}</div>
    <div class="card-meta">${escapeHtml(task.priority)} / ${escapeHtml(assigneeLabel(task.assigneeId))} / ${escapeHtml(dueLabel(task))} / ${escapeHtml(sprintLabel(task.sprintId))} / v${task.version}</div>
    <div class="card-body">${escapeHtml(task.description || "")}</div>
    ${taskLabelChips(task)}
  `;
  card.addEventListener("pointerdown", (event) => {
    pointerStart = { x: event.clientX, y: event.clientY, time: Date.now() };
    dragged = false;
  });
  card.addEventListener("pointerup", (event) => {
    if (!pointerStart || dragged) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    const duration = Date.now() - pointerStart.time;
    if (distance <= 6 && duration < 450) openTask(task);
  });
  card.addEventListener("dragstart", (event) => {
    dragged = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    window.setTimeout(() => {
      dragged = false;
    }, 0);
  });
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
}

function openTask(task, mode = "view", options = {}) {
  if (options.navigate !== false) {
    const projectId = task.projectId || state.activeProjectId;
    if (projectId) navigatePm(pmTaskPath(projectId, state.activeBoardId, task.id));
  }
  state.activeTask = task;
  state.taskDrawerMode = mode;
  els.taskDrawer.hidden = false;
  window.requestAnimationFrame(() => els.taskDrawer.classList.add("open"));
  els.drawerTitle.textContent = task.title;
  els.drawerMeta.textContent = `version ${task.version}`;
  els.editTaskTitle.value = task.title;
  els.editTaskStatus.value = task.status;
  els.editTaskPriority.value = task.priority;
  els.editTaskAssignee.value = task.assigneeId || "";
  els.editTaskSprint.value = task.sprintId || "";
  els.editTaskDueAt.value = dateInputValue(task.dueAt);
  els.editTaskDescription.value = task.description || "";
  els.archiveTaskBtn.textContent = task.archivedAt ? "Unarchive task" : "Archive task";
  state.comments = [];
  state.taskLabels = [];
  state.dependencies = { blockingTasks: [], blockedTasks: [] };
  state.attachments = [];
  state.activity = [];
  renderTaskView();
  renderTaskDrawerMode();
  renderDrawerData();
  renderTasks();
  loadTaskDrawerData(task.id).catch((error) => setError(error.message));
}

function closeTask(options = {}) {
  const navigate = options?.navigate !== false;
  const projectId = state.activeTask?.projectId || state.activeProjectId;
  const boardId = state.activeBoardId;
  const epicId = state.activeEpicId;
  state.activeTask = null;
  els.taskDrawer.classList.remove("open");
  closeActivityDrawer();
  if (navigate && projectId) navigatePm(epicId ? pmEpicPath(projectId, epicId) : pmBoardPath(projectId, boardId));
  window.setTimeout(() => {
    if (!state.activeTask) els.taskDrawer.hidden = true;
  }, 180);
  renderTasks();
}

function collapseTaskDrawer() {
  els.taskDrawer.classList.remove("open");
  closeActivityDrawer();
  window.setTimeout(() => {
    if (!els.taskDrawer.classList.contains("open")) els.taskDrawer.hidden = true;
  }, 180);
}

function renderTaskDrawerMode() {
  const editing = state.taskDrawerMode === "edit";
  if (els.taskViewPanel) els.taskViewPanel.hidden = editing;
  if (els.taskEditForm) els.taskEditForm.hidden = !editing;
  if (els.deleteTaskBtn) els.deleteTaskBtn.hidden = !editing;
  if (els.archiveTaskBtn) els.archiveTaskBtn.hidden = !editing;
  if (els.addTaskToEpicBtn) els.addTaskToEpicBtn.hidden = editing;
  if (els.editTaskModeBtn) els.editTaskModeBtn.textContent = editing ? "View" : "Edit";
}

function toggleTaskDrawerMode() {
  state.taskDrawerMode = state.taskDrawerMode === "edit" ? "view" : "edit";
  renderTaskDrawerMode();
}

function renderTaskView() {
  if (!els.taskViewPanel || !state.activeTask) return;
  const task = state.activeTask;
  els.taskViewPanel.replaceChildren(
    taskInfoRow("Title", task.title),
    taskInfoRow("Status", task.status),
    taskInfoRow("Priority", task.priority),
    taskInfoRow("Assignee", assigneeLabel(task.assigneeId)),
    taskInfoRow("Sprint", sprintLabel(task.sprintId)),
    taskInfoRow("Due date", dueLabel(task)),
    taskInfoRow("Entity ID", task.id),
    taskInfoRow("Description", task.description || "-", "wide")
  );
}

function taskInfoRow(label, value, className = "") {
  const row = document.createElement("div");
  row.className = `task-info-row ${className}`.trim();
  const name = document.createElement("span");
  name.className = "task-info-label";
  name.textContent = label;
  const content = document.createElement("span");
  content.className = "task-info-value";
  content.textContent = value || "-";
  row.append(name, content);
  return row;
}

function openActivityDrawer() {
  if (!state.activeTask || !els.activityDrawer) return;
  els.activityDrawer.hidden = false;
  window.requestAnimationFrame(() => els.activityDrawer.classList.add("open"));
}

function closeActivityDrawer() {
  if (!els.activityDrawer) return;
  els.activityDrawer.classList.remove("open");
  window.setTimeout(() => {
    if (!els.activityDrawer.classList.contains("open")) els.activityDrawer.hidden = true;
  }, 180);
}

async function createProject(event) {
  event.preventDefault();
  setError("");
  const payload = {
    key: els.projectKey.value,
    name: els.projectName.value,
    description: els.projectDescription.value
  };
  const result = state.editingProjectId
    ? await api(`/api/pm/projects/${state.editingProjectId}`, { method: "PATCH", body: JSON.stringify(payload) })
    : await api("/api/pm/projects", { method: "POST", body: JSON.stringify(payload) });
  closeProjectModal();
  state.activeProjectId = result.project.id;
  navigatePm(pmProjectPath(result.project.id));
  await loadProjects();
}

async function deleteCurrentProjectPermanently() {
  const project = state.projects.find((item) => item.id === state.editingProjectId) || activeProject();
  if (!project) return;
  const firstConfirmed = await confirmAction({
    title: "Delete project",
    message: `THIS ACTION WILL DELETE THIS PROJECT PERMANENTLY!\n\nProject: ${project.key} / ${project.name}`
  });
  if (!firstConfirmed) return;
  const secondConfirmed = await confirmAction({
    title: "Delete project files",
    message: "THIS PROJECT MAY CONTAIN TASKS, BOARDS, COMMENTS AND ATTACHED FILES. DOWNLOAD WHAT YOU NEED OR YOU WILL LOSE IT PERMANENTLY!"
  });
  if (!secondConfirmed) return;
  const result = await api(`/api/pm/projects/${project.id}/permanent`, { method: "DELETE" });
  showToast(`Project deleted. Tasks: ${result.deletedTaskIds?.length || 0}, attachments: ${result.deletedAttachments || 0}.`, "info");
  closeProjectModal();
  if (state.activeProjectId === project.id) {
    state.activeProjectId = null;
    state.activeBoardId = null;
    state.activeTask = null;
    closeTask({ navigate: false });
  }
  navigatePm("/pm/projects");
  await loadProjects();
}

async function createBoard(event) {
  event.preventDefault();
  const project = activeProject();
  if (!project) return;
  const result = await api(`/api/pm/projects/${project.id}/boards/kanban`, {
    method: "POST",
    body: JSON.stringify({
      name: els.boardName.value,
      epicId: els.boardEpic.value || undefined
    })
  });
  closeBoardModal();
  state.boards = [...state.boards.filter((board) => board.id !== result.board.id), result.board];
  state.projectBoardMap.set(project.id, state.boards);
  state.activeBoardId = result.board.id;
  state.activeEpicId = null;
  navigatePm(pmBoardPath(project.id, result.board.id));
  await loadProjectData();
}

async function openKanbanForActiveProject() {
  const project = activeProject();
  if (!project) return;
  if (!state.boards.length) {
    const result = await ensureDefaultBoard(project.id);
    state.boards = [result.board];
    state.activeBoardId = result.board.id;
  } else {
    state.activeBoardId = state.activeBoardId || state.boards[0].id;
  }
  state.activeEpicId = null;
  navigatePm(pmBoardPath(project.id, state.activeBoardId));
  await loadProjectData();
}

async function createEpic(event) {
  event.preventDefault();
  const project = activeProject();
  if (!project) return;
  const payload = { key: els.epicKey.value, title: els.epicTitle.value };
  const { epic } = state.editingEpicId
    ? await api(`/api/pm/epics/${state.editingEpicId}`, { method: "PATCH", body: JSON.stringify({ ...payload, expectedVersion: state.epics.find((item) => item.id === state.editingEpicId)?.version }) })
    : await api(`/api/pm/projects/${project.id}/epics`, { method: "POST", body: JSON.stringify(payload) });
  closeEpicModal();
  state.activeEpicId = epic.id;
  await loadProjectData();
}

async function deleteCurrentEpic() {
  const epic = state.epics.find((item) => item.id === state.editingEpicId || item.id === state.activeEpicId);
  if (!epic) return;
  const confirmed = await confirmAction({
    title: "Delete epic",
    message: `THIS ACTION WILL DELETE THIS EPIC PERMANENTLY!\n\nTasks assigned to this Epic will stay intact and only lose the Epic link.\n\nEpic: ${epic.key || ""} / ${epic.title}`
  });
  if (!confirmed) return;
  await api(`/api/pm/epics/${epic.id}`, { method: "DELETE" });
  closeEpicModal();
  if (state.activeEpicId === epic.id) state.activeEpicId = null;
  navigatePm(pmProjectPath(epic.projectId));
  await loadProjectData();
}

async function addMember(event) {
  event?.preventDefault();
  const project = activeProject();
  if (!project) return;
  await api(`/api/pm/projects/${project.id}/members`, {
    method: "POST",
    body: JSON.stringify({
      identifier: els.memberIdentifier.value,
      role: els.memberRole.value
    })
  });
  els.memberIdentifier.value = "";
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
  event?.preventDefault();
  const project = activeProject();
  if (!project) return;
  const { label } = await api(`/api/pm/projects/${project.id}/labels`, {
    method: "POST",
    body: JSON.stringify({
      name: els.labelName.value,
      color: els.labelColor.value
    })
  });
  els.labelName.value = "";
  els.labelColor.value = "#6b7280";
  state.labels = [...state.labels.filter((item) => item.id !== label.id), label].sort((a, b) => a.name.localeCompare(b.name));
  renderProjectLabels();
  renderTaskLabels();
}

async function updateLabel(label, name, color) {
  const project = activeProject();
  if (!project) return;
  const { label: updated } = await api(`/api/pm/projects/${project.id}/labels/${label.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name, color })
  });
  state.labels = state.labels.map((item) => (item.id === updated.id ? updated : item)).sort((a, b) => a.name.localeCompare(b.name));
  state.taskLabels = state.taskLabels.map((item) => (item.id === updated.id ? updated : item));
  renderProjectLabels();
  renderSavedFilters();
  renderDrawerData();
  renderTasks();
  renderBoard();
}

async function deleteLabel(label) {
  const project = activeProject();
  if (!project) return;
  await api(`/api/pm/projects/${project.id}/labels/${label.id}`, { method: "DELETE" });
  state.labels = state.labels.filter((item) => item.id !== label.id);
  state.taskLabels = state.taskLabels.filter((item) => item.id !== label.id);
  state.tasks = state.tasks.map((task) => ({ ...task, labelIds: (task.labelIds || []).filter((id) => id !== label.id) }));
  state.boardTasks = state.boardTasks.map((task) => ({ ...task, labelIds: (task.labelIds || []).filter((id) => id !== label.id) }));
  if (state.activeTask) state.activeTask = { ...state.activeTask, labelIds: (state.activeTask.labelIds || []).filter((id) => id !== label.id) };
  renderProjectLabels();
  renderSavedFilters();
  renderDrawerData();
  renderTasks();
  renderBoard();
}

async function saveCurrentFilter() {
  const project = activeProject();
  if (!project) return;
  const name = els.savedFilterName.value.trim() || suggestedFilterName();
  if (!name || !name.trim()) return;
  const { filter } = await api(`/api/pm/projects/${project.id}/filters`, {
    method: "POST",
    body: JSON.stringify({
      name,
      filter: currentFilterState()
    })
  });
  state.savedFilters = [...state.savedFilters, filter].sort((a, b) => a.name.localeCompare(b.name));
  els.savedFilterSelect.value = filter.id;
  renderSavedFilters();
}

async function updateSelectedFilter() {
  const project = activeProject();
  const filterId = els.savedFilterSelect.value;
  if (!project || !filterId) return;
  const { filter } = await api(`/api/pm/projects/${project.id}/filters/${encodeURIComponent(filterId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: els.savedFilterName.value.trim() || suggestedFilterName(),
      filter: currentFilterState()
    })
  });
  state.savedFilters = state.savedFilters.map((item) => (item.id === filter.id ? filter : item)).sort((a, b) => a.name.localeCompare(b.name));
  els.savedFilterSelect.value = filter.id;
  renderSavedFilters();
}

async function deleteSelectedFilter() {
  const project = activeProject();
  const filterId = els.savedFilterSelect.value;
  if (!project || !filterId) return;
  await api(`/api/pm/projects/${project.id}/filters/${encodeURIComponent(filterId)}`, { method: "DELETE" });
  state.savedFilters = state.savedFilters.filter((filter) => filter.id !== filterId);
  els.savedFilterSelect.value = "";
  renderSavedFilters();
}

async function applySelectedFilter() {
  const filter = state.savedFilters.find((item) => item.id === els.savedFilterSelect.value);
  if (!filter) {
    els.deleteFilterBtn.disabled = true;
    return;
  }
  applyFilterState(filter.filter || {});
  els.deleteFilterBtn.disabled = false;
  await loadProjectData();
}

function currentFilterState() {
  return {
    status: els.statusFilter.value,
    priority: els.priorityFilter.value,
    labelId: els.labelFilter.value,
    due: els.dueFilter.value,
    search: els.taskSearch.value.trim(),
    sprintScope: state.activeSprintId,
    epicId: state.activeEpicId
  };
}

function applyFilterState(filter) {
  els.statusFilter.value = typeof filter.status === "string" ? filter.status : "";
  els.priorityFilter.value = typeof filter.priority === "string" ? filter.priority : "";
  els.labelFilter.value = typeof filter.labelId === "string" ? filter.labelId : "";
  els.dueFilter.value = typeof filter.due === "string" ? filter.due : "";
  els.taskSearch.value = typeof filter.search === "string" ? filter.search : "";
  state.activeSprintId = typeof filter.sprintScope === "string" ? filter.sprintScope : "__all";
  state.activeEpicId = typeof filter.epicId === "string" && filter.epicId ? filter.epicId : null;
}

function suggestedFilterName() {
  const parts = [];
  if (els.statusFilter.value) parts.push(els.statusFilter.value);
  if (els.priorityFilter.value) parts.push(els.priorityFilter.value);
  if (els.labelFilter.value) parts.push(state.labels.find((label) => label.id === els.labelFilter.value)?.name || "label");
  if (els.dueFilter.value) parts.push(els.dueFilter.value);
  if (els.taskSearch.value.trim()) parts.push(`search ${els.taskSearch.value.trim()}`);
  if (!parts.length) parts.push("All tasks");
  return parts.join(" / ");
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
      title: els.taskCreateTitle.value,
      priority: els.taskCreatePriority.value,
      assigneeId: els.taskCreateAssignee.value || undefined,
      epicId: els.taskCreateEpic.value || undefined,
      sprintId: selectedSprintIdForNewTask(),
      dueAt: els.taskCreateDueAt.value || undefined
    })
  });
  closeTaskCreateModal();
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

function openTaskCreateModal() {
  if (!activeProject()) return;
  if (state.activeEpicId) {
    openEpicTaskModal();
    return;
  }
  els.taskCreateForm.reset();
  els.taskCreatePriority.value = "medium";
  els.taskCreateAssignee.replaceChildren(option("unassigned", ""), ...state.members.map((member) => option(member.displayName || member.username, member.id)));
  els.taskCreateEpic.replaceChildren(option("No epic", ""), ...state.epics.map((epic) => option(epic.title, epic.id)));
  els.taskCreateForm.querySelector("button[type='submit']").disabled = false;
  els.taskCreateModal.hidden = false;
  window.setTimeout(() => els.taskCreateTitle.focus(), 0);
}

function closeTaskCreateModal() {
  els.taskCreateModal.hidden = true;
  els.taskCreateForm.reset();
}

async function openEpicTaskModal(task = null) {
  state.epicTaskTargetTaskId = task?.id || null;
  els.epicTaskModal.hidden = false;
  await loadEpicTaskPool();
  const selectedEpicId = state.activeEpicId || task?.epicId || "";
  els.epicTaskEpicFilter.replaceChildren(option("Select epic", ""), ...state.globalEpics.map((epic) => option(`${epic.projectKey || ""} / ${epic.title}`, epic.id)));
  els.epicTaskEpicFilter.value = selectedEpicId;
  els.epicTaskProjectFilter.replaceChildren(option("All projects", ""), ...state.projects.map((project) => option(`${project.key} / ${project.name}`, project.id)));
  els.epicTaskBoardFilter.replaceChildren(option("All boards", ""), ...state.epicTaskBoards.map((board) => option(`${board.projectKey} / ${board.name}`, board.id)));
  els.epicTaskSearch.value = "";
  renderEpicTaskList();
  window.setTimeout(() => els.epicTaskSearch.focus(), 0);
}

function closeEpicTaskModal() {
  state.epicTaskTargetTaskId = null;
  els.epicTaskModal.hidden = true;
}

async function loadEpicTaskPool() {
  await loadGlobalEpics();
  const tasks = [];
  const boards = [];
  for (const project of state.projects) {
    const [{ tasks: projectTasks }, { boards: projectBoards }] = await Promise.all([
      api(`/api/pm/projects/${project.id}/tasks`),
      api(`/api/pm/projects/${project.id}/boards`)
    ]);
    const boardByTask = new Map();
    for (const board of projectBoards || []) {
      boards.push({ ...board, projectId: project.id, projectKey: project.key });
      try {
        const snapshot = await api(`/api/pm/boards/${board.id}`);
        for (const task of snapshot.tasks || []) boardByTask.set(task.id, board.id);
      } catch (error) {
        console.debug("Failed to load board tasks for epic picker", { boardId: board.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const task of projectTasks || []) {
      tasks.push({ ...task, projectName: project.name, projectKey: project.key, boardId: boardByTask.get(task.id) || "" });
    }
  }
  state.epicTaskPool = tasks;
  state.epicTaskBoards = boards;
}

function renderEpicTaskList() {
  const epicId = els.epicTaskEpicFilter.value;
  const search = els.epicTaskSearch.value.trim().toLowerCase();
  const projectId = els.epicTaskProjectFilter.value;
  const boardId = els.epicTaskBoardFilter.value;
  const targetTaskId = state.epicTaskTargetTaskId;
  const items = state.epicTaskPool.filter((task) => {
    if (targetTaskId && task.id !== targetTaskId) return false;
    if (projectId && task.projectId !== projectId) return false;
    if (boardId && task.boardId !== boardId) return false;
    if (search && !`${task.id} ${task.title} ${task.description || ""} ${task.projectKey || ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!items.length) {
    els.epicTaskList.innerHTML = `<div class="drawer-empty">No matching tasks.</div>`;
    return;
  }
  els.epicTaskList.replaceChildren(...items.map((task) => {
    const row = document.createElement("div");
    row.className = "epic-task-row";
    row.innerHTML = `
      <div>
        <div class="card-title">${escapeHtml(task.title)}</div>
        <div class="card-meta">${escapeHtml(task.projectKey || "")} / ${escapeHtml(task.status || "")} / ${escapeHtml(task.priority || "")}</div>
      </div>
      <button type="button" ${epicId ? "" : "disabled"}>${task.epicId === epicId && epicId ? "Linked" : "Add"}</button>
    `;
    row.querySelector("button").addEventListener("click", () => attachTaskToEpic(task, epicId).catch((error) => setError(error.message)));
    return row;
  }));
}

async function attachTaskToEpic(task, epicId) {
  if (!task?.id || !epicId) throw new Error("Select an epic first.");
  const { task: updated } = await api(`/api/pm/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({ epicId, expectedVersion: task.version })
  });
  closeEpicTaskModal();
  await loadProjectData();
  if (state.activeTask?.id === updated.id) openTask(updated, state.taskDrawerMode, { navigate: false });
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
      dueAt: els.editTaskDueAt.value || null,
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

async function toggleTaskArchive() {
  if (!state.activeTask) return;
  const { task } = await api(`/api/pm/tasks/${state.activeTask.id}/archive`, {
    method: "POST",
    body: JSON.stringify({ archived: !state.activeTask.archivedAt })
  });
  await loadProjectData();
  if (task.archivedAt) {
    closeTask();
  } else {
    openTask(task);
  }
}

async function deleteActiveTask() {
  if (!state.activeTask) return;
  const confirmed = await confirmAction({
    title: "Delete task permanently",
    message: `This will permanently delete the task and its attachments from storage.\n\n${state.activeTask.title}`
  });
  if (!confirmed) return;
  await api(`/api/pm/tasks/${state.activeTask.id}/permanent`, { method: "DELETE" });
  closeTask();
  await loadProjectData();
}

async function deleteActiveBoard() {
  const boardId = els.boardDeleteSelect?.value || state.activeBoardId;
  const board = state.boards.find((item) => item.id === boardId) || state.board;
  if (!boardId || !board) return;
  const confirmed = await confirmAction({
    title: "Delete board permanently",
    message: `This will permanently delete board "${board.name}", every task positioned on it, and attachments used by those tasks. This cannot be undone.`
  });
  if (!confirmed) return;
  await api(`/api/pm/boards/${boardId}/permanent`, { method: "DELETE" });
  if (state.activeTask) closeTask({ navigate: false });
  if (state.activeBoardId === boardId) state.activeBoardId = null;
  state.board = null;
  state.columns = [];
  state.boardTasks = [];
  closeBoardModal();
  navigatePm(pmProjectPath(activeProject()?.id));
  await loadProjectData();
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
  updateLocalTaskLabels(state.activeTask.id, state.taskLabels.map((item) => item.id));
  await reloadActivityForActiveTask();
  renderDrawerData();
  renderTasks();
  renderBoard();
}

async function removeTaskLabel(label) {
  if (!state.activeTask) return;
  await api(`/api/pm/tasks/${state.activeTask.id}/labels/${encodeURIComponent(label.id)}`, { method: "DELETE" });
  state.taskLabels = state.taskLabels.filter((item) => item.id !== label.id);
  updateLocalTaskLabels(state.activeTask.id, state.taskLabels.map((item) => item.id));
  await reloadActivityForActiveTask();
  renderDrawerData();
  renderTasks();
  renderBoard();
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
  renderTaskView();
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
          ${canEdit ? `<button class="mini-button comment-edit-button" data-action="edit" type="button">Edit</button>` : `<span></span>`}
          <span>${formatDate(comment.createdAt)}</span>
          ${canEdit ? `<button class="mini-button comment-delete-button" data-action="delete" type="button" title="Delete comment" aria-label="Delete comment">&#128465;</button>` : `<span></span>`}
        </div>
        <div class="comment-body formatted-comment">${formatCommentBody(comment.body)}</div>
        ${canEdit ? `<div class="attachment-actions comment-edit-actions" hidden></div>` : ""}
      `;
      if (canEdit) {
        card.querySelector('[data-action="edit"]').addEventListener("click", () => editComment(comment, card).catch((error) => setError(error.message)));
        card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteComment(comment).catch((error) => setError(error.message)));
      }
      return card;
    })
  );
}

function formatCommentBody(body) {
  let html = escapeHtml(body);
  html = html.replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, "<u>$1</u>");
  return html.replace(/\n/g, "<br>");
}

async function editComment(comment, card) {
  const body = card.querySelector(".comment-body");
  const actions = card.querySelector(".comment-edit-actions");
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
  actions.hidden = false;
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
          ${isPreviewableAttachment(attachment) ? '<button class="mini-button preview-button" type="button">Preview</button>' : ""}
          <a href="/api/pm/attachments/${encodeURIComponent(attachment.id)}">Download</a>
          <button class="mini-button" type="button">Delete</button>
        </div>
      `;
      card.querySelector(".preview-button")?.addEventListener("click", () => openMediaAttachment(attachment));
      card.querySelector(".attachment-actions button:last-child").addEventListener("click", () => deleteAttachment(attachment).catch((error) => setError(error.message)));
      return card;
    })
  );
}

function isPreviewableAttachment(attachment) {
  const mime = attachment.mimeType || "";
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
}

function openMediaAttachment(attachment) {
  const src = `/api/pm/attachments/${encodeURIComponent(attachment.id)}`;
  const mime = attachment.mimeType || "";
  const title = attachment.originalFileName || attachment.storedFileName || "Media";
  if (mime.startsWith("image/")) {
    openImageMediaWindow(src, title);
  } else if (mime.startsWith("video/")) {
    openPlaybackMediaWindow(src, title, "video");
  } else if (mime.startsWith("audio/")) {
    openPlaybackMediaWindow(src, title, "audio");
  }
}

function closeMediaAttachment() {
  els.mediaContent.replaceChildren();
  els.mediaModal.hidden = true;
}

function openImageMediaWindow(src, title) {
  const viewer = createFloatingWindow("pm-media-image-window", title, "image");
  const body = document.createElement("div");
  body.className = "pm-floating-media-body";
  const image = document.createElement("img");
  image.src = src;
  image.alt = title;
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
  const stopDrag = () => {
    drag = null;
    document.body.classList.remove("no-text-select");
    body.classList.remove("dragging");
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
  body.addEventListener("pointerup", stopDrag);
  body.addEventListener("pointercancel", stopDrag);
  viewer.onClose = stopDrag;
  update();
}

function openPlaybackMediaWindow(src, title, kind) {
  const viewer = createFloatingWindow("pm-media-playback-window", title, kind);
  const body = document.createElement("div");
  body.className = "pm-floating-media-body";
  const media = document.createElement(kind === "audio" ? "audio" : "video");
  media.controls = true;
  if (kind === "video") media.playsInline = true;
  media.src = src;
  body.append(media);
  viewer.panel.append(body);
  viewer.onClose = () => {
    media.pause();
    media.removeAttribute("src");
    media.load();
  };
}

function createFloatingWindow(className, title, kind = "window") {
  const panel = document.createElement("section");
  panel.className = `${className} pm-floating-window`;
  const offset = state.floatingWindows.length * 18;
  panel.style.left = `calc(12.5vw + ${offset}px)`;
  panel.style.top = `calc(12.5vh + ${offset}px)`;

  const header = document.createElement("header");
  const label = document.createElement("span");
  label.textContent = title;
  const minimize = document.createElement("button");
  minimize.className = "pm-window-minimize";
  minimize.type = "button";
  minimize.setAttribute("aria-label", "Minimize to sidebar");
  const close = document.createElement("button");
  close.className = "pm-window-close";
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  const controls = document.createElement("div");
  controls.className = "pm-window-controls";
  controls.append(minimize, close);
  header.append(label, controls);
  panel.append(header);
  document.body.append(panel);

  const floating = { panel, onClose: null };
  const windowState = registerFloatingWindow(panel, title, kind, () => closeFloatingWindow());
  function closeFloatingWindow() {
    floating.onClose?.();
    unregisterFloatingWindow(windowState.id);
    panel.remove();
  }

  minimize.addEventListener("click", () => setFloatingWindowMinimized(windowState, true));
  close.addEventListener("click", closeFloatingWindow);
  wireDraggableFloatingWindow(panel, header);
  return floating;
}

function wireDraggableFloatingWindow(panel, handle) {
  let drag = null;
  handle.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.("button")) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    document.body.classList.add("no-text-select");
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
  const stopDrag = () => {
    drag = null;
    document.body.classList.remove("no-text-select");
  };
  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
}

function registerFloatingWindow(panel, title, kind, closeWindow) {
  const id = `pm-floating-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const windowState = { id, panel, title, kind, minimized: false, closeWindow };
  state.floatingWindows.push(windowState);
  renderWindowDock();
  return windowState;
}

function unregisterFloatingWindow(id) {
  state.floatingWindows = state.floatingWindows.filter((item) => item.id !== id);
  renderWindowDock();
}

function setFloatingWindowMinimized(windowState, minimized) {
  windowState.minimized = minimized;
  if (minimized) {
    windowState.panel.classList.add("minimized");
    window.setTimeout(() => {
      if (windowState.minimized) windowState.panel.hidden = true;
    }, 170);
  } else {
    windowState.panel.hidden = false;
    requestAnimationFrame(() => windowState.panel.classList.remove("minimized"));
  }
  renderWindowDock();
}

function toggleFloatingWindow(windowState) {
  setFloatingWindowMinimized(windowState, !windowState.minimized);
}

function renderWindowDock() {
  els.pmWindowDockList.replaceChildren();
  for (const windowState of state.floatingWindows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pm-dock-icon ${windowState.minimized ? "" : "active"}`;
    button.textContent = windowIcon(windowState.kind);
    button.title = windowState.title;
    button.addEventListener("click", () => toggleFloatingWindow(windowState));
    els.pmWindowDockList.append(button);
  }
}

function windowIcon(kind) {
  if (kind === "video") return "V";
  if (kind === "audio") return "A";
  if (kind === "image") return "I";
  return "W";
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

async function retryWebhookDelivery(delivery) {
  const body = await api(`/api/pm/webhook-deliveries/${encodeURIComponent(delivery.id)}/retry`, { method: "POST" });
  state.webhookDeliveries = state.webhookDeliveries.map((item) => (item.id === body.delivery.id ? body.delivery : item));
  await loadWebhookDeliveries();
}

async function bootstrapPm(event) {
  event.preventDefault();
  const token = els.bootstrapToken.value.trim();
  if (!token) throw new Error("PM_BOOTSTRAP_TOKEN is required.");
  await api("/api/pm/bootstrap", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      projectKey: els.bootstrapProjectKey.value.trim() || undefined,
      projectName: els.bootstrapProjectName.value.trim() || undefined
    })
  });
  els.bootstrapToken.value = "";
  await loadOpsStatus();
  await loadProjects();
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

function setCommentMode(mode) {
  state.commentMode = mode === "advanced" ? "advanced" : "fast";
  els.commentToolbar.hidden = state.commentMode !== "advanced";
  els.commentFastModeBtn.classList.toggle("active", state.commentMode === "fast");
  els.commentAdvancedModeBtn.classList.toggle("active", state.commentMode === "advanced");
  try {
    localStorage.setItem(PM_COMMENT_MODE_KEY, state.commentMode);
  } catch {
    // Comment mode is a local preference.
  }
}

function loadCommentMode() {
  try {
    setCommentMode(localStorage.getItem(PM_COMMENT_MODE_KEY) === "advanced" ? "advanced" : "fast");
  } catch {
    setCommentMode("fast");
  }
}

function wrapCommentSelection(before, after) {
  const input = els.commentBody;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const selected = input.value.slice(start, end);
  input.value = `${input.value.slice(0, start)}${before}${selected}${after}${input.value.slice(end)}`;
  const caret = start + before.length + selected.length;
  input.focus();
  input.setSelectionRange(caret, caret);
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

function confirmAction({ title, message }) {
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmModal.hidden = false;
  return new Promise((resolve) => {
    const cleanup = (value) => {
      els.confirmModal.hidden = true;
      els.confirmCancelBtn.removeEventListener("click", onCancel);
      els.confirmOkBtn.removeEventListener("click", onOk);
      els.confirmModal.removeEventListener("click", onBackdrop);
      resolve(value);
    };
    const onCancel = () => cleanup(false);
    const onOk = () => cleanup(true);
    const onBackdrop = (event) => {
      if (event.target === els.confirmModal) cleanup(false);
    };
    els.confirmCancelBtn.addEventListener("click", onCancel);
    els.confirmOkBtn.addEventListener("click", onOk);
    els.confirmModal.addEventListener("click", onBackdrop);
  });
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
    els.wsDot.className = "sq green";
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
    els.wsDot.className = "sq red";
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

function truncateText(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}...` : text;
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

function taskMatchesDueFilter(task, filter) {
  if (filter === "none") return !task.dueAt;
  if (filter === "overdue") return isOverdue(task);
  if (filter === "today") return isDueToday(task);
  return true;
}

function taskMatchesSearch(task, search) {
  const haystack = [task.id, task.title, task.description, task.status, task.priority].join(" ").toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function isOverdue(task) {
  if (!task.dueAt || task.status === "done") return false;
  return endOfLocalDay(task.dueAt).getTime() < startOfToday().getTime();
}

function isDueToday(task) {
  if (!task.dueAt) return false;
  const due = endOfLocalDay(task.dueAt);
  const today = startOfToday();
  return due >= today && due < new Date(today.getTime() + 24 * 60 * 60 * 1000);
}

function dueLabel(task) {
  if (!task.dueAt) return "no due";
  const value = dateInputValue(task.dueAt);
  return isOverdue(task) ? `overdue ${value}` : `due ${value}`;
}

function dateInputValue(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function localDateTimeInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function endOfLocalDay(value) {
  const text = dateInputValue(value);
  if (!text) return new Date(0);
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function taskHasLabel(task, labelId) {
  return Array.isArray(task.labelIds) && task.labelIds.includes(labelId);
}

function taskLabelChips(task) {
  const labels = state.labels.filter((label) => taskHasLabel(task, label.id));
  if (labels.length === 0) return "";
  return `<div class="label-chip-row card-labels">${labels.map((label) => `
    <span class="label-chip">
      <span class="label-swatch" style="background:${escapeHtml(label.color)}"></span>
      <span>${escapeHtml(label.name)}</span>
    </span>
  `).join("")}</div>`;
}

function updateLocalTaskLabels(taskId, labelIds) {
  state.tasks = state.tasks.map((task) => (task.id === taskId ? { ...task, labelIds } : task));
  state.boardTasks = state.boardTasks.map((task) => (task.id === taskId ? { ...task, labelIds } : task));
  if (state.activeTask?.id === taskId) state.activeTask = { ...state.activeTask, labelIds };
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
    await loadAfterAuth();
    connectWs();
    setInterval(refreshHealth, 15000);
    setInterval(checkHomeTimers, 1000);
  } catch (error) {
    if (/Authentication required|HTTP 401/i.test(error.message)) showPmLogin();
    else setError(error.message);
  }
}

loadThemeSettings();
loadHomeGridStep();
loadCommentMode();

for (const button of els.themeButtons) button.addEventListener("click", () => setTheme(button.dataset.theme));
for (const input of [els.customBgColor, els.customFieldColor, els.customTextColor, els.customLineColor]) {
  input.addEventListener("input", () => {
    applyCustomTheme();
    setTheme("theme-custom");
  });
}
for (const input of [els.fontFamilySelect, els.fontSizeInput]) {
  input.addEventListener("input", () => {
    applyFontSettings();
    saveThemeSettings();
  });
  input.addEventListener("change", () => {
    applyFontSettings();
    saveThemeSettings();
  });
}

els.bootstrapForm.addEventListener("submit", (event) => bootstrapPm(event).catch((error) => setError(error.message)));
els.pmLoginForm.addEventListener("submit", (event) => loginPm(event).catch((error) => showPmLogin(error.message)));
els.pmLogoutBtn.addEventListener("click", () => logoutPm().catch((error) => setError(error.message)));
els.pmHomeBtn.addEventListener("click", () => {
  navigatePm(pmHomePath());
  setPmView("home");
});
els.pmKanbanBtn.addEventListener("click", () => {
  navigatePm(state.activeBoardId ? pmBoardPath(state.activeProjectId, state.activeBoardId) : pmProjectPath(state.activeProjectId));
  setPmView("kanban");
});
els.homeEditToggle.addEventListener("click", () => {
  state.homeEditing = !state.homeEditing;
  renderHome();
});
els.homeGridStep.addEventListener("input", () => {
  const step = homeGridStep();
  els.homeGridStep.value = String(step);
  try {
    localStorage.setItem(PM_HOME_GRID_STEP_KEY, String(step));
  } catch {
    // Grid step persistence is best-effort.
  }
  renderHome();
});
els.addHomeWidgetBtn.addEventListener("click", () => addHomeWidget().catch((error) => setError(error.message)));
els.saveWidgetTemplateBtn.addEventListener("click", () => saveSelectedWidgetTemplate().catch((error) => setError(error.message)));
els.useWidgetTemplateBtn.addEventListener("click", () => useSelectedWidgetTemplate().catch((error) => setError(error.message)));
els.projectSheetEditToggle.addEventListener("click", () => {
  state.projectSheetEditing = !state.projectSheetEditing;
  renderProjectTitleSheet();
});
els.projectSheetCreateBoardBtn.addEventListener("click", openBoardModal);
els.projectSheetGridStep.addEventListener("input", () => renderProjectTitleSheet());
els.projectSheetBgColor.addEventListener("input", () => {
  state.projectSheetBackground = els.projectSheetBgColor.value;
  saveProjectSheetWidgets();
  renderProjectTitleSheet();
});
els.projectSheetBgImage.addEventListener("change", () => uploadProjectSheetBackgroundImage().catch((error) => setError(error.message)));
els.projectSheetBgMode.addEventListener("change", () => {
  state.projectSheetBackgroundMode = els.projectSheetBgMode.value;
  saveProjectSheetWidgets();
  renderProjectTitleSheet();
});
els.projectSheetClearBgImageBtn.addEventListener("click", () => clearProjectSheetBackgroundImage().catch((error) => setError(error.message)));
els.addProjectSheetWidgetBtn.addEventListener("click", addProjectSheetWidget);
els.projectSidebarToggle.addEventListener("click", openProjectSidebar);
els.epicSidebarToggle.addEventListener("click", () => openEpicSidebar().catch((error) => setError(error.message)));
els.toggleProjectBoardsBtn.addEventListener("click", () => toggleProjectBoardsExpanded().catch((error) => setError(error.message)));
els.closeProjectSidebarBtn.addEventListener("click", closeProjectSidebar);
els.closeEpicSidebarBtn.addEventListener("click", closeEpicSidebar);
els.projectSidebarBackdrop.addEventListener("click", (event) => {
  if (event.target === els.projectSidebarBackdrop) closeProjectSidebar();
});
els.projectInfoModal.addEventListener("click", (event) => {
  if (event.target === els.projectInfoModal) closeProjectInfoModal();
});
els.epicSidebarBackdrop.addEventListener("click", (event) => {
  if (event.target === els.epicSidebarBackdrop) closeEpicSidebar();
});
els.openCreateProjectBtn.addEventListener("click", () => openProjectModal());
els.openCreateEpicBtn.addEventListener("click", openEpicModal);
els.cancelProjectModalBtn.addEventListener("click", closeProjectModal);
els.openTeamModalBtn.addEventListener("click", openTeamModal);
els.openLabelsModalBtn.addEventListener("click", openLabelsModal);
els.deleteProjectBtn.addEventListener("click", () => deleteCurrentProjectPermanently().catch((error) => setError(error.message)));
els.closeTeamModalBtn.addEventListener("click", closeTeamModal);
els.closeLabelsModalBtn.addEventListener("click", closeLabelsModal);
els.projectForm.addEventListener("submit", (event) => createProject(event).catch((error) => setError(error.message)));
els.boardForm.addEventListener("submit", (event) => createBoard(event).catch((error) => setError(error.message)));
els.cancelBoardModalBtn.addEventListener("click", closeBoardModal);
els.cancelEpicModalBtn.addEventListener("click", closeEpicModal);
els.epicTitle.addEventListener("input", () => {
  els.epicForm.querySelector('button[type="submit"]').disabled = !els.epicTitle.value.trim() || !activeProject();
});
els.boardViewMode.addEventListener("change", () => {
  renderActiveProject();
  renderBoard();
});
els.boardListSort.addEventListener("change", renderBoard);
els.projectInfoBtn.addEventListener("click", openProjectInfoModal);
els.closeProjectInfoBtn.addEventListener("click", closeProjectInfoModal);
els.memberForm.querySelector("button").addEventListener("click", (event) => addMember(event).catch((error) => setError(error.message)));
els.labelForm.querySelector("button").addEventListener("click", (event) => createLabel(event).catch((error) => setError(error.message)));
els.epicForm.addEventListener("submit", (event) => createEpic(event).catch((error) => setError(error.message)));
els.epicKey.addEventListener("input", () => {
  els.epicForm.querySelector('button[type="submit"]').disabled = !els.epicTitle.value.trim();
});
els.sprintForm.addEventListener("submit", (event) => createSprint(event).catch((error) => setError(error.message)));
els.openTaskCreateModalBtn.addEventListener("click", openTaskCreateModal);
els.taskCreateForm.addEventListener("submit", (event) => createTask(event).catch((error) => setError(error.message)));
els.cancelTaskCreateModalBtn.addEventListener("click", closeTaskCreateModal);
els.addTaskToEpicBtn.addEventListener("click", () => openEpicTaskModal(state.activeTask).catch((error) => setError(error.message)));
els.cancelEpicTaskModalBtn.addEventListener("click", closeEpicTaskModal);
for (const control of [els.epicTaskEpicFilter, els.epicTaskSearch, els.epicTaskProjectFilter, els.epicTaskBoardFilter]) {
  control.addEventListener("input", renderEpicTaskList);
  control.addEventListener("change", renderEpicTaskList);
}
els.taskEditForm.addEventListener("submit", (event) => saveTask(event).catch((error) => setError(error.message)));
els.taskLabelForm.addEventListener("submit", (event) => addTaskLabel(event).catch((error) => setError(error.message)));
els.dependencyForm.addEventListener("submit", (event) => addDependency(event).catch((error) => setError(error.message)));
els.commentForm.addEventListener("submit", (event) => createComment(event).catch((error) => setError(error.message)));
els.commentFastModeBtn.addEventListener("click", () => setCommentMode("fast"));
els.commentAdvancedModeBtn.addEventListener("click", () => setCommentMode("advanced"));
for (const button of els.commentToolbar.querySelectorAll("button")) {
  button.addEventListener("click", () => wrapCommentSelection(button.dataset.mdBefore || "", button.dataset.mdAfter || ""));
}
els.attachmentForm.addEventListener("submit", (event) => uploadAttachment(event).catch((error) => setError(error.message)));
els.notificationToggle.addEventListener("click", () => {
  els.notificationPanel.hidden = !els.notificationPanel.hidden;
});
els.webhookToggle.addEventListener("click", () => {
  els.webhookPanel.hidden = !els.webhookPanel.hidden;
  if (!els.webhookPanel.hidden) loadWebhookDeliveries().catch((error) => setError(error.message));
});
els.opsToggle.addEventListener("click", () => {
  els.opsPanel.hidden = !els.opsPanel.hidden;
  if (!els.opsPanel.hidden) loadOpsStatus().catch((error) => setError(error.message));
});
els.markAllNotificationsReadBtn.addEventListener("click", () => markAllNotificationsRead().catch((error) => setError(error.message)));
els.refreshWebhooksBtn.addEventListener("click", () => loadWebhookDeliveries().catch((error) => setError(error.message)));
els.webhookStatusFilter.addEventListener("change", () => loadWebhookDeliveries().catch((error) => setError(error.message)));
els.refreshOpsBtn.addEventListener("click", () => loadOpsStatus().catch((error) => setError(error.message)));
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
els.deleteBoardBtn.addEventListener("click", () => deleteActiveBoard().catch((error) => setError(error.message)));
els.boardDeleteSelect.addEventListener("change", () => {
  els.deleteBoardBtn.disabled = !els.boardDeleteSelect.value;
});
els.deleteEpicBtn.addEventListener("click", () => deleteCurrentEpic().catch((error) => setError(error.message)));
els.taskSidebarToggle.addEventListener("click", () => {
  if (!state.activeTask) return;
  if (els.taskDrawer.hidden) {
    els.taskDrawer.hidden = false;
    window.requestAnimationFrame(() => els.taskDrawer.classList.add("open"));
  } else {
    els.taskDrawer.classList.toggle("open");
    if (!els.taskDrawer.classList.contains("open")) window.setTimeout(() => {
      if (!els.taskDrawer.classList.contains("open")) els.taskDrawer.hidden = true;
    }, 180);
  }
});
els.closeDrawerBtn.addEventListener("click", () => closeTask());
els.editTaskModeBtn.addEventListener("click", toggleTaskDrawerMode);
els.activityDrawerBtn.addEventListener("click", openActivityDrawer);
els.closeActivityDrawerBtn.addEventListener("click", closeActivityDrawer);
document.addEventListener("pointerdown", (event) => {
  if (els.taskDrawer.hidden || !els.taskDrawer.classList.contains("open")) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (els.taskDrawer.contains(target)) return;
  if (els.activityDrawer?.contains(target)) return;
  if (target instanceof Element && target.closest(".pm-right-rail, .pm-modal-backdrop, .pm-media-modal, .pm-floating-window, .notification-panel, .kanban-card")) return;
  collapseTaskDrawer();
});
els.archiveTaskBtn.addEventListener("click", () => toggleTaskArchive().catch((error) => setError(error.message)));
els.deleteTaskBtn.addEventListener("click", () => deleteActiveTask().catch((error) => setError(error.message)));
els.statusFilter.addEventListener("change", () => {
  renderTasks();
  renderBoard();
});
els.priorityFilter.addEventListener("change", () => {
  renderTasks();
  renderBoard();
});
els.labelFilter.addEventListener("change", () => {
  renderTasks();
  renderBoard();
});
els.dueFilter.addEventListener("change", () => {
  renderTasks();
  renderBoard();
});
els.taskSearch.addEventListener("input", () => {
  renderTasks();
  renderBoard();
  clearTimeout(taskSearchReloadTimer);
  taskSearchReloadTimer = setTimeout(() => loadProjectData().catch((error) => setError(error.message)), 350);
});
els.savedFilterSelect.addEventListener("change", () => applySelectedFilter().catch((error) => setError(error.message)));
els.saveFilterBtn.addEventListener("click", () => saveCurrentFilter().catch((error) => setError(error.message)));
els.updateFilterBtn.addEventListener("click", () => updateSelectedFilter().catch((error) => setError(error.message)));
els.deleteFilterBtn.addEventListener("click", () => deleteSelectedFilter().catch((error) => setError(error.message)));
els.closeMediaModalBtn.addEventListener("click", closeMediaAttachment);
window.addEventListener("popstate", () => applyPmRoute().catch((error) => setError(error.message)));
window.addEventListener("hashchange", () => applyPmRoute().catch((error) => setError(error.message)));

boot();
