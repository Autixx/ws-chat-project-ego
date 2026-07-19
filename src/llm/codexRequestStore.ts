import type { AppDatabase } from "../db/database.js";
import type { CodexTrace, LlmTaskMode } from "./provider.js";

export type CodexRequestStatus = "started" | "done" | "error";

export type CodexRequestRecord = {
  clientRequestId: string;
  threadId: string;
  source: string;
  mode: LlmTaskMode;
  inputText: string;
  status: CodexRequestStatus;
  codexJobId?: string;
  codexInternalSessionId?: string;
  codexSessionId?: string;
  sessionTurnCount?: number;
  sessionRotated?: boolean;
  result?: unknown;
  warnings?: unknown[];
  error?: string;
  createdAt: string;
  completedAt?: string;
};

type CodexRequestRow = {
  client_request_id: string;
  thread_id: string;
  source: string;
  mode: LlmTaskMode;
  input_text: string;
  status: CodexRequestStatus;
  codex_job_id: string | null;
  codex_internal_session_id: string | null;
  codex_session_id: string | null;
  session_turn_count: number | null;
  session_rotated: number | null;
  result_json: string | null;
  warnings_json: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export class CodexRequestStore {
  constructor(private readonly database: AppDatabase) {}

  start(input: { clientRequestId: string; threadId: string; source: string; mode: LlmTaskMode; inputText: string }): CodexRequestRecord {
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT OR REPLACE INTO codex_requests
         (client_request_id, thread_id, source, mode, input_text, status, created_at)
         VALUES (@clientRequestId, @threadId, @source, @mode, @inputText, 'started', @createdAt)`
      )
      .run({ ...input, createdAt: now });
    return { ...input, status: "started", createdAt: now };
  }

  complete(trace: CodexTrace): CodexRequestRecord {
    const completedAt = trace.completedAt ?? new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT OR IGNORE INTO codex_requests
         (client_request_id, thread_id, source, mode, input_text, status, created_at)
         VALUES (@clientRequestId, @threadId, @source, @mode, @inputText, 'started', @createdAt)`
      )
      .run({
        clientRequestId: trace.clientRequestId,
        threadId: trace.threadId,
        source: trace.source,
        mode: trace.mode,
        inputText: trace.inputText,
        createdAt: completedAt
      });
    this.database.db
      .prepare(
        `UPDATE codex_requests
         SET thread_id = @threadId,
             source = @source,
             mode = @mode,
             input_text = @inputText,
             status = @status,
             codex_job_id = @codexJobId,
             codex_internal_session_id = @codexInternalSessionId,
             codex_session_id = @codexSessionId,
             session_turn_count = @sessionTurnCount,
             session_rotated = @sessionRotated,
             result_json = @resultJson,
             warnings_json = @warningsJson,
             error = @error,
             completed_at = @completedAt
         WHERE client_request_id = @clientRequestId`
      )
      .run({
        clientRequestId: trace.clientRequestId,
        threadId: trace.threadId,
        source: trace.source,
        mode: trace.mode,
        inputText: trace.inputText,
        status: trace.status === "done" ? "done" : "error",
        codexJobId: trace.codexJobId ?? null,
        codexInternalSessionId: trace.codexInternalSessionId ?? null,
        codexSessionId: trace.codexSessionId ?? null,
        sessionTurnCount: trace.sessionTurnCount ?? null,
        sessionRotated: trace.sessionRotated === undefined ? null : trace.sessionRotated ? 1 : 0,
        resultJson: trace.result === undefined ? null : JSON.stringify(trace.result),
        warningsJson: trace.warnings === undefined ? null : JSON.stringify(trace.warnings),
        error: trace.error ?? null,
        completedAt
      });
    return this.load(trace.clientRequestId) ?? {
      clientRequestId: trace.clientRequestId,
      threadId: trace.threadId,
      source: trace.source,
      mode: trace.mode,
      inputText: trace.inputText,
      status: trace.status === "done" ? "done" : "error",
      createdAt: completedAt,
      completedAt
    };
  }

  load(clientRequestId: string): CodexRequestRecord | undefined {
    const row = this.database.db
      .prepare(
        `SELECT client_request_id, thread_id, source, mode, input_text, status, codex_job_id, codex_internal_session_id,
                codex_session_id, session_turn_count, session_rotated, result_json, warnings_json, error, created_at, completed_at
         FROM codex_requests
         WHERE client_request_id = ?`
      )
      .get(clientRequestId) as CodexRequestRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }
}

function rowToRecord(row: CodexRequestRow): CodexRequestRecord {
  return {
    clientRequestId: row.client_request_id,
    threadId: row.thread_id,
    source: row.source,
    mode: row.mode,
    inputText: row.input_text,
    status: row.status,
    codexJobId: row.codex_job_id ?? undefined,
    codexInternalSessionId: row.codex_internal_session_id ?? undefined,
    codexSessionId: row.codex_session_id ?? undefined,
    sessionTurnCount: row.session_turn_count ?? undefined,
    sessionRotated: row.session_rotated === null ? undefined : Boolean(row.session_rotated),
    result: parseJson(row.result_json),
    warnings: parseJsonArray(row.warnings_json),
    error: row.error ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined
  };
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: string | null): unknown[] | undefined {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : undefined;
}
