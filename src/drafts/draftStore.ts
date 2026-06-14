import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuthenticatedUser } from "../auth/authelia.js";
import { createJobId, safeUserId } from "../utils/ids.js";
import { renderDraftPreview } from "./previewRenderer.js";
import type { DraftItem, DraftResult, StoredDraft } from "./types.js";

export type StoredDraftResult = {
  draft: StoredDraft;
  preview: string;
};

export class DraftStore {
  constructor(private readonly dataDir: string) {}

  async saveDraft(input: {
    mode: string;
    source: string;
    fileName?: string;
    user: AuthenticatedUser;
    result: DraftResult;
  }): Promise<StoredDraftResult> {
    const jobId = createJobId();
    const draft: StoredDraft = {
      jobId,
      createdAt: new Date().toISOString(),
      mode: input.mode,
      source: input.source,
      fileName: input.fileName,
      user: input.user,
      result: input.result
    };
    const preview = renderDraftPreview(draft);
    const draftDir = path.join(this.dataDir, "drafts", jobId);
    const itemsDir = path.join(draftDir, "items");

    await fs.mkdir(itemsDir, { recursive: true });
    await fs.writeFile(path.join(draftDir, "draft.json"), JSON.stringify(draft, null, 2), "utf8");
    await fs.writeFile(path.join(draftDir, "preview.txt"), preview, "utf8");

    await Promise.all(
      input.result.items.map((item, index) =>
        fs.writeFile(path.join(itemsDir, `${String(index + 1).padStart(3, "0")}.json`), JSON.stringify(item, null, 2), "utf8")
      )
    );

    const latestPath = path.join(this.dataDir, `latest_${safeUserId(input.user.username)}.json`);
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(latestPath, JSON.stringify({ jobId, createdAt: draft.createdAt }, null, 2), "utf8");

    return { draft, preview };
  }

  async loadDraft(jobId: string, user: AuthenticatedUser): Promise<StoredDraft> {
    const resolvedJobId = jobId === "latest" ? await this.loadLatestJobId(user) : jobId;
    const raw = await fs.readFile(path.join(this.dataDir, "drafts", resolvedJobId, "draft.json"), "utf8");
    return JSON.parse(raw) as StoredDraft;
  }

  async discardDraft(jobId: string, user: AuthenticatedUser): Promise<string> {
    const resolvedJobId = jobId === "latest" ? await this.loadLatestJobId(user) : jobId;
    await fs.rm(path.join(this.dataDir, "drafts", resolvedJobId), { recursive: true, force: true });
    return resolvedJobId;
  }

  selectItems(draft: StoredDraft, indexes: number[]): DraftItem[] {
    return indexes.map((itemIndex) => draft.result.items[itemIndex - 1]).filter((item): item is DraftItem => Boolean(item));
  }

  private async loadLatestJobId(user: AuthenticatedUser): Promise<string> {
    const raw = await fs.readFile(path.join(this.dataDir, `latest_${safeUserId(user.username)}.json`), "utf8");
    const latest = JSON.parse(raw) as { jobId?: string };
    if (!latest.jobId) throw new Error("Latest draft is not available.");
    return latest.jobId;
  }
}
