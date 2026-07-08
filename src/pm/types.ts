export type PmRole = "admin" | "project_owner" | "member" | "viewer";

export type PmUser = {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
};

export type PmProject = {
  id: string;
  key: string;
  name: string;
  description: string;
  archivedAt?: string;
  deletedAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  role?: PmRole;
};

export type PmEpic = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  position: number;
  archivedAt?: string;
  deletedAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PmTask = {
  id: string;
  projectId: string;
  epicId?: string;
  sprintId?: string;
  parentTaskId?: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId?: string;
  creatorId?: string;
  dueAt?: string;
  archivedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  labelIds?: string[];
};

export type PmTaskDependency = {
  blockingTaskId: string;
  blockedTaskId: string;
  createdBy?: string;
  createdAt: string;
  task: PmTask;
};

export type PmComment = {
  id: string;
  taskId: string;
  authorId?: string;
  authorName?: string;
  body: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PmAttachment = {
  id: string;
  taskId: string;
  uploadedBy?: string;
  uploaderName?: string;
  originalFileName: string;
  storedFileName: string;
  mimeType?: string;
  sizeBytes: number;
  storagePath: string;
  deletedAt?: string;
  createdAt: string;
};

export type PmActivityEvent = {
  id: string;
  actorType: "user" | "system" | "n8n" | "agent";
  actorId?: string;
  actorName?: string;
  projectId?: string;
  taskId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PmNotification = {
  id: string;
  userId: string;
  projectId?: string;
  taskId?: string;
  actorId?: string;
  actorName?: string;
  eventType: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
};

export type PmWebhookDeliveryRecord = {
  id: string;
  deliveryId: string;
  url: string;
  eventType: string;
  event: Record<string, unknown>;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "retrying" | "dead";
  attempts: number;
  responseStatus?: number;
  error?: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PmWebhookDeliverySummary = {
  pending: number;
  retrying: number;
  delivered: number;
  dead: number;
};

export type PmLabel = {
  id: string;
  projectId: string;
  name: string;
  color: string;
};

export type PmSavedFilter = {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  filter: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PmSprintStatus = "planned" | "active" | "completed" | "cancelled";

export type PmSprint = {
  id: string;
  projectId: string;
  epicId?: string;
  name: string;
  status: PmSprintStatus;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PmBoard = {
  id: string;
  projectId: string;
  epicId?: string;
  name: string;
  boardType: "kanban" | "scrum";
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PmBoardColumn = {
  id: string;
  boardId: string;
  name: string;
  statusKey: string;
  position: number;
  wipLimit?: number;
  createdAt: string;
  updatedAt: string;
};

export type PmTaskPosition = {
  taskId: string;
  boardId?: string;
  columnId?: string;
  sprintId?: string;
  backlogScope: string;
  position: number;
};

export type PmBoardTask = PmTask & {
  columnId?: string;
  boardPosition?: number;
};

export type PmEventRecord = {
  actorType: "user" | "system" | "n8n" | "agent";
  actorId?: string;
  projectId?: string;
  taskId?: string;
  eventType: string;
  payload?: Record<string, unknown>;
};

export type CreateProjectInput = {
  key: string;
  name: string;
  description?: string;
};

export type UpdateProjectInput = Partial<Pick<CreateProjectInput, "name" | "description">> & {
  expectedVersion?: number;
};

export type CreateEpicInput = {
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  position?: number;
};

export type CreateTaskInput = {
  projectId: string;
  epicId?: string;
  sprintId?: string;
  parentTaskId?: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  dueAt?: string;
};

export type CreateSprintInput = {
  projectId: string;
  epicId?: string;
  name: string;
  status?: PmSprintStatus;
  startsAt?: string;
  endsAt?: string;
};

export type UpdateSprintInput = Partial<Omit<CreateSprintInput, "projectId">> & {
  expectedVersion?: number;
};

export type CreateCommentInput = {
  taskId: string;
  body: string;
};

export type UpdateCommentInput = {
  body: string;
};

export type CreateAttachmentInput = {
  taskId: string;
  originalFileName: string;
  storedFileName: string;
  mimeType?: string;
  sizeBytes: number;
  storagePath: string;
};

export type CreateLabelInput = {
  projectId: string;
  name: string;
  color?: string;
};

export type UpdateLabelInput = {
  name?: string;
  color?: string;
};

export type CreateSavedFilterInput = {
  projectId: string;
  userId: string;
  name: string;
  filter: Record<string, unknown>;
};

export type UpdateSavedFilterInput = {
  name?: string;
  filter?: Record<string, unknown>;
};

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, "projectId" | "dueAt">> & {
  dueAt?: string | null;
  expectedVersion?: number;
};

export type MoveTaskInput = {
  taskId: string;
  boardId?: string;
  columnId?: string;
  sprintId?: string;
  backlogScope?: string;
  position: number;
  status?: string;
  expectedVersion?: number;
};

export type CreateBoardColumnInput = {
  boardId: string;
  name: string;
  statusKey: string;
  position?: number;
  wipLimit?: number;
};
