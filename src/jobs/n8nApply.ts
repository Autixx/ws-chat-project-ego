import type { AppConfig } from "../config.js";
import { sendApplyToN8n, type N8nApplyPayload, type N8nApplyResult } from "../integrations/n8nApplyClient.js";
import type { Job, JobEvent, JobStore } from "./jobStore.js";

export type N8nApplyDispatchResult = {
  job: Job;
  event: JobEvent;
  result: N8nApplyResult;
};

export async function dispatchApplyJobToN8n(input: {
  config: AppConfig;
  jobs: JobStore;
  jobId: string;
  payload: N8nApplyPayload;
}): Promise<N8nApplyDispatchResult> {
  const result = await sendApplyToN8n(input.config, input.payload);
  if (result.accepted) {
    const event = await input.jobs.appendJobEvent(input.jobId, "started", {
      message: "n8n apply webhook accepted the job.",
      statusCode: result.statusCode
    });
    const job = await input.jobs.updateJobStatus(input.jobId, "running", {
      metadata: { n8n: { accepted: true, statusCode: result.statusCode } }
    });
    return { job, event, result };
  }

  const event = await input.jobs.appendJobEvent(input.jobId, "error", {
    message: result.error,
    statusCode: result.statusCode
  });
  const job = await input.jobs.updateJobStatus(input.jobId, "failed", {
    errorMessage: result.error,
    metadata: { n8n: { accepted: false, statusCode: result.statusCode, error: result.error } }
  });
  return { job, event, result };
}
