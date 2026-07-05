import { Pool, type PoolClient } from "pg";
import type { AuthenticatedUser } from "../auth/authelia.js";
import { normalizeRole } from "./permissions.js";
import type {
  CreateEpicInput,
  CreateBoardColumnInput,
  CreateProjectInput,
  CreateTaskInput,
  MoveTaskInput,
  PmBoard,
  PmBoardColumn,
  PmBoardTask,
  PmEpic,
  PmEventRecord,
  PmProject,
  PmRole,
  PmTask,
  PmTaskPosition,
  PmUser,
  UpdateProjectInput,
  UpdateTaskInput
} from "./types.js";

type Row = Record<string, unknown>;

export class PmConflictError extends Error {
  readonly statusCode = 409;
}

export class PmStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.pool.query("SELECT 1");
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async ensureUser(identity: AuthenticatedUser): Promise<PmUser> {
    const username = identity.username.trim();
    const email = identity.email?.trim() || null;
    const displayName = identity.name?.trim() || username;
    const externalSubject = email ?? username;
    const result = await this.pool.query(
      `
      INSERT INTO core.users (username, email, display_name, external_subject)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (external_subject)
      DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email, display_name = EXCLUDED.display_name, updated_at = now()
      RETURNING id, username, email, display_name
      `,
      [username, email, displayName, externalSubject]
    );
    return mapUser(result.rows[0]);
  }

  async listProjects(userId: string, includeArchived = false): Promise<PmProject[]> {
    const result = await this.pool.query(
      `
      SELECT p.*, m.role
      FROM pm.projects p
      JOIN pm.project_members m ON m.project_id = p.id
      WHERE m.user_id = $1
        AND p.deleted_at IS NULL
        AND ($2::boolean OR p.archived_at IS NULL)
      ORDER BY p.updated_at DESC
      `,
      [userId, includeArchived]
    );
    return result.rows.map(mapProject);
  }

  async getProjectRole(userId: string, projectId: string): Promise<PmRole | undefined> {
    const result = await this.pool.query("SELECT role FROM pm.project_members WHERE user_id = $1 AND project_id = $2", [userId, projectId]);
    return result.rows[0] ? normalizeRole(result.rows[0].role) : undefined;
  }

  async createProject(user: PmUser, input: CreateProjectInput): Promise<PmProject> {
    return this.withTransaction(async (client) => {
      const project = mapProject(
        (
          await client.query(
            `
            INSERT INTO pm.projects (key, name, description, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [normalizeKey(input.key), input.name.trim(), input.description?.trim() ?? "", user.id]
          )
        ).rows[0]
      );
      await client.query("INSERT INTO pm.project_members (project_id, user_id, role) VALUES ($1, $2, 'project_owner')", [project.id, user.id]);
      await this.insertAudit(client, { actorType: "user", actorId: user.id, projectId: project.id, eventType: "project.created", payload: { key: project.key, name: project.name } });
      return { ...project, role: "project_owner" };
    });
  }

  async updateProject(user: PmUser, projectId: string, input: UpdateProjectInput): Promise<PmProject> {
    const values = [projectId, input.name?.trim() ?? null, input.description?.trim() ?? null, input.expectedVersion ?? null];
    const result = await this.pool.query(
      `
      UPDATE pm.projects
      SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        version = version + 1,
        updated_at = now()
      WHERE id = $1
        AND deleted_at IS NULL
        AND ($4::bigint IS NULL OR version = $4::bigint)
      RETURNING *
      `,
      values
    );
    if (!result.rows[0]) throw new PmConflictError("Project version conflict or project not found.");
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId, eventType: "project.updated", payload: input });
    return mapProject(result.rows[0]);
  }

  async archiveProject(user: PmUser, projectId: string, archived: boolean): Promise<PmProject> {
    const result = await this.pool.query(
      `
      UPDATE pm.projects
      SET archived_at = CASE WHEN $2::boolean THEN now() ELSE NULL END, version = version + 1, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [projectId, archived]
    );
    if (!result.rows[0]) throw new Error("Project not found.");
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId, eventType: archived ? "project.archived" : "project.unarchived" });
    return mapProject(result.rows[0]);
  }

  async softDeleteProject(user: PmUser, projectId: string): Promise<PmProject> {
    const result = await this.pool.query(
      "UPDATE pm.projects SET deleted_at = now(), version = version + 1, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *",
      [projectId]
    );
    if (!result.rows[0]) throw new Error("Project not found.");
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId, eventType: "project.deleted" });
    return mapProject(result.rows[0]);
  }

  async listMembers(projectId: string): Promise<Array<PmUser & { role: PmRole }>> {
    const result = await this.pool.query(
      `
      SELECT u.id, u.username, u.email, u.display_name, m.role
      FROM pm.project_members m
      JOIN core.users u ON u.id = m.user_id
      WHERE m.project_id = $1
      ORDER BY m.created_at ASC
      `,
      [projectId]
    );
    return result.rows.map((row) => ({ ...mapUser(row), role: normalizeRole(row.role) }));
  }

  async setMemberRole(actor: PmUser, projectId: string, userId: string, role: PmRole): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO pm.project_members (project_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
      `,
      [projectId, userId, role]
    );
    await this.insertAudit(this.pool, { actorType: "user", actorId: actor.id, projectId, eventType: "member.role_set", payload: { userId, role } });
  }

  async listEpics(projectId: string): Promise<PmEpic[]> {
    const result = await this.pool.query(
      "SELECT * FROM pm.epics WHERE project_id = $1 AND deleted_at IS NULL ORDER BY position ASC, updated_at DESC",
      [projectId]
    );
    return result.rows.map(mapEpic);
  }

  async createEpic(user: PmUser, input: CreateEpicInput): Promise<PmEpic> {
    const result = await this.pool.query(
      `
      INSERT INTO pm.epics (project_id, title, description, status, priority, position, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [input.projectId, input.title.trim(), input.description?.trim() ?? "", input.status ?? "open", input.priority ?? "medium", input.position ?? 1000, user.id]
    );
    const epic = mapEpic(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: input.projectId, eventType: "epic.created", payload: { epicId: epic.id } });
    return epic;
  }

  async listBoards(projectId: string, epicId?: string): Promise<PmBoard[]> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM pm.boards
      WHERE project_id = $1
        AND ($2::uuid IS NULL OR epic_id = $2::uuid)
      ORDER BY board_type ASC, updated_at DESC
      `,
      [projectId, epicId ?? null]
    );
    return result.rows.map(mapBoard);
  }

  async loadBoard(boardId: string): Promise<PmBoard> {
    const result = await this.pool.query("SELECT * FROM pm.boards WHERE id = $1", [boardId]);
    if (!result.rows[0]) throw new Error("Board not found.");
    return mapBoard(result.rows[0]);
  }

  async ensureDefaultKanbanBoard(user: PmUser, projectId: string, epicId?: string): Promise<{ board: PmBoard; columns: PmBoardColumn[] }> {
    return this.withTransaction(async (client) => {
      const existing = await client.query(
        `
        SELECT *
        FROM pm.boards
        WHERE project_id = $1
          AND epic_id IS NOT DISTINCT FROM $2::uuid
          AND board_type = 'kanban'
        ORDER BY created_at ASC
        LIMIT 1
        `,
        [projectId, epicId ?? null]
      );
      const board = existing.rows[0]
        ? mapBoard(existing.rows[0])
        : mapBoard(
            (
              await client.query(
                `
                INSERT INTO pm.boards (project_id, epic_id, name, board_type)
                VALUES ($1, $2, $3, 'kanban')
                RETURNING *
                `,
                [projectId, epicId ?? null, epicId ? "Epic Kanban" : "Project Kanban"]
              )
            ).rows[0]
          );

      await this.ensureDefaultColumns(client, board.id);
      const columns = (await client.query("SELECT * FROM pm.board_columns WHERE board_id = $1 ORDER BY position ASC", [board.id])).rows.map(mapColumn);
      if (!existing.rows[0]) {
        await this.insertAudit(client, { actorType: "user", actorId: user.id, projectId, eventType: "board.created", payload: { boardId: board.id, type: "kanban" } });
      }
      return { board, columns };
    });
  }

  async listBoardColumns(boardId: string): Promise<PmBoardColumn[]> {
    const result = await this.pool.query("SELECT * FROM pm.board_columns WHERE board_id = $1 ORDER BY position ASC", [boardId]);
    return result.rows.map(mapColumn);
  }

  async createBoardColumn(user: PmUser, input: CreateBoardColumnInput): Promise<PmBoardColumn> {
    const board = await this.loadBoard(input.boardId);
    const result = await this.pool.query(
      `
      INSERT INTO pm.board_columns (board_id, name, status_key, position, wip_limit)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [input.boardId, input.name.trim(), normalizeStatusKey(input.statusKey), input.position ?? 1000, input.wipLimit ?? null]
    );
    const column = mapColumn(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: board.projectId, eventType: "board.column_created", payload: { boardId: board.id, columnId: column.id } });
    return column;
  }

  async loadBoardSnapshot(boardId: string): Promise<{ board: PmBoard; columns: PmBoardColumn[]; tasks: PmBoardTask[] }> {
    const board = await this.loadBoard(boardId);
    const columns = await this.listBoardColumns(boardId);
    const taskResult = await this.pool.query(
      `
      SELECT t.*, tp.column_id, tp.position AS board_position
      FROM pm.tasks t
      LEFT JOIN pm.task_positions tp ON tp.task_id = t.id AND tp.board_id = $1
      WHERE t.project_id = $2
        AND t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND ($3::uuid IS NULL OR t.epic_id = $3::uuid)
      ORDER BY COALESCE(tp.position, 1000000000), t.updated_at DESC
      `,
      [board.id, board.projectId, board.epicId ?? null]
    );
    return { board, columns, tasks: taskResult.rows.map(mapBoardTask) };
  }

  async listTasks(projectId: string, filters: { epicId?: string; sprintId?: string; includeArchived?: boolean } = {}): Promise<PmTask[]> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM pm.tasks
      WHERE project_id = $1
        AND deleted_at IS NULL
        AND ($2::uuid IS NULL OR epic_id = $2::uuid)
        AND ($3::uuid IS NULL OR sprint_id = $3::uuid)
        AND ($4::boolean OR archived_at IS NULL)
      ORDER BY updated_at DESC
      `,
      [projectId, filters.epicId ?? null, filters.sprintId ?? null, Boolean(filters.includeArchived)]
    );
    return result.rows.map(mapTask);
  }

  async loadTask(taskId: string): Promise<PmTask> {
    const result = await this.pool.query("SELECT * FROM pm.tasks WHERE id = $1 AND deleted_at IS NULL", [taskId]);
    if (!result.rows[0]) throw new Error("Task not found.");
    return mapTask(result.rows[0]);
  }

  async createTask(user: PmUser, input: CreateTaskInput): Promise<PmTask> {
    const result = await this.pool.query(
      `
      INSERT INTO pm.tasks (project_id, epic_id, sprint_id, parent_task_id, title, description, status, priority, assignee_id, creator_id, due_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        input.projectId,
        input.epicId ?? null,
        input.sprintId ?? null,
        input.parentTaskId ?? null,
        input.title.trim(),
        input.description?.trim() ?? "",
        input.status ?? "todo",
        input.priority ?? "medium",
        input.assigneeId ?? null,
        user.id,
        input.dueAt ?? null
      ]
    );
    const task = mapTask(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: input.projectId, taskId: task.id, eventType: "task.created" });
    return task;
  }

  async updateTask(user: PmUser, taskId: string, input: UpdateTaskInput): Promise<PmTask> {
    const result = await this.pool.query(
      `
      UPDATE pm.tasks
      SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        status = COALESCE($4, status),
        priority = COALESCE($5, priority),
        assignee_id = COALESCE($6, assignee_id),
        epic_id = COALESCE($7, epic_id),
        sprint_id = COALESCE($8, sprint_id),
        due_at = COALESCE($9, due_at),
        version = version + 1,
        updated_at = now()
      WHERE id = $1
        AND deleted_at IS NULL
        AND ($10::bigint IS NULL OR version = $10::bigint)
      RETURNING *
      `,
      [
        taskId,
        input.title?.trim() ?? null,
        input.description?.trim() ?? null,
        input.status ?? null,
        input.priority ?? null,
        input.assigneeId ?? null,
        input.epicId ?? null,
        input.sprintId ?? null,
        input.dueAt ?? null,
        input.expectedVersion ?? null
      ]
    );
    if (!result.rows[0]) throw new PmConflictError("Task version conflict or task not found.");
    const task = mapTask(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId, eventType: "task.updated", payload: input });
    return task;
  }

  async moveTask(user: PmUser, input: MoveTaskInput): Promise<{ task: PmTask; position: PmTaskPosition }> {
    return this.withTransaction(async (client) => {
      const taskResult = await client.query(
        `
        UPDATE pm.tasks
        SET status = COALESCE($2, status), version = version + 1, updated_at = now()
        WHERE id = $1
          AND deleted_at IS NULL
          AND ($3::bigint IS NULL OR version = $3::bigint)
        RETURNING *
        `,
        [input.taskId, input.status ?? null, input.expectedVersion ?? null]
      );
      if (!taskResult.rows[0]) throw new PmConflictError("Task version conflict or task not found.");
      const task = mapTask(taskResult.rows[0]);
      await client.query(
        `
        DELETE FROM pm.task_positions
        WHERE task_id = $1
          AND COALESCE(board_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          AND COALESCE(sprint_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          AND backlog_scope = $4
        `,
        [input.taskId, input.boardId ?? null, input.sprintId ?? null, input.backlogScope ?? "project"]
      );
      const positionResult = await client.query(
        `
        INSERT INTO pm.task_positions (task_id, board_id, column_id, sprint_id, backlog_scope, position)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [input.taskId, input.boardId ?? null, input.columnId ?? null, input.sprintId ?? null, input.backlogScope ?? "project", input.position]
      );
      await this.insertAudit(client, {
        actorType: "user",
        actorId: user.id,
        projectId: task.projectId,
        taskId: task.id,
        eventType: "task.moved",
        payload: { boardId: input.boardId, columnId: input.columnId, sprintId: input.sprintId, position: input.position, status: input.status }
      });
      return { task, position: mapPosition(positionResult.rows[0]) };
    });
  }

  async addDependency(user: PmUser, blockingTaskId: string, blockedTaskId: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO pm.task_dependencies (blocking_task_id, blocked_task_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [blockingTaskId, blockedTaskId, user.id]
    );
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, taskId: blockedTaskId, eventType: "task.dependency_added", payload: { blockingTaskId } });
  }

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertAudit(client: Pick<Pool | PoolClient, "query">, event: PmEventRecord): Promise<void> {
    await client.query(
      `
      INSERT INTO audit.events (actor_type, actor_id, project_id, task_id, event_type, payload)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [event.actorType, event.actorId ?? null, event.projectId ?? null, event.taskId ?? null, event.eventType, JSON.stringify(event.payload ?? {})]
    );
  }

  private async ensureDefaultColumns(client: PoolClient, boardId: string): Promise<void> {
    const count = Number((await client.query("SELECT COUNT(*) AS count FROM pm.board_columns WHERE board_id = $1", [boardId])).rows[0]?.count ?? 0);
    if (count > 0) return;
    const defaults = [
      ["Todo", "todo", 1000],
      ["In Progress", "in_progress", 2000],
      ["Review", "review", 3000],
      ["Done", "done", 4000]
    ] as const;
    for (const [name, statusKey, position] of defaults) {
      await client.query("INSERT INTO pm.board_columns (board_id, name, status_key, position) VALUES ($1, $2, $3, $4)", [boardId, name, statusKey, position]);
    }
  }
}

function normalizeKey(value: string): string {
  const key = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(key)) throw new Error("Project key must be 2-32 characters: A-Z, 0-9, underscore, dash.");
  return key;
}

