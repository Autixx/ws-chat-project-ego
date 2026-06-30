import type { AuthenticatedUser } from "../auth/authelia.js";
import type { AppDatabase } from "../db/database.js";
import { createId, safeUserId } from "../utils/ids.js";

export type JobExecutionStatus = "not_started" | "queued" | "running" | "succeeded" | "failed" | "partial" | "cancelled";

export type Job = {
  id: string;
  conversationId: string;
  requestMessageId?: string;
  responseMessageId?: string;
  draftJobId?: string;
  status: JobExecutionStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export type JobEvent = {
  id: string;
  jobId: string;
  eventType: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type JobUpdateResult = {
  job: Job;
  updatedRows: number;
};

type JobRow = {
  id: string;
  conversation_id: string;
  request_message_id: string | null;
  response_message_id: string | null;
  draft_job_id: string | null;
  status: JobExecutionStatus;
  source: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  metadata_json: string | null;
};

type JobEventRow = {
  id: string;
  job_id: string;
  event_type: string;
  created_at: string;
  payload_json: string | null;
};

export class JobStore {
  constructor(private readonly database: AppDatabase) {}

  createJob(input: {
    conversationId: string;
    requestMessageId?: string;
    responseMessageId?: string;
    draftJobId?: string;
    status: JobExecutionStatus;
    source: string;
    metadata?: Record<string, unknown>;
  }): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      id: createId("JOB"),
      conversationId: input.conversationId,
      requestMessageId: input.requestMessageId,
      responseMessageId: input.responseMessageId,
      draftJobId: input.draftJobId,
      status: input.status,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };
    this.database.db
      .prepare(
        `INSERT INTO jobs (
          id, conversation_id, request_message_id, response_message_id, draft_job_id,
          status, source, created_at, updated_at, metadata_json
        )
        VALUES (
          @id, @conversationId, @requestMessageId, @responseMessageId, @draftJobId,
          @status, @source, @createdAt, @updatedAt, @metadataJson
        )`
      )
      .run({
        id: job.id,
        conversationId: job.conversationId,
        requestMessageId: job.requestMessageId ?? null,
        responseMessageId: job.responseMessageId ?? null,
        draftJobId: job.draftJobId ?? null,
        status: job.status,
        source: job.source,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        metadataJson: job.metadata ? JSON.stringify(job.metadata) : null
      });
    return Promise.resolve(job);
  }

  updateJobStatus(jobId: string, status: JobExecutionStatus, patch: Partial<Pick<Job, "startedAt" | "finishedAt" | "errorMessage" | "metadata">> = {}): Promise<Job> {
    return Promise.resolve(this.updateJobStatusWithResult(jobId, status, patch).job);
  }

  updateJobStatusWithResult(jobId: string, status: JobExecutionStatus, patch: Partial<Pick<Job, "startedAt" | "finishedAt" | "errorMessage" | "metadata">> = {}): JobUpdateResult {
    const current = this.loadJob(jobId);
    const now = new Date().toISOString();
    const metadata = patch.metadata === undefined ? current.metadata : { ...(current.metadata ?? {}), ...patch.metadata };
    const startedAt = patch.startedAt ?? current.startedAt ?? (status === "running" ? now : undefined);
    const finishedAt = patch.finishedAt ?? current.finishedAt ?? (["succeeded", "failed", "partial", "cancelled"].includes(status) ? now : undefined);
    const errorMessage = patch.errorMessage ?? current.errorMessage;
    const result = this.database.db
      .prepare(
        `UPDATE jobs
         SET status = @status,
             updated_at = @updatedAt,
             started_at = @startedAt,
             finished_at = @finishedAt,
             error_message = @errorMessage,
             metadata_json = @metadataJson
         WHERE id = @id`
      )
      .run({
        id: jobId,
        status,
        updatedAt: now,
        startedAt: startedAt ?? null,
        finishedAt: finishedAt ?? null,
        errorMessage: errorMessage ?? null,
        metadataJson: metadata ? JSON.stringify(metadata) : null
      });
    return { job: this.loadJob(jobId), updatedRows: result.changes };
  }

  appendJobEvent(jobId: string, eventType: string, payload?: Record<string, unknown>): Promise<JobEvent> {
    this.loadJob(jobId);
    const event: JobEvent = {
      id: createId("JEV"),
      jobId,
      eventType,
      createdAt: new Date().toISOString(),
      payload
    };
    this.database.db
      .prepare(
        `INSERT INTO job_events (id, job_id, event_type, created_at, payload_json)
         VALUES (@id, @jobId, @eventType, @createdAt, @payloadJson)`
      )
      .run({
        id: event.id,
        jobId: event.jobId,
        eventType: event.eventType,
        createdAt: event.createdAt,
        payloadJson: event.payload ? JSON.stringify(event.payload) : null
      });
    return Promise.resolve(event);
  }

  loadJob(jobId: string): Job {
    const row = this.database.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
    if (!row) throw new Error("Job not found.");
    return rowToJob(row);
  }

  loadJobForUser(user: AuthenticatedUser, jobId: string): Promise<Job> {
    const row = this.database.db
      .prepare(
        `SELECT j.*
         FROM jobs j
         JOIN conversations c ON c.id = j.conversation_id
         WHERE j.id = ? AND c.user_id = ?`
      )
      .get(jobId, safeUserId(user.username)) as JobRow | undefined;
    if (!row) return Promise.reject(new Error("Job not found."));
    return Promise.resolve(rowToJob(row));
  }

  listJobsForConversation(user: AuthenticatedUser, conversationId: string): Promise<Job[]> {
    const rows = this.database.db
      .prepare(
        `SELECT j.*
         FROM jobs j
         JOIN conversations c ON c.id = j.conversation_id
         WHERE j.conversation_id = ? AND c.user_id = ?
         ORDER BY j.updated_at DESC`
      )
      .all(conversationId, safeUserId(user.username)) as JobRow[];
    return Promise.resolve(rows.map(rowToJob));
  }

  listEventsForJob(user: AuthenticatedUser, jobId: string): Promise<JobEvent[]> {
    return this.loadJobForUser(user, jobId).then(() => {
      const rows = this.database.db.prepare("SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at ASC").all(jobId) as JobEventRow[];
      return rows.map(rowToJobEvent);
    });
  }
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    requestMessageId: row.request_message_id ?? undefined,
    responseMessageId: row.response_message_id ?? undefined,
    draftJobId: row.draft_job_id ?? undefined,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    metadata: parseJson(row.metadata_json)
  };
}

function rowToJobEvent(row: JobEventRow): JobEvent {
  return {
    id: row.id,
    jobId: row.job_id,
    eventType: row.event_type,
    createdAt: row.created_at,
    payload: parseJson(row.payload_json)
  };
}

function parseJson(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return { parseError: true };
  }
}
