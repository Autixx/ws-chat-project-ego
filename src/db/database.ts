import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { runMigrations } from "./migrations.js";

export type AppDatabase = {
  path: string;
  db: Database.Database;
};

export function openDatabase(config: AppConfig): AppDatabase {
  mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  const db = new Database(config.sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return { path: config.sqlitePath, db };
}
