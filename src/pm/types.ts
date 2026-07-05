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
};

export type PmTaskPosition = {
  taskId: string;
  boardId?: string;
  columnId?: string;
  sprintId?: string;
  backlogScope: string;
  position: number;
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

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, "projectId">> & {
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