function mapUser(row: Row): PmUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: row.email ? String(row.email) : undefined,
    displayName: row.display_name ? String(row.display_name) : undefined
  };
}

function mapProject(row: Row): PmProject {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    description: String(row.description ?? ""),
    archivedAt: asIso(row.archived_at),
    deletedAt: asIso(row.deleted_at),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? "",
    version: Number(row.version ?? 1),
    role: row.role ? normalizeRole(row.role) : undefined
  };
}

function mapEpic(row: Row): PmEpic {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    description: String(row.description ?? ""),
    status: String(row.status),
    priority: String(row.priority),
    position: Number(row.position ?? 1000),
    archivedAt: asIso(row.archived_at),
    deletedAt: asIso(row.deleted_at),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? "",
    version: Number(row.version ?? 1)
  };
}

function mapTask(row: Row): PmTask {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    epicId: row.epic_id ? String(row.epic_id) : undefined,
    sprintId: row.sprint_id ? String(row.sprint_id) : undefined,
    parentTaskId: row.parent_task_id ? String(row.parent_task_id) : undefined,
    title: String(row.title),
    description: String(row.description ?? ""),
    status: String(row.status),
    priority: String(row.priority),
    assigneeId: row.assignee_id ? String(row.assignee_id) : undefined,
    creatorId: row.creator_id ? String(row.creator_id) : undefined,
    dueAt: asIso(row.due_at),
    archivedAt: asIso(row.archived_at),
    deletedAt: asIso(row.deleted_at),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? "",
    version: Number(row.version ?? 1)
  };
}

