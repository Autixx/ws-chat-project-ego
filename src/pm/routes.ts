import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import multer from "multer";
import type { AuthenticatedUser } from "../auth/authelia.js";
import { removePmAttachmentFile, storePmTaskAttachment, streamPmAttachment } from "./attachmentService.js";
import type { PmConfig } from "./config.js";
import { normalizeRole, PmPermissionError, requireProjectRole } from "./permissions.js";
import type { PmEvent, PmEventHub } from "./events.js";
import { buildPmInviteEmail, sendPmMail } from "./mailer.js";
import type { PmStore, PmConflictError } from "./postgresStore.js";
import type { CreateBoardColumnInput, CreateEpicInput, CreateProjectInput, CreateSprintInput, CreateTaskInput, MoveTaskInput, PmSprintStatus, PmUser, UpdateProjectInput, UpdateSprintInput, UpdateTaskInput } from "./types.js";
import type { PmWebhookDispatcher } from "./webhookDispatcher.js";

export type PmAuthedRequest = express.Request & { pmIdentity?: AuthenticatedUser; pmUser?: PmUser };
export type PmRouterOptions = { attachmentsDir: string; maxAttachmentBytes: number; pmConfig: PmConfig; webhooks?: PmWebhookDispatcher };

export function createPmRouter(store: PmStore, events: PmEventHub, options: PmRouterOptions): express.Router {
  const router = express.Router();
  const upload = multer({
    dest: path.join(options.attachmentsDir, "tmp"),
    limits: { fileSize: options.maxAttachmentBytes }
  });
  const emit = (event: PmEvent) => {
    events.broadcast(event);
    if (options.webhooks?.enabled) {
      void options.webhooks.dispatch(event).then((deliveries) => {
        for (const delivery of deliveries) {
          if (!delivery.ok) console.warn("PM webhook delivery failed", delivery);
        }
      });
    }
  };

  router.use(async (req: PmAuthedRequest, res, next) => {
    try {
      if (!req.pmIdentity) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      req.pmUser = await store.ensureUser(req.pmIdentity);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", (req: PmAuthedRequest, res) => {
    res.json({ user: req.pmUser });
  });

  router.get("/mail/status", (_req: PmAuthedRequest, res) => {
    res.json({
      smtpConfigured: Boolean(options.pmConfig.smtp?.host && options.pmConfig.smtp.from),
      fromConfigured: Boolean(options.pmConfig.smtp?.from),
      hostConfigured: Boolean(options.pmConfig.smtp?.host)
    });
  });

  router.get("/notifications", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      res.json({ notifications: await store.listNotifications(user.id, req.query.includeRead === "true") });
    } catch (error) {
      next(error);
    }
  });

  router.post("/notifications/read-all", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const result = await store.markAllNotificationsRead(user.id);
      emit({ type: "notification.read", createdAt: new Date().toISOString(), payload: { userId: user.id, ...result } });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/notifications/:notificationId/read", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const notification = await store.markNotificationRead(user.id, req.params.notificationId);
      emit({ type: "notification.read", createdAt: new Date().toISOString(), payload: { userId: user.id, notificationId: notification.id } });
      res.json({ notification });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects", async (req: PmAuthedRequest, res, next) => {
    try {
      res.json({ projects: await store.listProjects(requirePmUser(req).id, req.query.includeArchived === "true") });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects", async (req: PmAuthedRequest, res, next) => {
    try {
      const input = parseCreateProject(req.body);
      const project = await store.createProject(requirePmUser(req), input);
      emit({ type: "project.created", projectId: project.id, version: project.version, createdAt: new Date().toISOString(), payload: { project } });
      res.status(201).json({ project });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/projects/:projectId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "project_owner");
      const project = await store.updateProject(user, req.params.projectId, parseUpdateProject(req.body));
      emit({ type: "project.updated", projectId: project.id, version: project.version, createdAt: new Date().toISOString(), payload: { project } });
      res.json({ project });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/archive", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "project_owner");
      const project = await store.archiveProject(user, req.params.projectId, Boolean(req.body?.archived ?? true));
      emit({ type: "project.archived", projectId: project.id, version: project.version, createdAt: new Date().toISOString(), payload: { project } });
      res.json({ project });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/projects/:projectId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "project_owner");
      const project = await store.softDeleteProject(user, req.params.projectId);
      emit({ type: "project.updated", projectId: project.id, version: project.version, createdAt: new Date().toISOString(), payload: { deleted: true } });
      res.json({ project });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId/members", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      res.json({ members: await store.listMembers(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/projects/:projectId/members/:userId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "project_owner");
      const role = normalizeRole(req.body?.role);
      const member = await store.setMemberRole(user, req.params.projectId, req.params.userId, role);
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { memberId: req.params.userId, role } });
      res.json({ member });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/members", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "project_owner");
      const identifier = requiredString(req.body?.identifier, "identifier");
      const target = await store.findUserByIdentifier(identifier);
      const role = normalizeRole(req.body?.role ?? "member");
      const member = await store.setMemberRole(user, req.params.projectId, target.id, role);
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { memberId: target.id, role } });
      res.status(201).json({ member });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/invites", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "project_owner");
      const email = requiredEmail(req.body?.email);
      const project = await store.loadProject(req.params.projectId);
      const mail = buildPmInviteEmail({
        to: email,
        inviterName: user.displayName ?? user.username,
        projectName: project.name,
        publicBaseUrl: options.pmConfig.publicBaseUrl
      });
      const result = await sendPmMail(options.pmConfig, mail);
      emit({ type: "project.updated", projectId: project.id, version: project.version, createdAt: new Date().toISOString(), payload: { inviteEmail: email, mailSent: result.sent } });
      res.status(result.sent ? 202 : 503).json({ invite: { email, sent: result.sent, disabled: result.disabled, message: result.message } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/projects/:projectId/members/:userId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "project_owner");
      await store.removeMember(user, req.params.projectId, req.params.userId);
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { memberId: req.params.userId, removed: true } });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId/labels", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      res.json({ labels: await store.listLabels(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/labels", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "member");
      const label = await store.createLabel(user, { ...parseCreateLabel(req.body), projectId: req.params.projectId });
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { label } });
      res.status(201).json({ label });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/projects/:projectId/labels/:labelId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "member");
      const label = await store.updateLabel(user, req.params.projectId, req.params.labelId, parseUpdateLabel(req.body));
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { label } });
      res.json({ label });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/projects/:projectId/labels/:labelId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "member");
      await store.deleteLabel(user, req.params.projectId, req.params.labelId);
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { labelId: req.params.labelId, deleted: true } });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId/filters", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      res.json({ filters: await store.listSavedFilters(req.params.projectId, user.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/filters", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      const filter = await store.createSavedFilter(user, { ...parseCreateSavedFilter(req.body), projectId: req.params.projectId, userId: user.id });
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { filterId: filter.id } });
      res.status(201).json({ filter });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/projects/:projectId/filters/:filterId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      await store.deleteSavedFilter(user, req.params.projectId, req.params.filterId);
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { filterId: req.params.filterId, deleted: true } });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/projects/:projectId/filters/:filterId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      const filter = await store.updateSavedFilter(user, req.params.projectId, req.params.filterId, parseUpdateSavedFilter(req.body));
      emit({ type: "project.updated", projectId: req.params.projectId, createdAt: new Date().toISOString(), payload: { filterId: filter.id } });
      res.json({ filter });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId/epics", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      res.json({ epics: await store.listEpics(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/epics", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const role = await store.getProjectRole(user.id, req.params.projectId);
      requireProjectRole(role, "member");
      const epic = await store.createEpic(user, { ...parseCreateEpic(req.body), projectId: req.params.projectId });
      emit({ type: "epic.created", projectId: req.params.projectId, version: epic.version, createdAt: new Date().toISOString(), payload: { epic } });
      res.status(201).json({ epic });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId/sprints", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      res.json({
        sprints: await store.listSprints(req.params.projectId, {
          epicId: stringQuery(req.query.epicId),
          includeCompleted: req.query.includeCompleted === "true"
        })
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/sprints", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "member");
      const sprint = await store.createSprint(user, { ...parseCreateSprint(req.body), projectId: req.params.projectId });
      emit({ type: "sprint.created", projectId: req.params.projectId, version: sprint.version, createdAt: new Date().toISOString(), payload: { sprint } });
      res.status(201).json({ sprint });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/sprints/:sprintId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const existing = await store.loadSprint(req.params.sprintId);
      requireProjectRole(await store.getProjectRole(user.id, existing.projectId), "member");
      const sprint = await store.updateSprint(user, req.params.sprintId, parseUpdateSprint(req.body));
      emit({ type: "sprint.updated", projectId: sprint.projectId, version: sprint.version, createdAt: new Date().toISOString(), payload: { sprint } });
      res.json({ sprint });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId/boards", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      res.json({ boards: await store.listBoards(req.params.projectId, stringQuery(req.query.epicId)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/boards/kanban/default", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "member");
      const result = await store.ensureDefaultKanbanBoard(user, req.params.projectId, optionalString(req.body?.epicId));
      emit({ type: "board.created", projectId: req.params.projectId, version: result.board.version, createdAt: new Date().toISOString(), payload: result });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/boards/:boardId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const board = await store.loadBoard(req.params.boardId);
      requireProjectRole(await store.getProjectRole(user.id, board.projectId), "viewer");
      res.json(await store.loadBoardSnapshot(req.params.boardId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/boards/:boardId/columns", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const board = await store.loadBoard(req.params.boardId);
      requireProjectRole(await store.getProjectRole(user.id, board.projectId), "project_owner");
      const column = await store.createBoardColumn(user, { ...parseCreateBoardColumn(req.body), boardId: req.params.boardId });
      emit({ type: "board.column_created", projectId: board.projectId, createdAt: new Date().toISOString(), payload: { boardId: board.id, column } });
      res.status(201).json({ column });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId/tasks", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "viewer");
      res.json({
        tasks: await store.listTasks(req.params.projectId, {
          epicId: stringQuery(req.query.epicId),
          sprintId: stringQuery(req.query.sprintId),
          includeArchived: req.query.includeArchived === "true"
        })
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/tasks", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      requireProjectRole(await store.getProjectRole(user.id, req.params.projectId), "member");
      const task = await store.createTask(user, { ...parseCreateTask(req.body), projectId: req.params.projectId });
      emit({ type: "task.created", projectId: req.params.projectId, taskId: task.id, version: task.version, createdAt: new Date().toISOString(), payload: { task } });
      res.status(201).json({ task });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/tasks/:taskId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const existing = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, existing.projectId), "member");
      const task = await store.updateTask(user, req.params.taskId, parseUpdateTask(req.body));
      emit({ type: "task.updated", projectId: task.projectId, taskId: task.id, version: task.version, createdAt: new Date().toISOString(), payload: { task } });
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/archive", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const existing = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, existing.projectId), "member");
      const task = await store.archiveTask(user, req.params.taskId, Boolean(req.body?.archived ?? true));
      emit({ type: "task.updated", projectId: task.projectId, taskId: task.id, version: task.version, createdAt: new Date().toISOString(), payload: { task } });
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/tasks/:taskId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const existing = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, existing.projectId), "member");
      const task = await store.softDeleteTask(user, req.params.taskId);
      emit({ type: "task.updated", projectId: task.projectId, taskId: task.id, version: task.version, createdAt: new Date().toISOString(), payload: { deleted: true } });
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/move", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const existing = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, existing.projectId), "member");
      const move = parseMoveTask(req.params.taskId, req.body);
      const result = await store.moveTask(user, move);
      emit({
        type: "task.moved",
        projectId: result.task.projectId,
        taskId: result.task.id,
        version: result.task.version,
        createdAt: new Date().toISOString(),
        payload: { task: result.task, position: result.position }
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/tasks/:taskId/dependencies", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "viewer");
      res.json(await store.listDependencies(req.params.taskId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/dependencies", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      const blockingTaskId = requiredString(req.body?.blockingTaskId, "blockingTaskId");
      await store.addDependency(user, blockingTaskId, req.params.taskId);
      emit({ type: "task.updated", projectId: task.projectId, taskId: req.params.taskId, createdAt: new Date().toISOString(), payload: { dependencyAdded: blockingTaskId } });
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/tasks/:taskId/dependencies/:blockingTaskId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      await store.removeDependency(user, req.params.blockingTaskId, req.params.taskId);
      emit({ type: "task.updated", projectId: task.projectId, taskId: req.params.taskId, createdAt: new Date().toISOString(), payload: { dependencyRemoved: req.params.blockingTaskId } });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/sprint", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      const sprintId = optionalString(req.body?.sprintId);
      const updated = await store.assignTaskToSprint(user, req.params.taskId, sprintId);
      emit({ type: "task.updated", projectId: updated.projectId, taskId: updated.id, version: updated.version, createdAt: new Date().toISOString(), payload: { task: updated, sprintId } });
      res.json({ task: updated });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/assignee", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      const assigneeId = optionalString(req.body?.assigneeId);
      const updated = await store.assignTask(user, req.params.taskId, assigneeId);
      emit({ type: "task.updated", projectId: updated.projectId, taskId: updated.id, version: updated.version, createdAt: new Date().toISOString(), payload: { task: updated, assigneeId } });
      res.json({ task: updated });
    } catch (error) {
      next(error);
    }
  });

  router.get("/tasks/:taskId/labels", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "viewer");
      res.json({ labels: await store.listTaskLabels(req.params.taskId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/labels", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      const labelId = requiredString(req.body?.labelId, "labelId");
      const label = await store.addTaskLabel(user, req.params.taskId, labelId);
      emit({ type: "task.updated", projectId: task.projectId, taskId: task.id, version: task.version, createdAt: new Date().toISOString(), payload: { labelAdded: label.id } });
      res.status(201).json({ label });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/tasks/:taskId/labels/:labelId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      await store.removeTaskLabel(user, req.params.taskId, req.params.labelId);
      emit({ type: "task.updated", projectId: task.projectId, taskId: task.id, version: task.version, createdAt: new Date().toISOString(), payload: { labelRemoved: req.params.labelId } });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/tasks/:taskId/comments", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "viewer");
      res.json({ comments: await store.listComments(req.params.taskId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/comments", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      const body = requiredString(objectBody(req.body).body, "body");
      const comment = await store.createComment(user, { taskId: req.params.taskId, body });
      const notifications = await store.createCommentNotifications(user, task, comment);
      emit({ type: "comment.created", projectId: task.projectId, taskId: task.id, createdAt: new Date().toISOString(), payload: { comment } });
      for (const notification of notifications) {
        emit({ type: "notification.created", projectId: task.projectId, taskId: task.id, createdAt: notification.createdAt, payload: { notification, userId: notification.userId } });
      }
      res.status(201).json({ comment });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/comments/:commentId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const existing = await store.loadComment(req.params.commentId);
      const task = await store.loadTask(existing.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      const body = requiredString(objectBody(req.body).body, "body");
      const comment = await store.updateComment(user, req.params.commentId, { body });
      emit({ type: "comment.updated", projectId: task.projectId, taskId: comment.taskId, createdAt: new Date().toISOString(), payload: { comment } });
      res.json({ comment });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/comments/:commentId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const existing = await store.loadComment(req.params.commentId);
      const task = await store.loadTask(existing.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      const comment = await store.softDeleteComment(user, req.params.commentId);
      emit({ type: "comment.deleted", projectId: task.projectId, taskId: comment.taskId, createdAt: new Date().toISOString(), payload: { commentId: comment.id } });
      res.json({ comment });
    } catch (error) {
      next(error);
    }
  });

  router.get("/tasks/:taskId/attachments", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "viewer");
      res.json({ attachments: await store.listTaskAttachments(req.params.taskId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/attachments", upload.single("file"), async (req: PmAuthedRequest, res, next) => {
    const uploadedFile = req.file;
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      if (!uploadedFile) throw new Error("file is required.");
      const stored = await storePmTaskAttachment({
        attachmentsDir: options.attachmentsDir,
        taskId: task.id,
        tempPath: uploadedFile.path,
        originalName: uploadedFile.originalname,
        mimeType: uploadedFile.mimetype,
        sizeBytes: uploadedFile.size,
        maxBytes: options.maxAttachmentBytes
      });
      const attachment = await store.createAttachment(user, { taskId: task.id, ...stored });
      emit({ type: "attachment.created", projectId: task.projectId, taskId: task.id, createdAt: new Date().toISOString(), payload: { attachment } });
      res.status(201).json({ attachment });
    } catch (error) {
      if (uploadedFile?.path) await fs.rm(uploadedFile.path, { force: true }).catch(() => undefined);
      next(error);
    }
  });

  router.get("/attachments/:attachmentId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const attachment = await store.loadAttachment(req.params.attachmentId);
      const task = await store.loadTask(attachment.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "viewer");
      streamPmAttachment(options.attachmentsDir, attachment, res);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/attachments/:attachmentId", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const attachment = await store.loadAttachment(req.params.attachmentId);
      const task = await store.loadTask(attachment.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "member");
      const deleted = await store.softDeleteAttachment(user, attachment.id);
      await removePmAttachmentFile(options.attachmentsDir, attachment);
      emit({ type: "attachment.deleted", projectId: task.projectId, taskId: task.id, createdAt: new Date().toISOString(), payload: { attachmentId: attachment.id } });
      res.json({ attachment: deleted });
    } catch (error) {
      next(error);
    }
  });

  router.get("/tasks/:taskId/activity", async (req: PmAuthedRequest, res, next) => {
    try {
      const user = requirePmUser(req);
      const task = await store.loadTask(req.params.taskId);
      requireProjectRole(await store.getProjectRole(user.id, task.projectId), "viewer");
      res.json({ activity: await store.listTaskActivity(req.params.taskId) });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusCode = statusForError(error);
    res.status(statusCode).json({ error: error instanceof Error ? error.message : String(error) });
  });

  return router;
}

function requirePmUser(req: PmAuthedRequest): PmUser {
  if (!req.pmUser) throw new PmPermissionError(401, "Authentication required.");
  return req.pmUser;
}

function statusForError(error: unknown): number {
  if (error instanceof PmPermissionError) return error.statusCode;
  if (isConflict(error)) return 409;
  if (error instanceof Error && /not found/i.test(error.message)) return 404;
  if (error instanceof Error && (/required/i.test(error.message) || /must be/i.test(error.message) || /unsupported/i.test(error.message) || /exceeds/i.test(error.message) || /file too large/i.test(error.message))) return 400;
  return 500;
}

function isConflict(error: unknown): error is PmConflictError {
  return Boolean(error && typeof error === "object" && "statusCode" in error && error.statusCode === 409);
}

function parseCreateProject(body: unknown): CreateProjectInput {
  const raw = objectBody(body);
  return {
    key: requiredString(raw.key, "key"),
    name: requiredString(raw.name, "name"),
    description: optionalString(raw.description)
  };
}

function parseUpdateProject(body: unknown): UpdateProjectInput {
  const raw = objectBody(body);
  return {
    name: optionalString(raw.name),
    description: optionalString(raw.description),
    expectedVersion: optionalNumber(raw.expectedVersion)
  };
}

function parseCreateEpic(body: unknown): Omit<CreateEpicInput, "projectId"> {
  const raw = objectBody(body);
  return {
    title: requiredString(raw.title, "title"),
    description: optionalString(raw.description),
    status: optionalString(raw.status),
    priority: optionalString(raw.priority),
    position: optionalNumber(raw.position)
  };
}

function parseCreateLabel(body: unknown): { name: string; color?: string } {
  const raw = objectBody(body);
  return {
    name: requiredString(raw.name, "name"),
    color: optionalHexColor(raw.color)
  };
}

function parseUpdateLabel(body: unknown): { name?: string; color?: string } {
  const raw = objectBody(body);
  return {
    name: optionalString(raw.name),
    color: optionalHexColor(raw.color)
  };
}

function parseCreateSavedFilter(body: unknown): { name: string; filter: Record<string, unknown> } {
  const raw = objectBody(body);
  const filter = raw.filter;
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new Error("filter object is required.");
  return {
    name: requiredString(raw.name, "name").slice(0, 80),
    filter: filter as Record<string, unknown>
  };
}

function parseUpdateSavedFilter(body: unknown): { name?: string; filter?: Record<string, unknown> } {
  const raw = objectBody(body);
  const filter = raw.filter;
  if (filter !== undefined && (!filter || typeof filter !== "object" || Array.isArray(filter))) throw new Error("filter must be an object.");
  return {
    name: optionalString(raw.name)?.slice(0, 80),
    filter: filter === undefined ? undefined : (filter as Record<string, unknown>)
  };
}

function parseCreateSprint(body: unknown): Omit<CreateSprintInput, "projectId"> {
  const raw = objectBody(body);
  return {
    name: requiredString(raw.name, "name"),
    epicId: optionalString(raw.epicId),
    status: optionalSprintStatus(raw.status),
    startsAt: optionalString(raw.startsAt),
    endsAt: optionalString(raw.endsAt)
  };
}

function parseCreateTask(body: unknown): Omit<CreateTaskInput, "projectId"> {
  const raw = objectBody(body);
  return {
    title: requiredString(raw.title, "title"),
    description: optionalString(raw.description),
    status: optionalString(raw.status),
    priority: optionalPriority(raw.priority),
    epicId: optionalString(raw.epicId),
    sprintId: optionalString(raw.sprintId),
    parentTaskId: optionalString(raw.parentTaskId),
    assigneeId: optionalString(raw.assigneeId),
    dueAt: optionalString(raw.dueAt)
  };
}

function parseCreateBoardColumn(body: unknown): Omit<CreateBoardColumnInput, "boardId"> {
  const raw = objectBody(body);
  return {
    name: requiredString(raw.name, "name"),
    statusKey: requiredString(raw.statusKey, "statusKey"),
    position: optionalNumber(raw.position),
    wipLimit: optionalNumber(raw.wipLimit)
  };
}

function parseUpdateSprint(body: unknown): UpdateSprintInput {
  const raw = objectBody(body);
  return {
    name: optionalString(raw.name),
    epicId: optionalString(raw.epicId),
    status: optionalSprintStatus(raw.status),
    startsAt: optionalString(raw.startsAt),
    endsAt: optionalString(raw.endsAt),
    expectedVersion: optionalNumber(raw.expectedVersion)
  };
}

function parseUpdateTask(body: unknown): UpdateTaskInput {
  const raw = objectBody(body);
  return {
    title: optionalString(raw.title),
    description: optionalString(raw.description),
    status: optionalString(raw.status),
    priority: optionalPriority(raw.priority),
    epicId: optionalString(raw.epicId),
    sprintId: optionalString(raw.sprintId),
    assigneeId: optionalString(raw.assigneeId),
    dueAt: nullableString(raw.dueAt),
    expectedVersion: optionalNumber(raw.expectedVersion)
  };
}

function parseMoveTask(taskId: string, body: unknown): MoveTaskInput {
  const raw = objectBody(body);
  return {
    taskId,
    boardId: optionalString(raw.boardId),
    columnId: optionalString(raw.columnId),
    sprintId: optionalString(raw.sprintId),
    backlogScope: optionalString(raw.backlogScope),
    position: requiredNumber(raw.position, "position"),
    status: optionalString(raw.status),
    expectedVersion: optionalNumber(raw.expectedVersion)
  };
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object body is required.");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required.`);
  return value.trim();
}

function requiredEmail(value: unknown): string {
  const email = requiredString(value, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("email must be a valid email address.");
  return email;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  return optionalString(value);
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number.`);
  return parsed;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Numeric field must be a number.");
  return parsed;
}

function optionalPriority(value: unknown): string | undefined {
  const priority = optionalString(value);
  if (!priority) return undefined;
  if (!["urgent", "high", "medium", "low", "none"].includes(priority)) throw new Error("priority must be urgent, high, medium, low, or none.");
  return priority;
}

function optionalHexColor(value: unknown): string | undefined {
  const color = optionalString(value);
  if (!color) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("color must be a #rrggbb hex value.");
  return color.toLowerCase();
}

function optionalSprintStatus(value: unknown): PmSprintStatus | undefined {
  const status = optionalString(value);
  if (!status) return undefined;
  if (!["planned", "active", "completed", "cancelled"].includes(status)) throw new Error("status must be planned, active, completed, or cancelled.");
  return status as PmSprintStatus;
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
