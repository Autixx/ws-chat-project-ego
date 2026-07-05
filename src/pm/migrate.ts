import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadPmConfig } from "./config.js";

export async function runPmMigrations(databaseUrl: string, schemaPath = defaultSchemaPath()): Promise<void> {
  const sql = await fs.readFile(schemaPath, "utf8");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(sql);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pm.schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query("INSERT INTO pm.schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", ["001_pm_initial_schema"]);
  } finally {
    await pool.end();
  }
}

function defaultSchemaPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "postgres-schema.sql");
}

const isEntrypoint = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isEntrypoint) {
  const config = loadPmConfig();
  if (!config.databaseUrl) throw new Error("PM_DATABASE_URL is required to run PM migrations.");
  await runPmMigrations(config.databaseUrl, process.env.PM_SCHEMA_PATH);
  console.log("ProjectEGO PM migrations applied.");
}
