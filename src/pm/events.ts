import type { WebSocket } from "ws";

export type PmEventType =
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "epic.created"
  | "epic.updated"
  | "board.created"
  | "board.updated"
  | "board.column_created"
  | "task.created"
  | "task.updated"
  | "task.moved"
  | "task.deleted"
  | "comment.created"
  | "comment.updated"
  | "comment.deleted"
  | "attachment.created"
  | "attachment.deleted"
  | "sprint.updated"
  | "presence.updated";

export type PmEvent = {
  type: PmEventType;
  projectId?: string;
  taskId?: string;
  version?: number;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export class PmEventHub {
  private readonly clients = new Set<WebSocket>();

  add(client: WebSocket): void {
    this.clients.add(client);
    client.on("close", () => this.clients.delete(client));
    client.on("error", () => this.clients.delete(client));
  }

  broadcast(event: PmEvent): void {
    const body = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(body);
    }
  }

  snapshot(): { clients: number } {
    return { clients: this.clients.size };
  }
}
