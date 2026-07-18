import express from "express";
import { timingSafeEqual } from "node:crypto";
import type { PmConfig } from "./config.js";
import type { PmEvent, PmEventHub } from "./events.js";
import type { PmStore } from "./postgresStore.js";
import { PmPermissionError } from "./permissions.js";
import { parseCreateTaskBody, parseMoveTaskBody, parseUpdateTaskBody, requiredBodyString } from "./routes.js";
import type { PmWebhookDispatcher } from "./webhookDispatcher.js";

export type PmAutomationRouterOptions = {
  pmConfig: PmConfig;
  webhooks?: PmWebhookDispatcher;
};

export function createPmAutomationRouter(store: PmStore, events: PmEventHub, options: PmAutomationRouterOptions): express.Router {
  const router = express.Router();
  const emit = (event: PmEvent) => {
    events.broadcast(event);
    if (options.webhooks?.enabled) {
      void options.webhooks.dispatch(event).then((deliveries) => {
        for (const delivery of deliveries) {
          if (!delivery.ok) console.warn("PM automation webhook delivery failed", delivery);
        }
      });
    }
  };

  router.use((req, res, next) => {
    const token = options.pmConfig.automationToken;
    if (!token) {
      res.status(503).json({ error: "PM_AUTOMATION_TOKEN is not configured." });
      return;
    }
    const header = req.header("authorization") ?? "";
    if (!isBearerToken(header, token)) {
      res.status(401).json({ error: "Automation bearer token required." });
      return;
    }
    next();
  });

  router.get("/status", (_req, res) => {
    res.json({ ok: true, service: "projectego-pm-automation" });
  });

  router.get("/projects/boards", async (_req, res, next) => {
    try {
      res.json({ projects: await buildProjectBoardRoutingMap() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/routing-map", async (_req, res, next) => {
    try {
      res.json({ projects: await buildProjectBoardRoutingMap() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/tasks", async (req, res, next) => {
    try {
      const actor = await store.ensureAutomationUser("n8n");
      const task = await store.createTask(actor, { ...parseCreateTaskBody(req.body), projectId: req.params.projectId });
      emit({ type: "task.created", projectId: task.projectId, taskId: task.id, version: task.version, createdAt: new Date().toISOString(), payload: { task, actor: "n8n" } });
      res.status(201).json({ task });
    } catch (error) {
      next(error);
    }
  });

  router.post("/boards/:boardId/tasks", async (req, res, next) => {
    try {
      const actor = await store.ensureAutomationUser("n8n");
      const board = await store.loadBoard(req.params.boardId);
      const result = await createTaskOnBoard(actor, board.projectId, board.id, req.body);
      emit({ type: "task.created", projectId: board.projectId, taskId: result.task.id, version: result.task.version, createdAt: new Date().toISOString(), payload: { task: result.task, boardId: board.id, position: result.position, actor: "n8n" } });
      emit({ type: "task.moved", projectId: board.projectId, taskId: result.task.id, version: result.task.version, createdAt: new Date().toISOString(), payload: { task: result.task, position: result.position, actor: "n8n" } });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects/:projectId/boards/default/tasks", async (req, res, next) => {
    try {
      const actor = await store.ensureAutomationUser("n8n");
      const { board } = await store.ensureDefaultKanbanBoard(actor, req.params.projectId, optionalBodyString(req.body, "epicId"));
      const result = await createTaskOnBoard(actor, req.params.projectId, board.id, req.body);
      emit({ type: "task.created", projectId: req.params.projectId, taskId: result.task.id, version: result.task.version, createdAt: new Date().toISOString(), payload: { task: result.task, boardId: board.id, position: result.position, actor: "n8n" } });
      emit({ type: "task.moved", projectId: req.params.projectId, taskId: result.task.id, version: result.task.version, createdAt: new Date().toISOString(), payload: { task: result.task, position: result.position, actor: "n8n" } });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  async function createTaskOnBoard(actor: Awaited<ReturnType<PmStore["ensureAutomationUser"]>>, projectId: string, boardId: string, body: unknown) {
    const raw = objectBody(body);
    const taskInput = parseCreateTaskBody(raw);
    const columns = await store.listBoardColumns(boardId);
    const columnId = optionalBodyString(raw, "columnId");
    const column = columnId ? columns.find((entry) => entry.id === columnId) : columns.find((entry) => entry.statusKey === (taskInput.status || "todo")) || columns[0];
    if (!column) throw new Error("Board has no columns.");
    if (columnId && column.id !== columnId) throw new Error("columnId does not belong to board.");
    const task = await store.createTask(actor, { ...taskInput, projectId });
    return store.moveTask(actor, {
      taskId: task.id,
      boardId,
      columnId: column.id,
      position: optionalBodyNumber(raw, "position") ?? Date.now(),
      status: taskInput.status || column.statusKey || task.status,
      expectedVersion: task.version
    });
  }

  async function buildProjectBoardRoutingMap() {
    const actor = await store.ensureAutomationUser("n8n");
    const projects = await store.listProjects(actor.id, true);
    return Promise.all(
      projects.map(async (project) => {
        const projectPath = `/${encodeURIComponent(project.key)}`;
        const boards = await store.listBoards(project.id);
        return {
          ...project,
          path: projectPath,
          apiCreateTaskPath: `/api/pm/automation/projects/${project.id}/tasks`,
          defaultBoardTaskPath: `/api/pm/automation/projects/${project.id}/boards/default/tasks`,
          boards: boards.map((board) => ({
            ...board,
            path: `${projectPath}/${encodeURIComponent(board.id)}`,
            taskPathTemplate: `${projectPath}/${encodeURIComponent(board.id)}/{taskId}`,
            apiBoardPath: `/api/pm/boards/${board.id}`,
            apiCreateTaskPath: `/api/pm/automation/boards/${board.id}/tasks`
          }))
        };
      })
    );
  }

  router.patch("/tasks/:taskId", async (req, res, next) => {
    try {
      const actor = await store.ensureAutomationUser("n8n");
      const task = await store.updateTask(actor, req.params.taskId, parseUpdateTaskBody(req.body));
      emit({ type: "task.updated", projectId: task.projectId, taskId: task.id, version: task.version, createdAt: new Date().toISOString(), payload: { task, actor: "n8n" } });
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/move", async (req, res, next) => {
    try {
      const actor = await store.ensureAutomationUser("n8n");
      const result = await store.moveTask(actor, parseMoveTaskBody(req.params.taskId, req.body));
      emit({
        type: "task.moved",
        projectId: result.task.projectId,
        taskId: result.task.id,
        version: result.task.version,
        createdAt: new Date().toISOString(),
        payload: { task: result.task, position: result.position, actor: "n8n" }
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/comments", async (req, res, next) => {
    try {
      const actor = await store.ensureAutomationUser("n8n");
      const task = await store.loadTask(req.params.taskId);
      const comment = await store.createComment(actor, { taskId: task.id, body: requiredBodyString(req.body, "body") });
      const notifications = await store.createCommentNotifications(actor, task, comment);
      emit({ type: "comment.created", projectId: task.projectId, taskId: task.id, createdAt: new Date().toISOString(), payload: { comment, actor: "n8n" } });
      for (const notification of notifications) {
        emit({ type: "notification.created", projectId: task.projectId, taskId: task.id, createdAt: notification.createdAt, payload: { notification, userId: notification.userId } });
      }
      res.status(201).json({ comment });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:taskId/dependencies", async (req, res, next) => {
    try {
      const actor = await store.ensureAutomationUser("n8n");
      const task = await store.loadTask(req.params.taskId);
      const blockingTaskId = requiredBodyString(req.body, "blockingTaskId");
      await store.addDependency(actor, blockingTaskId, task.id);
      emit({ type: "task.updated", projectId: task.projectId, taskId: task.id, createdAt: new Date().toISOString(), payload: { dependencyAdded: blockingTaskId, actor: "n8n" } });
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId/tasks/next", async (req, res, next) => {
    try {
      const task = await store.getNextAvailableTask(req.params.projectId, typeof req.query.assigneeId === "string" ? req.query.assigneeId : undefined);
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(statusForAutomationError(error)).json({ error: error instanceof Error ? error.message : String(error) });
  });

  return router;
}

function isBearerToken(header: string, expectedToken: string): boolean {
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const actual = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object body is required.");
  return value as Record<string, unknown>;
}

function optionalBodyString(body: unknown, field: string): string | undefined {
  const value = objectBody(body)[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optionalBodyNumber(body: unknown, field: string): number | undefined {
  const value = objectBody(body)[field];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number.`);
  return parsed;
}

function statusForAutomationError(error: unknown): number {
  if (error instanceof PmPermissionError) return error.statusCode;
  if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 409) return 409;
  if (error instanceof Error && /not found/i.test(error.message)) return 404;
  if (error instanceof Error && (/required/i.test(error.message) || /must be/i.test(error.message) || /unsupported/i.test(error.message))) return 400;
  return 500;
}
