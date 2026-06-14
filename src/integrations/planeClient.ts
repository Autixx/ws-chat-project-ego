import type { AppConfig } from "../config.js";
import type { DraftItem } from "../drafts/types.js";

export type PlaneApplyResult = {
  createdCount: number;
  message: string;
};

export class PlaneClient {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.planeBaseUrl && this.config.planeApiKey && this.config.planeWorkspace);
  }

  async createWorkItems(items: DraftItem[]): Promise<PlaneApplyResult> {
    if (!this.isConfigured()) {
      return {
        createdCount: 0,
        message: "Plane integration is not configured."
      };
    }

    return {
      createdCount: 0,
      message: `Plane integration is configured, but project ID mapping is not implemented yet. ${items.length} item(s) were not created.`
    };
  }
}
