import { Pool, type PoolClient } from "pg";
import type { AuthenticatedUser } from "../auth/authelia.js";
import { normalizeRole } from "./permissions.js";
import type {
  CreateAttachmentInput,
  CreateBoardInput,
  CreateCommentInput,
  CreateEpicInput,
  CreateLabelInput,
  CreateBoardColumnInput,
  CreateProjectInput,
  CreateSavedFilterInput,
  CreateSprintInput,
  CreateTaskInput,
  MoveTaskInput,
  PmActivityEvent,
  PmAttachment,
  PmBoard,
  PmBoardColumn,
  PmBoardTask,
  PmBootstrapInput,
  PmBootstrapStatus,
  PmComment,
  PmEpic,
  PmEventRecord,
  PmAnnouncement,
  PmHomeWidget,
  PmHomeWidgetKind,
  PmLabel,
  PmNotification,
  PmProject,
  PmRole,
  PmSavedFilter,
  PmSprint,
  PmTask,
  PmTaskDependency,
  PmTaskPosition,
  PmUser,
  PmWidgetTemplate,
  PmWebhookDeliveryRecord,
  PmWebhookDeliverySummary,
  UpdateProjectInput,
  UpdateCommentInput,
  UpdateLabelInput,
  UpdateSavedFilterInput,
  UpdateSprintInput,
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
    const existing = await this.pool.query(
      `
      SELECT id
      FROM core.users
      WHERE lower(username) = lower($1)
         OR ($2::text IS NOT NULL AND lower(email) = lower($2))
         OR external_subject = $3
      LIMIT 1
      `,
      [username, email, externalSubject]
    );
    const result = existing.rows[0]
      ? await this.pool.query(
          `
          UPDATE core.users
          SET username = $2, email = $3, display_name = $4, external_subject = COALESCE(external_subject, $5), updated_at = now()
          WHERE id = $1
          RETURNING id, username, email, display_name, pm_access, global_role, disabled
          `,
          [existing.rows[0].id, username, email, displayName, externalSubject]
        )
      : await this.pool.query(
          `
          INSERT INTO core.users (username, email, display_name, external_subject)
          VALUES ($1, $2, $3, $4)
          RETURNING id, username, email, display_name, pm_access, global_role, disabled
          `,
          [username, email, displayName, externalSubject]
    );
    const row = result.rows[0];
    if (row.disabled) throw new Error("PM access is disabled for this user.");
    if (!row.pm_access && !["admin", "super_admin"].includes(String(row.global_role))) throw new Error("PM access is not granted for this user.");
    return mapUser(result.rows[0]);
  }

  async ensureAutomationUser(name: string): Promise<PmUser> {
    const normalized = name.trim().toLowerCase().replaceAll(/[^a-z0-9_-]/g, "-").replaceAll(/-+/g, "-").replace(/^-|-$/g, "") || "automation";
    const username = `projectego_automation_${normalized}`.slice(0, 64);
    const displayName = `ProjectEGO automation: ${normalized}`;
    const result = await this.pool.query(
      `
      INSERT INTO core.users (username, email, display_name, external_subject)
      VALUES ($1, NULL, $2, $3)
      ON CONFLICT (external_subject)
      DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name, updated_at = now()
      RETURNING id, username, email, display_name, global_role
      `,
      [username, displayName, `automation:${normalized}`]
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

  async getBootstrapStatus(): Promise<PmBootstrapStatus> {
    const result = await this.pool.query(
      `
      SELECT
        (SELECT count(*)::int FROM pm.project_members WHERE role = 'project_owner') AS owner_count,
        (SELECT count(*)::int FROM pm.projects WHERE deleted_at IS NULL) AS project_count,
        (SELECT count(*)::int FROM core.users WHERE disabled = false) AS user_count
      `
    );
    const row = result.rows[0] ?? {};
    const ownerCount = Number(row.owner_count ?? 0);
    return {
      bootstrapped: ownerCount > 0,
      ownerCount,
      projectCount: Number(row.project_count ?? 0),
      userCount: Number(row.user_count ?? 0)
    };
  }

  async bootstrapInitialOwner(user: PmUser, input: PmBootstrapInput): Promise<{ status: PmBootstrapStatus; project: PmProject; user: PmUser; role: PmRole }> {
    return this.withTransaction(async (client) => {
      const status = await this.getBootstrapStatusWithClient(client);
      if (status.bootstrapped) throw new Error("ProjectEGO PM is already bootstrapped.");
      const project = mapProject(
        (
          await client.query(
            `
            INSERT INTO pm.projects (key, name, description, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [normalizeKey(input.projectKey), input.projectName.trim(), input.projectDescription?.trim() ?? "", user.id]
          )
        ).rows[0]
      );
      await client.query(
        "INSERT INTO pm.project_members (project_id, user_id, role) VALUES ($1, $2, 'project_owner')",
        [project.id, user.id]
      );
      await this.insertAudit(client, {
        actorType: "system",
        actorId: user.id,
        projectId: project.id,
        eventType: "pm.bootstrap",
        payload: { username: user.username, projectKey: project.key, source: "api" }
      });
      return { status: await this.getBootstrapStatusWithClient(client), project: { ...project, role: "project_owner" }, user, role: "project_owner" };
    });
  }

  async loadProject(projectId: string): Promise<PmProject> {
    const result = await this.pool.query("SELECT * FROM pm.projects WHERE id = $1 AND deleted_at IS NULL", [projectId]);
    if (!result.rows[0]) throw new Error("Project not found.");
    return mapProject(result.rows[0]);
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

  async listLabels(projectId: string): Promise<PmLabel[]> {
    const result = await this.pool.query("SELECT * FROM pm.labels WHERE project_id = $1 ORDER BY lower(name) ASC", [projectId]);
    return result.rows.map(mapLabel);
  }

  async createLabel(user: PmUser, input: CreateLabelInput): Promise<PmLabel> {
    const result = await this.pool.query(
      `
      INSERT INTO pm.labels (project_id, name, color)
      VALUES ($1, $2, $3)
      ON CONFLICT (project_id, name) DO UPDATE SET color = EXCLUDED.color
      RETURNING *
      `,
      [input.projectId, input.name.trim(), input.color ?? "#6b7280"]
    );
    const label = mapLabel(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: input.projectId, eventType: "label.upserted", payload: { labelId: label.id, name: label.name, color: label.color } });
    return label;
  }

  async loadLabel(labelId: string): Promise<PmLabel> {
    const result = await this.pool.query("SELECT * FROM pm.labels WHERE id = $1", [labelId]);
    if (!result.rows[0]) throw new Error("Label not found.");
    return mapLabel(result.rows[0]);
  }

  async updateLabel(user: PmUser, projectId: string, labelId: string, input: UpdateLabelInput): Promise<PmLabel> {
    const result = await this.pool.query(
      `
      UPDATE pm.labels
      SET name = COALESCE($3, name), color = COALESCE($4, color)
      WHERE id = $1 AND project_id = $2
      RETURNING *
      `,
      [labelId, projectId, input.name?.trim() ?? null, input.color ?? null]
    );
    if (!result.rows[0]) throw new Error("Label not found.");
    const label = mapLabel(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId, eventType: "label.updated", payload: { labelId, name: label.name, color: label.color } });
    return label;
  }

  async deleteLabel(user: PmUser, projectId: string, labelId: string): Promise<void> {
    const result = await this.pool.query("DELETE FROM pm.labels WHERE id = $1 AND project_id = $2", [labelId, projectId]);
    if (!result.rowCount) throw new Error("Label not found.");
    const filters = await this.pool.query(
      `
      UPDATE pm.saved_filters
      SET filter_json = filter_json - 'labelId',
          updated_at = now()
      WHERE project_id = $1
        AND filter_json->>'labelId' = $2
      `,
      [projectId, labelId]
    );
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId, eventType: "label.deleted", payload: { labelId, cleanedSavedFilters: filters.rowCount ?? 0 } });
  }

  async listSavedFilters(projectId: string, userId: string): Promise<PmSavedFilter[]> {
    const result = await this.pool.query(
      "SELECT * FROM pm.saved_filters WHERE project_id = $1 AND user_id = $2 ORDER BY lower(name) ASC",
      [projectId, userId]
    );
    return result.rows.map(mapSavedFilter);
  }

  async createSavedFilter(user: PmUser, input: CreateSavedFilterInput): Promise<PmSavedFilter> {
    const result = await this.pool.query(
      `
      INSERT INTO pm.saved_filters (project_id, user_id, name, filter_json)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING *
      `,
      [input.projectId, input.userId, input.name.trim(), JSON.stringify(input.filter)]
    );
    const filter = mapSavedFilter(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: input.projectId, eventType: "filter.saved", payload: { filterId: filter.id, name: filter.name } });
    return filter;
  }

  async deleteSavedFilter(user: PmUser, projectId: string, filterId: string): Promise<void> {
    const result = await this.pool.query("DELETE FROM pm.saved_filters WHERE id = $1 AND project_id = $2 AND user_id = $3", [filterId, projectId, user.id]);
    if (!result.rowCount) throw new Error("Saved filter not found.");
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId, eventType: "filter.deleted", payload: { filterId } });
  }

  async updateSavedFilter(user: PmUser, projectId: string, filterId: string, input: UpdateSavedFilterInput): Promise<PmSavedFilter> {
    const result = await this.pool.query(
      `
      UPDATE pm.saved_filters
      SET name = COALESCE($4, name),
          filter_json = COALESCE($5::jsonb, filter_json),
          updated_at = now()
      WHERE id = $1 AND project_id = $2 AND user_id = $3
      RETURNING *
      `,
      [filterId, projectId, user.id, input.name?.trim() ?? null, input.filter ? JSON.stringify(input.filter) : null]
    );
    if (!result.rows[0]) throw new Error("Saved filter not found.");
    const filter = mapSavedFilter(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId, eventType: "filter.updated", payload: { filterId, name: filter.name } });
    return filter;
  }

  async listHomeWidgets(userId: string): Promise<PmHomeWidget[]> {
    const result = await this.pool.query("SELECT * FROM pm.home_widgets WHERE user_id = $1 ORDER BY y ASC, x ASC, created_at ASC", [userId]);
    return result.rows.map(mapHomeWidget);
  }

  async createHomeWidget(user: PmUser, input: Partial<PmHomeWidget>): Promise<PmHomeWidget> {
    const kind = normalizeWidgetKind(input.kind);
    const result = await this.pool.query(
      `
      INSERT INTO pm.home_widgets (user_id, template_id, kind, title, x, y, width, height, clickable, config, content)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
      RETURNING *
      `,
      [
        user.id,
        input.templateId ?? null,
        kind,
        normalizeWidgetTitle(input.title, kind),
        clampNumber(input.x, 1, 1000, 1),
        clampNumber(input.y, 1, 1000, 1),
        clampNumber(input.width, 1, 1000, 4),
        clampNumber(input.height, 1, 1000, 3),
        input.clickable ?? true,
        JSON.stringify(input.config ?? {}),
        JSON.stringify(input.content ?? {})
      ]
    );
    return mapHomeWidget(result.rows[0]);
  }

  async updateHomeWidget(user: PmUser, widgetId: string, input: Partial<PmHomeWidget>): Promise<PmHomeWidget> {
    const current = await this.pool.query("SELECT * FROM pm.home_widgets WHERE id = $1 AND user_id = $2", [widgetId, user.id]);
    if (!current.rows[0]) throw new Error("Widget not found.");
    const existing = mapHomeWidget(current.rows[0]);
    const kind = input.kind ? normalizeWidgetKind(input.kind) : existing.kind;
    const result = await this.pool.query(
      `
      UPDATE pm.home_widgets
      SET kind = $3,
          title = $4,
          x = $5,
          y = $6,
          width = $7,
          height = $8,
          clickable = $9,
          config = $10::jsonb,
          content = $11::jsonb,
          updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *
      `,
      [
        widgetId,
        user.id,
        kind,
        input.title === undefined ? existing.title : normalizeWidgetTitle(input.title, kind),
        clampNumber(input.x ?? existing.x, 1, 1000, existing.x),
        clampNumber(input.y ?? existing.y, 1, 1000, existing.y),
        clampNumber(input.width ?? existing.width, 1, 1000, existing.width),
        clampNumber(input.height ?? existing.height, 1, 1000, existing.height),
        input.clickable ?? existing.clickable,
        JSON.stringify(input.config ?? existing.config),
        JSON.stringify(input.content ?? existing.content)
      ]
    );
    return mapHomeWidget(result.rows[0]);
  }

  async deleteHomeWidget(user: PmUser, widgetId: string): Promise<void> {
    const result = await this.pool.query("DELETE FROM pm.home_widgets WHERE id = $1 AND user_id = $2", [widgetId, user.id]);
    if (!result.rowCount) throw new Error("Widget not found.");
  }

  async listWidgetTemplates(userId: string): Promise<PmWidgetTemplate[]> {
    const result = await this.pool.query(
      "SELECT * FROM pm.widget_templates WHERE visibility = 'public' OR owner_id = $1 ORDER BY visibility ASC, lower(name) ASC",
      [userId]
    );
    return result.rows.map(mapWidgetTemplate);
  }

  async createWidgetTemplate(user: PmUser, input: Partial<PmWidgetTemplate>): Promise<PmWidgetTemplate> {
    const kind = normalizeWidgetKind(input.kind);
    const visibility = input.visibility === "public" ? "public" : "private";
    const result = await this.pool.query(
      `
      INSERT INTO pm.widget_templates (owner_id, kind, name, visibility, config, content)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      RETURNING *
      `,
      [user.id, kind, String(input.name || normalizeWidgetTitle(undefined, kind)).slice(0, 120), visibility, JSON.stringify(input.config ?? {}), JSON.stringify(input.content ?? {})]
    );
    return mapWidgetTemplate(result.rows[0]);
  }

  async listHomeWidgetData(user: PmUser): Promise<Record<string, unknown>> {
    const [activity, changes, announcements] = await Promise.all([
      this.pool.query(
        `
        SELECT t.id, t.project_id, t.title, t.status, t.priority, t.created_at, p.name AS project_name
        FROM pm.tasks t
        JOIN pm.projects p ON p.id = t.project_id
        LEFT JOIN pm.project_members m ON m.project_id = t.project_id AND m.user_id = $1
        WHERE t.deleted_at IS NULL
          AND (t.creator_id = $1 OR t.assignee_id = $1 OR m.user_id = $1)
        ORDER BY t.created_at DESC
        LIMIT 20
        `,
        [user.id]
      ),
      this.pool.query(
        `
        SELECT DISTINCT ON (t.id) t.id, t.project_id, t.title, t.status, t.priority, t.updated_at, p.name AS project_name
        FROM pm.tasks t
        JOIN pm.projects p ON p.id = t.project_id
        LEFT JOIN pm.comments c ON c.task_id = t.id AND c.author_id = $1
        LEFT JOIN audit.events e ON e.task_id = t.id
        WHERE t.deleted_at IS NULL
          AND (t.creator_id = $1 OR t.assignee_id = $1 OR c.author_id = $1 OR e.actor_id = $1::text)
        ORDER BY t.id, t.updated_at DESC
        LIMIT 20
        `,
        [user.id]
      ),
      this.pool.query("SELECT * FROM pm.announcements ORDER BY created_at DESC LIMIT 5")
    ]);
    return {
      activity: activity.rows.map((row) => ({ id: String(row.id), projectId: String(row.project_id), title: String(row.title), status: String(row.status), priority: String(row.priority), projectName: String(row.project_name ?? ""), createdAt: asIso(row.created_at) })),
      changes: changes.rows.map((row) => ({ id: String(row.id), projectId: String(row.project_id), title: String(row.title), status: String(row.status), priority: String(row.priority), projectName: String(row.project_name ?? ""), updatedAt: asIso(row.updated_at) })),
      announcements: announcements.rows.map(mapAnnouncement)
    };
  }

  async createAnnouncement(user: PmUser, input: { title: string; body: string }): Promise<PmAnnouncement> {
    if (!["admin", "super_admin"].includes(user.globalRole ?? "user")) throw new Error("Admin role is required to publish announcements.");
    const result = await this.pool.query(
      "INSERT INTO pm.announcements (author_id, title, body) VALUES ($1, $2, $3) RETURNING *",
      [user.id, input.title.trim().slice(0, 120) || "Announcement", input.body.trim()]
    );
    return mapAnnouncement(result.rows[0]);
  }

  async findUserByIdentifier(identifier: string): Promise<PmUser> {
    const value = identifier.trim();
    const result = await this.pool.query(
      `
      SELECT id, username, email, display_name, global_role
      FROM core.users
      WHERE disabled = false
        AND (lower(username) = lower($1) OR lower(email) = lower($1) OR id::text = $1)
      LIMIT 1
      `,
      [value]
    );
    if (!result.rows[0]) throw new Error("User not found. The user must sign in to PM at least once before being added to a project.");
    return mapUser(result.rows[0]);
  }

  async setMemberRole(actor: PmUser, projectId: string, userId: string, role: PmRole): Promise<PmUser & { role: PmRole }> {
    const existingRole = await this.getProjectRole(userId, projectId);
    if (existingRole === "project_owner" && role !== "project_owner") {
      const ownerCount = await this.countProjectOwners(projectId);
      if (ownerCount <= 1) throw new Error("Project must keep at least one project_owner.");
    }
    await this.pool.query(
      `
      INSERT INTO pm.project_members (project_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
      `,
      [projectId, userId, role]
    );
    await this.insertAudit(this.pool, { actorType: "user", actorId: actor.id, projectId, eventType: "member.role_set", payload: { userId, role } });
    const members = await this.listMembers(projectId);
    const member = members.find((item) => item.id === userId);
    if (!member) throw new Error("Project member not found after role update.");
    return member;
  }

  async removeMember(actor: PmUser, projectId: string, userId: string): Promise<void> {
    const existingRole = await this.getProjectRole(userId, projectId);
    if (!existingRole) throw new Error("Project member not found.");
    if (existingRole === "project_owner") {
      const ownerCount = await this.countProjectOwners(projectId);
      if (ownerCount <= 1) throw new Error("Project must keep at least one project_owner.");
    }
    await this.pool.query("DELETE FROM pm.project_members WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
    await this.pool.query("UPDATE pm.tasks SET assignee_id = NULL, updated_at = now(), version = version + 1 WHERE project_id = $1 AND assignee_id = $2", [projectId, userId]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: actor.id, projectId, eventType: "member.removed", payload: { userId } });
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

  async listSprints(projectId: string, filters: { epicId?: string; includeCompleted?: boolean } = {}): Promise<PmSprint[]> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM pm.sprints
      WHERE project_id = $1
        AND ($2::uuid IS NULL OR epic_id = $2::uuid)
        AND ($3::boolean OR status IN ('planned', 'active'))
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
        COALESCE(starts_at, created_at) DESC
      `,
      [projectId, filters.epicId ?? null, Boolean(filters.includeCompleted)]
    );
    return result.rows.map(mapSprint);
  }

  async loadSprint(sprintId: string): Promise<PmSprint> {
    const result = await this.pool.query("SELECT * FROM pm.sprints WHERE id = $1", [sprintId]);
    if (!result.rows[0]) throw new Error("Sprint not found.");
    return mapSprint(result.rows[0]);
  }

  async createSprint(user: PmUser, input: CreateSprintInput): Promise<PmSprint> {
    const result = await this.pool.query(
      `
      INSERT INTO pm.sprints (project_id, epic_id, name, status, starts_at, ends_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [input.projectId, input.epicId ?? null, input.name.trim(), input.status ?? "planned", input.startsAt ?? null, input.endsAt ?? null]
    );
    const sprint = mapSprint(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: input.projectId, eventType: "sprint.created", payload: { sprintId: sprint.id, name: sprint.name } });
    return sprint;
  }

  async updateSprint(user: PmUser, sprintId: string, input: UpdateSprintInput): Promise<PmSprint> {
    const result = await this.pool.query(
      `
      UPDATE pm.sprints
      SET
        name = COALESCE($2, name),
        status = COALESCE($3, status),
        epic_id = COALESCE($4, epic_id),
        starts_at = COALESCE($5, starts_at),
        ends_at = COALESCE($6, ends_at),
        version = version + 1,
        updated_at = now()
      WHERE id = $1
        AND ($7::bigint IS NULL OR version = $7::bigint)
      RETURNING *
      `,
      [sprintId, input.name?.trim() ?? null, input.status ?? null, input.epicId ?? null, input.startsAt ?? null, input.endsAt ?? null, input.expectedVersion ?? null]
    );
    if (!result.rows[0]) throw new PmConflictError("Sprint version conflict or sprint not found.");
    const sprint = mapSprint(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: sprint.projectId, eventType: "sprint.updated", payload: { sprintId, ...input } });
    return sprint;
  }

  async assignTaskToSprint(user: PmUser, taskId: string, sprintId?: string): Promise<PmTask> {
    const existing = await this.loadTask(taskId);
    let sprint: PmSprint | undefined;
    if (sprintId) {
      sprint = await this.loadSprint(sprintId);
      if (sprint.projectId !== existing.projectId) throw new Error("Sprint does not belong to task project.");
    }
    const result = await this.pool.query(
      `
      UPDATE pm.tasks
      SET sprint_id = $2, version = version + 1, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [taskId, sprintId ?? null]
    );
    if (!result.rows[0]) throw new Error("Task not found.");
    const task = mapTask(result.rows[0]);
    await this.insertAudit(this.pool, {
      actorType: "user",
      actorId: user.id,
      projectId: task.projectId,
      taskId,
      eventType: sprintId ? "task.sprint_assigned" : "task.backlog_assigned",
      payload: { sprintId: sprint?.id, sprintName: sprint?.name }
    });
    return task;
  }

  async assignTask(user: PmUser, taskId: string, assigneeId?: string): Promise<PmTask> {
    const existing = await this.loadTask(taskId);
    if (assigneeId) {
      const role = await this.getProjectRole(assigneeId, existing.projectId);
      if (!role) throw new Error("Assignee must be a project member.");
    }
    const result = await this.pool.query(
      `
      UPDATE pm.tasks
      SET assignee_id = $2, version = version + 1, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [taskId, assigneeId ?? null]
    );
    if (!result.rows[0]) throw new Error("Task not found.");
    const task = mapTask(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId, eventType: "task.assigned", payload: { assigneeId } });
    return task;
  }

  async listBoards(projectId: string, epicId?: string): Promise<PmBoard[]> {
    const result = await this.pool.query(
      `
      SELECT b.*,
             b.id = FIRST_VALUE(b.id) OVER (
               PARTITION BY b.project_id, b.epic_id, b.board_type
               ORDER BY b.created_at ASC
             ) AS is_default
      FROM pm.boards b
      WHERE b.project_id = $1
        AND ($2::uuid IS NULL OR b.epic_id = $2::uuid)
      ORDER BY b.board_type ASC, b.created_at ASC
      `,
      [projectId, epicId ?? null]
    );
    return result.rows.map(mapBoard);
  }

  async loadBoard(boardId: string): Promise<PmBoard> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM (
        SELECT b.*,
               b.id = FIRST_VALUE(b.id) OVER (
                 PARTITION BY b.project_id, b.epic_id, b.board_type
                 ORDER BY b.created_at ASC
               ) AS is_default
        FROM pm.boards b
      ) ranked
      WHERE id = $1
      `,
      [boardId]
    );
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

  async createKanbanBoard(user: PmUser, input: CreateBoardInput): Promise<{ board: PmBoard; columns: PmBoardColumn[] }> {
    return this.withTransaction(async (client) => {
      const board = mapBoard(
        (
          await client.query(
            `
            INSERT INTO pm.boards (project_id, epic_id, name, board_type)
            VALUES ($1, $2, $3, 'kanban')
            RETURNING *
            `,
            [input.projectId, input.epicId ?? null, input.name.trim()]
          )
        ).rows[0]
      );
      await this.ensureDefaultColumns(client, board.id);
      const columns = (await client.query("SELECT * FROM pm.board_columns WHERE board_id = $1 ORDER BY position ASC", [board.id])).rows.map(mapColumn);
      await this.insertAudit(client, { actorType: "user", actorId: user.id, projectId: input.projectId, eventType: "board.created", payload: { boardId: board.id, type: "kanban", name: board.name } });
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
    const includeUnpositioned = Boolean(board.isDefault);
    const taskResult = await this.pool.query(
      `
      SELECT t.*, tp.column_id, tp.position AS board_position, COALESCE(array_agg(tl.label_id) FILTER (WHERE tl.label_id IS NOT NULL), ARRAY[]::uuid[]) AS label_ids
      FROM pm.tasks t
      LEFT JOIN pm.task_positions tp ON tp.task_id = t.id AND tp.board_id = $1
      LEFT JOIN pm.task_labels tl ON tl.task_id = t.id
      WHERE t.project_id = $2
        AND t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND ($3::uuid IS NULL OR t.epic_id = $3::uuid)
        AND ($4::boolean OR tp.board_id IS NOT NULL)
      GROUP BY t.id, tp.column_id, tp.position
      ORDER BY COALESCE(tp.position, 1000000000), t.updated_at DESC
      `,
      [board.id, board.projectId, board.epicId ?? null, includeUnpositioned]
    );
    return { board, columns, tasks: taskResult.rows.map(mapBoardTask) };
  }

  async listTasks(projectId: string, filters: { epicId?: string; sprintId?: string; includeArchived?: boolean; search?: string } = {}): Promise<PmTask[]> {
    const search = normalizeSearch(filters.search);
    const result = await this.pool.query(
      `
      SELECT t.*, COALESCE(array_agg(tl.label_id) FILTER (WHERE tl.label_id IS NOT NULL), ARRAY[]::uuid[]) AS label_ids
      FROM pm.tasks t
      LEFT JOIN pm.task_labels tl ON tl.task_id = t.id
      WHERE t.project_id = $1
        AND t.deleted_at IS NULL
        AND ($2::uuid IS NULL OR t.epic_id = $2::uuid)
        AND ($3::uuid IS NULL OR t.sprint_id = $3::uuid)
        AND ($4::boolean OR t.archived_at IS NULL)
        AND (
          $5::text IS NULL
          OR t.id::text ILIKE '%' || $5::text || '%'
          OR t.title ILIKE '%' || $5::text || '%'
          OR t.description ILIKE '%' || $5::text || '%'
          OR t.search_document @@ plainto_tsquery('simple', $5::text)
        )
      GROUP BY t.id
      ORDER BY t.updated_at DESC
      `,
      [projectId, filters.epicId ?? null, filters.sprintId ?? null, Boolean(filters.includeArchived), search]
    );
    return result.rows.map(mapTask);
  }

  async getNextAvailableTask(projectId: string, assigneeId?: string): Promise<PmTask | undefined> {
    const result = await this.pool.query(
      `
      SELECT t.*, array_remove(array_agg(tl.label_id), NULL) AS label_ids
      FROM pm.tasks t
      LEFT JOIN pm.task_labels tl ON tl.task_id = t.id
      WHERE t.project_id = $1
        AND t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND t.status NOT IN ('done', 'closed', 'cancelled')
        AND ($2::uuid IS NULL OR t.assignee_id = $2::uuid)
        AND NOT EXISTS (
          SELECT 1
          FROM pm.task_dependencies d
          JOIN pm.tasks blocking ON blocking.id = d.blocking_task_id
          WHERE d.blocked_task_id = t.id
            AND blocking.deleted_at IS NULL
            AND blocking.archived_at IS NULL
            AND blocking.status NOT IN ('done', 'closed', 'cancelled')
        )
      GROUP BY t.id
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        COALESCE(t.due_at, t.created_at) ASC
      LIMIT 1
      `,
      [projectId, assigneeId ?? null]
    );
    return result.rows[0] ? mapTask(result.rows[0]) : undefined;
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
        due_at = CASE WHEN $9::boolean THEN $10::timestamptz ELSE due_at END,
        version = version + 1,
        updated_at = now()
      WHERE id = $1
        AND deleted_at IS NULL
        AND ($11::bigint IS NULL OR version = $11::bigint)
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
        Object.prototype.hasOwnProperty.call(input, "dueAt"),
        input.dueAt ?? null,
        input.expectedVersion ?? null
      ]
    );
    if (!result.rows[0]) throw new PmConflictError("Task version conflict or task not found.");
    const task = mapTask(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId, eventType: "task.updated", payload: input });
    return task;
  }

  async archiveTask(user: PmUser, taskId: string, archived: boolean): Promise<PmTask> {
    const result = await this.pool.query(
      `
      UPDATE pm.tasks
      SET archived_at = CASE WHEN $2::boolean THEN now() ELSE NULL END,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [taskId, archived]
    );
    if (!result.rows[0]) throw new Error("Task not found.");
    const task = mapTask(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId, eventType: archived ? "task.archived" : "task.unarchived" });
    return task;
  }

  async softDeleteTask(user: PmUser, taskId: string): Promise<PmTask> {
    const result = await this.pool.query(
      `
      UPDATE pm.tasks
      SET deleted_at = now(),
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [taskId]
    );
    if (!result.rows[0]) throw new Error("Task not found.");
    const task = mapTask(result.rows[0]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId, eventType: "task.deleted" });
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

  async listDependencies(taskId: string): Promise<{ blockingTasks: PmTaskDependency[]; blockedTasks: PmTaskDependency[] }> {
    const blocking = await this.pool.query(
      `
      SELECT d.blocking_task_id, d.blocked_task_id, d.created_by, d.created_at AS dependency_created_at, t.*
      FROM pm.task_dependencies d
      JOIN pm.tasks t ON t.id = d.blocking_task_id
      WHERE d.blocked_task_id = $1
        AND t.deleted_at IS NULL
      ORDER BY d.created_at DESC
      `,
      [taskId]
    );
    const blocked = await this.pool.query(
      `
      SELECT d.blocking_task_id, d.blocked_task_id, d.created_by, d.created_at AS dependency_created_at, t.*
      FROM pm.task_dependencies d
      JOIN pm.tasks t ON t.id = d.blocked_task_id
      WHERE d.blocking_task_id = $1
        AND t.deleted_at IS NULL
      ORDER BY d.created_at DESC
      `,
      [taskId]
    );
    return {
      blockingTasks: blocking.rows.map((row) => mapTaskDependency(row)),
      blockedTasks: blocked.rows.map((row) => mapTaskDependency(row))
    };
  }

  async addDependency(user: PmUser, blockingTaskId: string, blockedTaskId: string): Promise<void> {
    const [blockingTask, blockedTask] = await Promise.all([this.loadTask(blockingTaskId), this.loadTask(blockedTaskId)]);
    if (blockingTask.projectId !== blockedTask.projectId) throw new Error("Dependency task must belong to the same project.");
    await this.pool.query(
      "INSERT INTO pm.task_dependencies (blocking_task_id, blocked_task_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [blockingTaskId, blockedTaskId, user.id]
    );
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: blockedTask.projectId, taskId: blockedTaskId, eventType: "task.dependency_added", payload: { blockingTaskId } });
  }

  async removeDependency(user: PmUser, blockingTaskId: string, blockedTaskId: string): Promise<void> {
    const blockedTask = await this.loadTask(blockedTaskId);
    const result = await this.pool.query("DELETE FROM pm.task_dependencies WHERE blocking_task_id = $1 AND blocked_task_id = $2", [blockingTaskId, blockedTaskId]);
    if (!result.rowCount) throw new Error("Task dependency not found.");
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: blockedTask.projectId, taskId: blockedTaskId, eventType: "task.dependency_removed", payload: { blockingTaskId } });
  }

  async listTaskLabels(taskId: string): Promise<PmLabel[]> {
    const result = await this.pool.query(
      `
      SELECT l.*
      FROM pm.task_labels tl
      JOIN pm.labels l ON l.id = tl.label_id
      WHERE tl.task_id = $1
      ORDER BY lower(l.name) ASC
      `,
      [taskId]
    );
    return result.rows.map(mapLabel);
  }

  async addTaskLabel(user: PmUser, taskId: string, labelId: string): Promise<PmLabel> {
    const [task, label] = await Promise.all([this.loadTask(taskId), this.loadLabel(labelId)]);
    if (label.projectId !== task.projectId) throw new Error("Label must belong to the task project.");
    await this.pool.query("INSERT INTO pm.task_labels (task_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [taskId, labelId]);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId, eventType: "task.label_added", payload: { labelId, name: label.name } });
    return label;
  }

  async removeTaskLabel(user: PmUser, taskId: string, labelId: string): Promise<void> {
    const task = await this.loadTask(taskId);
    const result = await this.pool.query("DELETE FROM pm.task_labels WHERE task_id = $1 AND label_id = $2", [taskId, labelId]);
    if (!result.rowCount) throw new Error("Task label not found.");
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId, eventType: "task.label_removed", payload: { labelId } });
  }

  async listComments(taskId: string): Promise<PmComment[]> {
    const result = await this.pool.query(
      `
      SELECT c.*, COALESCE(u.display_name, u.username) AS author_name
      FROM pm.comments c
      LEFT JOIN core.users u ON u.id = c.author_id
      WHERE c.task_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC
      `,
      [taskId]
    );
    return result.rows.map(mapComment);
  }

  async loadComment(commentId: string): Promise<PmComment> {
    const result = await this.pool.query(
      `
      SELECT c.*, COALESCE(u.display_name, u.username) AS author_name
      FROM pm.comments c
      LEFT JOIN core.users u ON u.id = c.author_id
      WHERE c.id = $1 AND c.deleted_at IS NULL
      `,
      [commentId]
    );
    if (!result.rows[0]) throw new Error("Comment not found.");
    return mapComment(result.rows[0]);
  }

  async createComment(user: PmUser, input: CreateCommentInput): Promise<PmComment> {
    const task = await this.loadTask(input.taskId);
    const comment = await this.withTransaction(async (client) => {
      const result = await client.query(
        `
        INSERT INTO pm.comments (task_id, author_id, body)
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [input.taskId, user.id, input.body.trim()]
      );
      await this.insertAudit(client, {
        actorType: "user",
        actorId: user.id,
        projectId: task.projectId,
        taskId: input.taskId,
        eventType: "comment.created",
        payload: { commentId: result.rows[0].id }
      });
      return mapComment({ ...result.rows[0], author_name: user.displayName ?? user.username });
    });
    return comment;
  }

  async createCommentNotifications(actor: PmUser, task: PmTask, comment: PmComment): Promise<PmNotification[]> {
    const mentions = extractMentions(comment.body);
    const memberResult = await this.pool.query(
      `
      SELECT u.id, u.username, u.email, u.display_name
      FROM pm.project_members m
      JOIN core.users u ON u.id = m.user_id
      WHERE m.project_id = $1
        AND u.disabled = false
      `,
      [task.projectId]
    );
    const members = memberResult.rows.map(mapUser);
    const mentionedUsers = mentions.size > 0 ? members.filter((member) => mentions.has(member.username.toLowerCase())) : [];
    const directUsers = members.filter((member) => member.id === task.assigneeId || member.id === task.creatorId);
    const recipients = uniqueUsers([...mentionedUsers, ...directUsers]).filter((member) => member.id !== actor.id);
    if (recipients.length === 0) return [];

    const notifications: PmNotification[] = [];
    for (const recipient of recipients) {
      const isMention = mentionedUsers.some((member) => member.id === recipient.id);
      const notification = await this.createNotification({
        userId: recipient.id,
        actorId: actor.id,
        projectId: task.projectId,
        taskId: task.id,
        eventType: isMention ? "comment.mention" : "comment.created",
        title: isMention ? `Mention in ${task.title}` : `New comment on ${task.title}`,
        body: comment.body.slice(0, 500),
        payload: { commentId: comment.id, taskTitle: task.title }
      });
      notifications.push(notification);
    }
    return notifications;
  }

  async updateComment(user: PmUser, commentId: string, input: UpdateCommentInput): Promise<PmComment> {
    const result = await this.pool.query(
      `
      UPDATE pm.comments
      SET body = $2, updated_at = now(), version = version + 1
      WHERE id = $1 AND author_id = $3 AND deleted_at IS NULL
      RETURNING *
      `,
      [commentId, input.body.trim(), user.id]
    );
    if (!result.rows[0]) throw new Error("Comment not found or not owned by current user.");
    const comment = mapComment({ ...result.rows[0], author_name: user.displayName ?? user.username });
    const task = await this.loadTask(comment.taskId);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId: comment.taskId, eventType: "comment.updated", payload: { commentId } });
    return comment;
  }

  async softDeleteComment(user: PmUser, commentId: string): Promise<PmComment> {
    const result = await this.pool.query(
      `
      UPDATE pm.comments
      SET deleted_at = now(), updated_at = now(), version = version + 1
      WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL
      RETURNING *
      `,
      [commentId, user.id]
    );
    if (!result.rows[0]) throw new Error("Comment not found or not owned by current user.");
    const comment = mapComment({ ...result.rows[0], author_name: user.displayName ?? user.username });
    const task = await this.loadTask(comment.taskId);
    await this.insertAudit(this.pool, { actorType: "user", actorId: user.id, projectId: task.projectId, taskId: comment.taskId, eventType: "comment.deleted", payload: { commentId } });
    return comment;
  }

  async listTaskAttachments(taskId: string): Promise<PmAttachment[]> {
    const result = await this.pool.query(
      `
      SELECT a.*, COALESCE(u.display_name, u.username) AS uploader_name
      FROM pm.attachments a
      LEFT JOIN core.users u ON u.id = a.uploaded_by
      WHERE a.task_id = $1 AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC
      `,
      [taskId]
    );
    return result.rows.map(mapAttachment);
  }

  async createAttachment(user: PmUser, input: CreateAttachmentInput): Promise<PmAttachment> {
    const task = await this.loadTask(input.taskId);
    const attachment = await this.withTransaction(async (client) => {
      const result = await client.query(
        `
        INSERT INTO pm.attachments (task_id, uploaded_by, original_file_name, stored_file_name, mime_type, size_bytes, storage_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [input.taskId, user.id, input.originalFileName, input.storedFileName, input.mimeType ?? null, input.sizeBytes, input.storagePath]
      );
      await this.insertAudit(client, {
        actorType: "user",
        actorId: user.id,
        projectId: task.projectId,
        taskId: input.taskId,
        eventType: "attachment.created",
        payload: { attachmentId: result.rows[0].id, fileName: input.originalFileName, sizeBytes: input.sizeBytes }
      });
      return mapAttachment({ ...result.rows[0], uploader_name: user.displayName ?? user.username });
    });
    return attachment;
  }

  async loadAttachment(attachmentId: string): Promise<PmAttachment> {
    const result = await this.pool.query(
      `
      SELECT a.*, COALESCE(u.display_name, u.username) AS uploader_name
      FROM pm.attachments a
      LEFT JOIN core.users u ON u.id = a.uploaded_by
      WHERE a.id = $1 AND a.deleted_at IS NULL
      `,
      [attachmentId]
    );
    if (!result.rows[0]) throw new Error("Attachment not found.");
    return mapAttachment(result.rows[0]);
  }

  async softDeleteAttachment(user: PmUser, attachmentId: string): Promise<PmAttachment> {
    const existing = await this.loadAttachment(attachmentId);
    const task = await this.loadTask(existing.taskId);
    const result = await this.pool.query(
      "UPDATE pm.attachments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *",
      [attachmentId]
    );
    if (!result.rows[0]) throw new Error("Attachment not found.");
    await this.insertAudit(this.pool, {
      actorType: "user",
      actorId: user.id,
      projectId: task.projectId,
      taskId: existing.taskId,
      eventType: "attachment.deleted",
      payload: { attachmentId, fileName: existing.originalFileName }
    });
    return mapAttachment({ ...result.rows[0], uploader_name: user.displayName ?? user.username });
  }

  async listTaskActivity(taskId: string): Promise<PmActivityEvent[]> {
    const result = await this.pool.query(
      `
      SELECT e.*, COALESCE(u.display_name, u.username) AS actor_name
      FROM audit.events e
      LEFT JOIN core.users u ON u.id::text = e.actor_id
      WHERE e.task_id = $1
      ORDER BY e.created_at DESC
      LIMIT 100
      `,
      [taskId]
    );
    return result.rows.map(mapActivity);
  }

  async listNotifications(userId: string, includeRead = false): Promise<PmNotification[]> {
    const result = await this.pool.query(
      `
      SELECT n.*, COALESCE(u.display_name, u.username) AS actor_name
      FROM pm.notifications n
      LEFT JOIN core.users u ON u.id = n.actor_id
      WHERE n.user_id = $1
        AND ($2::boolean OR n.read_at IS NULL)
      ORDER BY n.created_at DESC
      LIMIT 100
      `,
      [userId, includeRead]
    );
    return result.rows.map(mapNotification);
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<PmNotification> {
    const result = await this.pool.query(
      `
      UPDATE pm.notifications
      SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND user_id = $2
      RETURNING *
      `,
      [notificationId, userId]
    );
    if (!result.rows[0]) throw new Error("Notification not found.");
    return mapNotification(result.rows[0]);
  }

  async markAllNotificationsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.pool.query("UPDATE pm.notifications SET read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND read_at IS NULL", [userId]);
    return { updated: result.rowCount ?? 0 };
  }

  async createWebhookDelivery(input: {
    deliveryId: string;
    url: string;
    eventType: string;
    event: Record<string, unknown>;
    payload: Record<string, unknown>;
  }): Promise<PmWebhookDeliveryRecord> {
    const result = await this.pool.query(
      `
      INSERT INTO pm.webhook_deliveries (delivery_id, url, event_type, event_json, payload_json, next_attempt_at)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, now())
      RETURNING *
      `,
      [input.deliveryId, input.url, input.eventType, JSON.stringify(input.event), JSON.stringify(input.payload)]
    );
    return mapWebhookDelivery(result.rows[0]);
  }

  async markWebhookDeliveryAttempt(
    id: string,
    input: { delivered: boolean; attempts: number; maxAttempts: number; responseStatus?: number; error?: string; nextAttemptAt?: Date }
  ): Promise<PmWebhookDeliveryRecord> {
    const status = input.delivered ? "delivered" : input.attempts >= input.maxAttempts ? "dead" : "retrying";
    const result = await this.pool.query(
      `
      UPDATE pm.webhook_deliveries
      SET status = $2,
          attempts = $3,
          response_status = $4,
          error = $5,
          next_attempt_at = $6,
          delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END,
          updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [id, status, input.attempts, input.responseStatus ?? null, input.error?.slice(0, 1000) ?? null, input.delivered || status === "dead" ? null : input.nextAttemptAt ?? new Date()]
    );
    if (!result.rows[0]) throw new Error("Webhook delivery not found.");
    return mapWebhookDelivery(result.rows[0]);
  }

  async listDueWebhookDeliveries(limit = 25): Promise<PmWebhookDeliveryRecord[]> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM pm.webhook_deliveries
      WHERE status IN ('pending', 'retrying')
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY created_at ASC
      LIMIT $1
      `,
      [limit]
    );
    return result.rows.map(mapWebhookDelivery);
  }

  async listWebhookDeliveries(filters: { status?: PmWebhookDeliveryRecord["status"]; limit?: number } = {}): Promise<PmWebhookDeliveryRecord[]> {
    const limit = clampLimit(filters.limit, 100);
    const result = await this.pool.query(
      `
      SELECT *
      FROM pm.webhook_deliveries
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [filters.status ?? null, limit]
    );
    return result.rows.map(mapWebhookDelivery);
  }

  async summarizeWebhookDeliveries(): Promise<PmWebhookDeliverySummary> {
    const result = await this.pool.query("SELECT status, count(*)::int AS count FROM pm.webhook_deliveries GROUP BY status");
    const summary: PmWebhookDeliverySummary = { pending: 0, retrying: 0, delivered: 0, dead: 0 };
    for (const row of result.rows) {
      const status = String(row.status);
      if (status in summary) summary[status as keyof PmWebhookDeliverySummary] = Number(row.count ?? 0);
    }
    return summary;
  }

  async getWebhookDelivery(id: string): Promise<PmWebhookDeliveryRecord> {
    const result = await this.pool.query("SELECT * FROM pm.webhook_deliveries WHERE id = $1", [id]);
    if (!result.rows[0]) throw new Error("Webhook delivery not found.");
    return mapWebhookDelivery(result.rows[0]);
  }

  async listSchemaMigrations(): Promise<string[]> {
    const exists = await this.pool.query("SELECT to_regclass('pm.schema_migrations') AS table_name");
    if (!exists.rows[0]?.table_name) return [];
    const result = await this.pool.query("SELECT name FROM pm.schema_migrations ORDER BY applied_at ASC, name ASC");
    return result.rows.map((row) => String(row.name));
  }

  private async createNotification(input: {
    userId: string;
    actorId?: string;
    projectId?: string;
    taskId?: string;
    eventType: string;
    title: string;
    body?: string;
    payload?: Record<string, unknown>;
  }): Promise<PmNotification> {
    const result = await this.pool.query(
      `
      INSERT INTO pm.notifications (user_id, project_id, task_id, actor_id, event_type, title, body, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [input.userId, input.projectId ?? null, input.taskId ?? null, input.actorId ?? null, input.eventType, input.title, input.body ?? "", JSON.stringify(input.payload ?? {})]
    );
    return mapNotification(result.rows[0]);
  }

  private async countProjectOwners(projectId: string): Promise<number> {
    const result = await this.pool.query("SELECT COUNT(*) AS count FROM pm.project_members WHERE project_id = $1 AND role = 'project_owner'", [projectId]);
    return Number(result.rows[0]?.count ?? 0);
  }

  private async getBootstrapStatusWithClient(client: PoolClient): Promise<PmBootstrapStatus> {
    const result = await client.query(
      `
      SELECT
        (SELECT count(*)::int FROM pm.project_members WHERE role = 'project_owner') AS owner_count,
        (SELECT count(*)::int FROM pm.projects WHERE deleted_at IS NULL) AS project_count,
        (SELECT count(*)::int FROM core.users WHERE disabled = false) AS user_count
      `
    );
    const row = result.rows[0] ?? {};
    const ownerCount = Number(row.owner_count ?? 0);
    return {
      bootstrapped: ownerCount > 0,
      ownerCount,
      projectCount: Number(row.project_count ?? 0),
      userCount: Number(row.user_count ?? 0)
    };
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

function normalizeSearch(value: string | undefined): string | null {
  const search = value?.trim().replaceAll(/\s+/g, " ").slice(0, 120);
  return search || null;
}

function normalizeWidgetKind(value: unknown): PmHomeWidgetKind {
  const kind = String(value || "notes");
  return ["activity", "changes", "announcement", "notes", "timer", "api"].includes(kind) ? (kind as PmHomeWidgetKind) : "notes";
}

function normalizeWidgetTitle(value: unknown, kind: PmHomeWidgetKind): string {
  const fallback: Record<PmHomeWidgetKind, string> = {
    activity: "New activity",
    changes: "New changes",
    announcement: "Announcements",
    notes: "Notes",
    timer: "Timer",
    api: "API widget"
  };
  return String(value || fallback[kind]).trim().slice(0, 120) || fallback[kind];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function mapUser(row: Row): PmUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: row.email ? String(row.email) : undefined,
    displayName: row.display_name ? String(row.display_name) : undefined,
    globalRole: ["super_admin", "admin", "user"].includes(String(row.global_role)) ? (String(row.global_role) as PmUser["globalRole"]) : "user"
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
    createdAt: asIso(row.dependency_created_at) ?? asIso(row.created_at) ?? "",
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

function mapSprint(row: Row): PmSprint {
  const status = String(row.status);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    epicId: row.epic_id ? String(row.epic_id) : undefined,
    name: String(row.name),
    status: ["planned", "active", "completed", "cancelled"].includes(status) ? (status as PmSprint["status"]) : "planned",
    startsAt: asIso(row.starts_at),
    endsAt: asIso(row.ends_at),
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
    version: Number(row.version ?? 1),
    labelIds: arrayOfStrings(row.label_ids)
  };
}

function mapTaskDependency(row: Row): PmTaskDependency {
  return {
    blockingTaskId: String(row.blocking_task_id),
    blockedTaskId: String(row.blocked_task_id),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: asIso(row.created_at) ?? "",
    task: mapTask(row)
  };
}

function mapComment(row: Row): PmComment {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    authorId: row.author_id ? String(row.author_id) : undefined,
    authorName: row.author_name ? String(row.author_name) : undefined,
    body: String(row.body ?? ""),
    deletedAt: asIso(row.deleted_at),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? "",
    version: Number(row.version ?? 1)
  };
}

function mapAttachment(row: Row): PmAttachment {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    uploadedBy: row.uploaded_by ? String(row.uploaded_by) : undefined,
    uploaderName: row.uploader_name ? String(row.uploader_name) : undefined,
    originalFileName: String(row.original_file_name),
    storedFileName: String(row.stored_file_name),
    mimeType: row.mime_type ? String(row.mime_type) : undefined,
    sizeBytes: Number(row.size_bytes ?? 0),
    storagePath: String(row.storage_path),
    deletedAt: asIso(row.deleted_at),
    createdAt: asIso(row.created_at) ?? ""
  };
}

function mapActivity(row: Row): PmActivityEvent {
  return {
    id: String(row.id),
    actorType: ["user", "system", "n8n", "agent"].includes(String(row.actor_type)) ? (String(row.actor_type) as PmActivityEvent["actorType"]) : "system",
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    actorName: row.actor_name ? String(row.actor_name) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    taskId: row.task_id ? String(row.task_id) : undefined,
    eventType: String(row.event_type),
    payload: parseJsonObject(row.payload),
    createdAt: asIso(row.created_at) ?? ""
  };
}

function mapNotification(row: Row): PmNotification {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: row.project_id ? String(row.project_id) : undefined,
    taskId: row.task_id ? String(row.task_id) : undefined,
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    actorName: row.actor_name ? String(row.actor_name) : undefined,
    eventType: String(row.event_type),
    title: String(row.title),
    body: String(row.body ?? ""),
    payload: parseJsonObject(row.payload),
    readAt: asIso(row.read_at),
    createdAt: asIso(row.created_at) ?? ""
  };
}

function mapWebhookDelivery(row: Row): PmWebhookDeliveryRecord {
  const status = String(row.status);
  return {
    id: String(row.id),
    deliveryId: String(row.delivery_id),
    url: String(row.url),
    eventType: String(row.event_type),
    event: parseJsonObject(row.event_json),
    payload: parseJsonObject(row.payload_json),
    status: ["pending", "delivered", "retrying", "dead"].includes(status) ? (status as PmWebhookDeliveryRecord["status"]) : "pending",
    attempts: Number(row.attempts ?? 0),
    responseStatus: row.response_status === null || row.response_status === undefined ? undefined : Number(row.response_status),
    error: row.error ? String(row.error) : undefined,
    nextAttemptAt: asIso(row.next_attempt_at),
    deliveredAt: asIso(row.delivered_at),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? ""
  };
}

function mapLabel(row: Row): PmLabel {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    color: String(row.color ?? "#6b7280")
  };
}

function mapSavedFilter(row: Row): PmSavedFilter {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    name: String(row.name),
    filter: parseJsonObject(row.filter_json),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? ""
  };
}

