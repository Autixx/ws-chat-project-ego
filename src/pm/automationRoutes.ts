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

function statusForAutomationError(error: unknown): number {
  if (error instanceof PmPermissionError) return error.statusCode;
  if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 409) return 409;
  if (error instanceof Error && /not found/i.test(error.message)) return 404;
  if (error instanceof Error && (/required/i.test(error.message) || /must be/i.test(error.message) || /unsupported/i.test(error.message))) return 400;
  return 500;
}
