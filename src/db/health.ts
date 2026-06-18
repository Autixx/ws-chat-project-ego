import { accessSync, constants, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { AppDatabase } from "./database.js";

export type DbHealth = {
  status: "ok" | "error";
  path?: string;
  quickCheck?: string;
  writable?: boolean;
  message?: string;
};

export function checkDatabaseHealth(database: AppDatabase): DbHealth {
  try {
    const selectResult = database.db.prepare("SELECT 1 AS value").get() as { value?: number } | undefined;
    if (selectResult?.value !== 1) {
      return { status: "error", message: "SQLite SELECT 1 returned unexpected result." };
    }

    const quick = database.db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    const quickCheck = quick?.quick_check;
    if (quickCheck !== "ok") {
      return { status: "error", path: safeDbPath(database.path), quickCheck, message: `SQLite quick_check failed: ${quickCheck ?? "unknown"}` };
    }

    const dir = path.dirname(database.path);
    accessSync(dir, constants.W_OK);
    const probePath = path.join(dir, `.projectego-health-${process.pid}-${Date.now()}.tmp`);
    writeFileSync(probePath, "ok", { encoding: "utf8", flag: "wx" });
    rmSync(probePath, { force: true });

    return {
      status: "ok",
      path: safeDbPath(database.path),
      quickCheck,
      writable: true
    };
  } catch (error) {
    return {
      status: "error",
      path: safeDbPath(database.path),
      writable: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function safeDbPath(dbPath: string): string {
  return process.env.NODE_ENV === "production" ? path.basename(dbPath) : dbPath;
}
