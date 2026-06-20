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
  job: Job;
  event: JobEvent;
};

const CALLBACK_STATUSES = new Set<JobExecutionStatus>(["running", "succeeded", "failed", "partial", "cancelled"]);
const CALLBACK_EVENT_TYPES = new Set(["started", "plane_created", "plane_failed", "finished", "error"]);

export async function handleJobCallback(input: { config: AppConfig; jobs: JobStore; jobId: string; authorization?: string; body: JobCallbackBody }): Promise<JobCallbackResult> {
  const expected = input.config.jobCallbackToken;
  if (!expected) throw Object.assign(new Error("Job callback token is not configured."), { statusCode: 503 });
  if (input.authorization !== `Bearer ${expected}`) throw Object.assign(new Error("Invalid job callback token."), { statusCode: 401 });

  const status = String(input.body.status ?? "");
  const eventType = String(input.body.eventType ?? "");
  if (!CALLBACK_STATUSES.has(status as JobExecutionStatus)) throw Object.assign(new Error("Invalid job status."), { statusCode: 400 });
  if (!CALLBACK_EVENT_TYPES.has(eventType)) throw Object.assign(new Error("Invalid job event type."), { statusCode: 400 });

  input.jobs.loadJob(input.jobId);
  const payload = normalizePayload(input.body);
  const event = await input.jobs.appendJobEvent(input.jobId, eventType, payload);
  const message = typeof input.body.message === "string" ? input.body.message : undefined;
  const job = await input.jobs.updateJobStatus(input.jobId, status as JobExecutionStatus, {
    errorMessage: status === "failed" ? message : undefined,
    metadata: payload.externalRefs ? { externalRefs: payload.externalRefs } : undefined
  });
  return { job, event };
}

function normalizePayload(body: JobCallbackBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof body.message === "string") payload.message = body.message;
  if (Array.isArray(body.externalRefs)) payload.externalRefs = body.externalRefs;
  if (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) payload.payload = body.payload;
  return payload;
}
