import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distPm = path.join(root, "dist", "pm");
await mkdir(distPm, { recursive: true });
await cp(path.join(root, "src", "pm", "postgres-schema.sql"), path.join(distPm, "postgres-schema.sql"));

const publicAdmin = path.join(root, "public", "admin");
await mkdir(publicAdmin, { recursive: true });
