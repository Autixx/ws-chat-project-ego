import express from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageUploadedFile, streamAttachment, validateAttachmentFile, MAX_ATTACHMENT_BYTES } from "./attachments/attachmentService.js";
import { createAuthRouter } from "./auth/authRoutes.js";
import { requireUserMiddleware } from "./auth/requireUser.js";
import { config } from "./config.js";
import { ConversationStore } from "./conversations/conversationStore.js";
import { openDatabase } from "./db/database.js";
import { handleJobCallback } from "./jobs/jobCallback.js";
import { JobStore } from "./jobs/jobStore.js";
import { ComponentStatusMonitor } from "./status/componentStatus.js";
import { attachWebSocketServer } from "./ws/websocketServer.js";

const app = express();
type AuthedRequest = express.Request & { auth?: { user: import("./auth/authelia.js").AuthenticatedUser } };
let webSocketRuntime: ReturnType<typeof attachWebSocketServer> | undefined;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const database = openDatabase(config);
const conversations = new ConversationStore(database);
const jobs = new JobStore(database);
const componentStatus = new ComponentStatusMonitor(config);
const uploadTempDir = path.join(config.dataDir, "attachments", "tmp");
await fs.mkdir(uploadTempDir, { recursive: true });
const upload = multer({
  dest: uploadTempDir,
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    try {
      validateAttachmentFile(file.originalname, file.mimetype, 0);
      cb(null, true);
    } catch (error) {
      cb(error instanceof Error ? error : new Error(String(error)));
    }
  }
});

if (process.env.NODE_ENV === "production" && !config.sessionSecret) {
  throw new Error("SESSION_SECRET is required in production.");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(createAuthRouter(config, database));

app.get("/health", (_req, res) => {
  const body = componentStatus.snapshot(database);
  res.status(body.status === "ok" ? 200 : 503).json(body);
});

app.post("/api/jobs/:jobId/events", async (req, res) => {
  try {
    const result = await handleJobCallback({
      config,
      jobs,
      jobId: req.params.jobId,
      authorization: req.headers.authorization,
      body: req.body ?? {}
    });
    await webSocketRuntime?.notifyJobUpdated(result.job, result.event);
    res.json(result);
  } catch (error) {
    const statusCode = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 404;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/uploads", requireUserMiddleware(config, database), upload.array("files", 8), async (req, res) => {
  try {
    const user = (req as AuthedRequest).auth?.user;
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const files = (req.files ?? []) as Express.Multer.File[];
    const uploads = [];
    for (const file of files) {
      uploads.push(
        await stageUploadedFile({
          dataDir: config.dataDir,
          user,
          tempPath: file.path,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size
        })
      );
    }
    res.json({ uploads });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/attachments/:attachmentId", requireUserMiddleware(config, database), async (req, res) => {
  try {
    const user = (req as AuthedRequest).auth?.user;
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const attachment = await conversations.loadAttachmentForUser(user, req.params.attachmentId);
    await streamAttachment({ dataDir: config.dataDir, attachment, res });
  } catch (error) {
    if (!res.headersSent) res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get(["/login", "/register"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use(express.static(publicDir, { extensions: ["html"] }));

const server = app.listen(config.port, config.host, () => {
  console.log(`ProjectEGO Dashboard listening on http://${config.host}:${config.port}`);
});

webSocketRuntime = attachWebSocketServer(server, config, database, componentStatus);