function mapBoard(row: Row): PmBoard {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    epicId: row.epic_id ? String(row.epic_id) : undefined,
    name: String(row.name),
    boardType: row.board_type === "scrum" ? "scrum" : "kanban",
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? "",
    version: Number(row.version ?? 1)
  };
}

function mapColumn(row: Row): PmBoardColumn {
  return {
    id: String(row.id),
    boardId: String(row.board_id),
    name: String(row.name),
    statusKey: String(row.status_key),
    position: Number(row.position ?? 1000),
    wipLimit: row.wip_limit === null || row.wip_limit === undefined ? undefined : Number(row.wip_limit),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? ""
  };
}

function mapBoardTask(row: Row): PmBoardTask {
  return {
    ...mapTask(row),
    columnId: row.column_id ? String(row.column_id) : undefined,
    boardPosition: row.board_position === null || row.board_position === undefined ? undefined : Number(row.board_position)
  };
}

function mapPosition(row: Row): PmTaskPosition {
  return {
    taskId: String(row.task_id),
    boardId: row.board_id ? String(row.board_id) : undefined,
    columnId: row.column_id ? String(row.column_id) : undefined,
    sprintId: row.sprint_id ? String(row.sprint_id) : undefined,
    backlogScope: String(row.backlog_scope ?? "project"),
    position: Number(row.position ?? 1000)
  };
}

function normalizeStatusKey(value: string): string {
  const key = value.trim().toLowerCase().replaceAll(/\s+/g, "_");
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(key)) throw new Error("statusKey must be 2-32 characters: a-z, 0-9, underscore, dash.");
  return key;
}

function asIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
