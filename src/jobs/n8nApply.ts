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
  console.debug("ProjectEGO n8n apply dispatch before POST", {
    jobId: input.jobId,
    payloadJobId: input.payload.jobId,
    itemCount: input.payload.items.length
  });
  const result = await sendApplyToN8n(input.config, input.payload);
  try {
    if (result.accepted) {
      console.debug("ProjectEGO n8n apply dispatch after POST", {
        jobId: input.jobId,
        accepted: true,
        statusCode: result.statusCode
      });
      const event = await input.jobs.appendJobEvent(input.jobId, "started", {
        message: "n8n apply webhook accepted the job.",
        statusCode: result.statusCode
      });
      const job = await input.jobs.updateJobStatus(
        input.jobId,
        "running",
        {
          metadata: { n8n: { accepted: true, statusCode: result.statusCode } }
        },
        "dispatchApplyJobToN8n.accepted"
      );
      return { job, event, result };
    }

    console.debug("ProjectEGO n8n apply dispatch error handler", {
      jobId: input.jobId,
      accepted: false,
      statusCode: result.statusCode,
      error: result.error
    });
    const event = await input.jobs.appendJobEvent(input.jobId, "error", {
      message: result.error,
      statusCode: result.statusCode
    });
    const job = await input.jobs.updateJobStatus(
      input.jobId,
      "failed",
      {
        errorMessage: result.error,
        metadata: { n8n: { accepted: false, statusCode: result.statusCode, error: result.error } }
      },
      "dispatchApplyJobToN8n.error"
    );
    return { job, event, result };
  } finally {
    console.debug("ProjectEGO n8n apply dispatch finally", {
      jobId: input.jobId,
      accepted: result.accepted
    });
  }
}
