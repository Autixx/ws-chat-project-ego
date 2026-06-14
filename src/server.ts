import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { attachWebSocketServer } from "./ws/websocketServer.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "projectego-ws-chat" });
});

app.use(express.static(publicDir, { extensions: ["html"] }));

const server = app.listen(config.port, config.host, () => {
  console.log(`ProjectEGO WebSocket Chat listening on http://${config.host}:${config.port}`);
});

attachWebSocketServer(server, config);