function mapHomeWidget(row: Row): PmHomeWidget {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    templateId: row.template_id ? String(row.template_id) : undefined,
    kind: normalizeWidgetKind(row.kind),
    title: String(row.title),
    x: Number(row.x ?? 1),
    y: Number(row.y ?? 1),
    width: Number(row.width ?? 4),
    height: Number(row.height ?? 3),
    clickable: Boolean(row.clickable),
    config: parseJsonObject(row.config),
    content: parseJsonObject(row.content),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? ""
  };
}

function mapWidgetTemplate(row: Row): PmWidgetTemplate {
  return {
    id: String(row.id),
    ownerId: row.owner_id ? String(row.owner_id) : undefined,
    kind: normalizeWidgetKind(row.kind),
    name: String(row.name),
    visibility: row.visibility === "public" ? "public" : "private",
    config: parseJsonObject(row.config),
    content: parseJsonObject(row.content),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? ""
  };
}

function mapAnnouncement(row: Row): PmAnnouncement {
  return {
    id: String(row.id),
    authorId: row.author_id ? String(row.author_id) : undefined,
    title: String(row.title),
    body: String(row.body ?? ""),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? ""
  };
}

function mapBoard(row: Row): PmBoard {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    epicId: row.epic_id ? String(row.epic_id) : undefined,
    name: String(row.name),
    boardType: row.board_type === "scrum" ? "scrum" : "kanban",
    isDefault: Boolean(row.is_default),
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

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item !== null && item !== undefined).map(String);
}

function clampLimit(value: number | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(250, Math.floor(parsed)));
}

function extractMentions(value: string): Set<string> {
  const mentions = new Set<string>();
  for (const match of value.matchAll(/(^|[\s([{:])@([A-Za-z0-9_.-]{2,64})\b/g)) {
    mentions.add(match[2].toLowerCase());
  }
  return mentions;
}

function uniqueUsers(users: PmUser[]): PmUser[] {
  const seen = new Set<string>();
  const result: PmUser[] = [];
  for (const user of users) {
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    result.push(user);
  }
  return result;
}
