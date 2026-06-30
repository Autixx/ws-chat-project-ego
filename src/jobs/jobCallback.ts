import type { AppConfig } from "../config.js";
import type { Job, JobEvent, JobExecutionStatus, JobStore } from "./jobStore.js";

export type JobCallbackBody = {
  status?: unknown;
  eventType?: unknown;
  message?: unknown;
  externalRefs?: unknown;
  payload?: unknown;
};

export type JobCallbackResult = {
  ok: true;
  jobId: string;
  eventType: string;
  status: string;
  previousStatus: JobExecutionStatus;
  nextStatus: JobExecutionStatus;
  updatedRows: number;
  saved: boolean;
  externalRefsCount: number;
  finishedAt?: string;
  completedAt?: string;
  currentJob: Job;
  job: Job;
  event: JobEvent;
};

const CALLBACK_STATUSES = new Set<JobExecutionStatus>(["running", "succeeded", "failed", "partial", "cancelled"]);
const FINISHED_CALLBACK_STATUSES = new Set<JobExecutionStatus>(["succeeded", "failed", "partial"]);
const CALLBACK_EVENT_TYPES = new Set(["started", "plane_created", "plane_failed", "finished", "error"]);

export async function handleJobCallback(input: { config: AppConfig; jobs: JobStore; jobId: string; authorization?: string; body: JobCallbackBody }): Promise<JobCallbackResult> {
  const expected = input.config.jobCallbackToken;
  if (!expected) throw Object.assign(new Error("Job callback token is not configured."), { statusCode: 503 });
  if (input.authorization !== `Bearer ${expected}`) throw Object.assign(new Error("Invalid job callback token."), { statusCode: 401 });

  const status = String(input.body.status ?? "");
  const eventType = String(input.body.eventType ?? "");
  if (!CALLBACK_STATUSES.has(status as JobExecutionStatus)) throw Object.assign(new Error("Invalid job status."), { statusCode: 400 });
  if (!CALLBACK_EVENT_TYPES.has(eventType)) throw Object.assign(new Error("Invalid job event type."), { statusCode: 400 });
  if (eventType === "finished" && !FINISHED_CALLBACK_STATUSES.has(status as JobExecutionStatus)) {
    throw Object.assign(new Error("Finished callback requires terminal status: succeeded, failed, or partial."), { statusCode: 400 });
  }

  const previousJob = input.jobs.loadJob(input.jobId);
  const payload = normalizePayload(input.body);
  const event = await input.jobs.appendJobEvent(input.jobId, eventType, payload);
  const message = typeof input.body.message === "string" ? input.body.message : undefined;
  const nextStatus = nextExecutionStatus(eventType, status as JobExecutionStatus);
  const completedAt = ["succeeded", "failed", "partial", "cancelled"].includes(nextStatus) ? new Date().toISOString() : undefined;
  const externalRefsCount = Array.isArray(payload.externalRefs) ? payload.externalRefs.length : 0;
  const debugBase = {
    jobId: input.jobId,
    eventType,
    status,
    createdCount: payloadNumber(payload, "createdCount"),
    duplicateCount: payloadNumber(payload, "duplicateCount"),
    previousStatus: previousJob.status,
    nextStatus
  };
  const update = input.jobs.updateJobStatusWithResult(input.jobId, nextStatus, {
    finishedAt: completedAt,
    errorMessage: status === "failed" ? message : undefined,
    metadata: {
      ...(payload.externalRefs ? { externalRefs: payload.externalRefs } : {}),
      ...(completedAt ? { completedAt } : {})
    }
  });
  const currentJob = input.jobs.loadJob(input.jobId);
  const saved = update.updatedRows > 0 && currentJob.status === nextStatus;
  if (eventType === "finished" && currentJob.status === "running") {
    throw Object.assign(new Error("Finished callback did not transition job to terminal state."), { statusCode: 500 });
  }
  const response: JobCallbackResult = {
    ok: true,
    jobId: input.jobId,
    eventType,
    status,
    previousStatus: previousJob.status,
    nextStatus,
    updatedRows: update.updatedRows,
    saved,
    externalRefsCount,
    finishedAt: currentJob.finishedAt,
    completedAt: typeof currentJob.metadata?.completedAt === "string" ? currentJob.metadata.completedAt : undefined,
    currentJob,
    job: currentJob,
    event
  };
  console.debug("ProjectEGO job callback", {
    ...debugBase,
    updatedRows: response.updatedRows,
    saved: response.saved,
    externalRefsCount: response.externalRefsCount,
    finishedAt: response.finishedAt,
    completedAt: response.completedAt,
    currentJob: response.currentJob
  });
  return response;
}

function normalizePayload(body: JobCallbackBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof body.message === "string") payload.message = body.message;
  if (Array.isArray(body.externalRefs)) payload.externalRefs = body.externalRefs;
  if (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
    payload.payload = body.payload;
    const nested = body.payload as Record<string, unknown>;
    if (Array.isArray(nested.externalRefs) && !payload.externalRefs) payload.externalRefs = nested.externalRefs;
  }
  return payload;
}

function nextExecutionStatus(eventType: string, callbackStatus: JobExecutionStatus): JobExecutionStatus {
  if (eventType !== "finished") return callbackStatus;
  return callbackStatus;
}

function payloadNumber(payload: Record<string, unknown>, key: "createdCount" | "duplicateCount"): number | undefined {
  const nested = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload) ? (payload.payload as Record<string, unknown>) : {};
  const value = payload[key] ?? nested[key];
  return typeof value === "number" ? value : undefined;
}
