import type { AuthenticatedUser } from "../auth/authelia.js";

export type DraftItem = {
  title: string;
  summary: string;
  details: string;
  project: string;
  module: string;
  type: "feature" | "bug" | "research" | "refactor" | "content" | "design" | "technical" | "production" | "idea";
  priority: "urgent" | "high" | "medium" | "low" | "none";
  routing_confidence: "high" | "medium" | "low";
  labels: string[];
  dependencies: string[];
  acceptance_criteria: string[];
  needs_clarification: string[];
  source_text: string;
};

export type DraftResult = {
  status: "done";
  source_summary: string;
  items: DraftItem[];
  needs_clarification: string[];
};

export type DraftMetadata = {
  jobId: string;
  createdAt: string;
  mode: string;
  source: string;
  fileName?: string;
  user: AuthenticatedUser;
};

export type StoredDraft = DraftMetadata & {
  result: DraftResult;
};
