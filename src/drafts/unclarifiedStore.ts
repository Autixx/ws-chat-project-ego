import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuthenticatedUser } from "../auth/authelia.js";
import type { DraftItem } from "./types.js";

export type UnclarifiedItem = {
  id: string;
  createdAt: string;
  user: AuthenticatedUser;
  item: DraftItem;
};

export type StoredUnclarifiedResult = {
  ids: string[];
  items: UnclarifiedItem[];
};

export class UnclarifiedStore {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "unclarified");
  }

  async storeUnclarifiedItems(items: DraftItem[], user: AuthenticatedUser): Promise<StoredUnclarifiedResult> {
    await this.ensure();
    const stored: UnclarifiedItem[] = [];
    for (const item of items) {
      const id = await this.nextId();
      const record: UnclarifiedItem = { id, createdAt: new Date().toISOString(), user, item };
      await fs.writeFile(path.join(this.root, "items", `${id}.json`), JSON.stringify(record, null, 2), "utf8");
      stored.push(record);
    }
    await this.rebuildIndex();
    return { ids: stored.map((item) => item.id), items: stored };
  }

  async renderUnclarifiedIndex(): Promise<string> {
    await this.ensure();
    const index = await this.readIndex();
    if (!index.length) return "No unclarified items.";

    return index
      .map((entry) => [
        `${entry.id} (${entry.createdAt})`,
        `Title: ${entry.title}`,
        `Project: ${entry.project}`,
        `Summary: ${entry.summary}`
      ].join("\n"))
      .join("\n\n");
  }

  async loadUnclarifiedItem(id: string): Promise<UnclarifiedItem> {
    const raw = await fs.readFile(path.join(this.root, "items", `${id}.json`), "utf8");
    return JSON.parse(raw) as UnclarifiedItem;
  }

  async removeUnclarifiedItem(id: string): Promise<void> {
    await fs.rm(path.join(this.root, "items", `${id}.json`), { force: true });
    await this.rebuildIndex();
  }

  private async ensure(): Promise<void> {
    await fs.mkdir(path.join(this.root, "items"), { recursive: true });
    await fs.mkdir(this.root, { recursive: true });
    try {
      await fs.access(path.join(this.root, "counter.json"));
    } catch {
      await fs.writeFile(path.join(this.root, "counter.json"), JSON.stringify({ value: 0 }, null, 2), "utf8");
    }
    try {
      await fs.access(path.join(this.root, "index.json"));
    } catch {
      await fs.writeFile(path.join(this.root, "index.json"), "[]", "utf8");
    }
  }

  private async nextId(): Promise<string> {
    const counterPath = path.join(this.root, "counter.json");
    const raw = await fs.readFile(counterPath, "utf8");
    const counter = JSON.parse(raw) as { value: number };
    const next = counter.value + 1;
    await fs.writeFile(counterPath, JSON.stringify({ value: next }, null, 2), "utf8");
    return `U-${String(next).padStart(6, "0")}`;
  }

  private async readIndex(): Promise<Array<{ id: string; createdAt: string; title: string; project: string; summary: string }>> {
    const raw = await fs.readFile(path.join(this.root, "index.json"), "utf8");
    return JSON.parse(raw) as Array<{ id: string; createdAt: string; title: string; project: string; summary: string }>;
  }

  private async rebuildIndex(): Promise<void> {
    await this.ensure();
    const files = await fs.readdir(path.join(this.root, "items"));
    const records = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const raw = await fs.readFile(path.join(this.root, "items", file), "utf8");
          return JSON.parse(raw) as UnclarifiedItem;
        })
    );

    const index = records
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        title: record.item.title,
        project: record.item.project,
        summary: record.item.summary
      }));
    await fs.writeFile(path.join(this.root, "index.json"), JSON.stringify(index, null, 2), "utf8");
  }
}
