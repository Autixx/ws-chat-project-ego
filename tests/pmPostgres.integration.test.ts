import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapPm } from "../src/pm/bootstrap.js";
import { runPmMigrations } from "../src/pm/migrate.js";
import { PmStore } from "../src/pm/postgresStore.js";
import type { AuthenticatedUser } from "../src/auth/authelia.js";

const databaseUrl = process.env.PM_TEST_DATABASE_URL;

test("PM PostgreSQL store lifecycle", { skip: databaseUrl ? false : "PM_TEST_DATABASE_URL is not configured." }, async () => {
  assert.ok(databaseUrl);
  await runPmMigrations(databaseUrl);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerName = `pm_owner_${suffix}`;
  const memberName = `pm_member_${suffix}`;
  const viewerName = `pm_viewer_${suffix}`;
  const projectKey = `PMIT-${suffix}`.toUpperCase().replaceAll(/[^A-Z0-9_-]/g, "-").slice(0, 32);

  await bootstrapPm({
    PM_DATABASE_URL: databaseUrl,
    PM_BOOTSTRAP_USERNAME: ownerName,
    PM_BOOTSTRAP_EMAIL: `${ownerName}@example.test`,
    PM_BOOTSTRAP_DISPLAY_NAME: "PM Owner",
    PM_BOOTSTRAP_PROJECT_KEY: projectKey,
    PM_BOOTSTRAP_PROJECT_NAME: "PM Integration"
  } as NodeJS.ProcessEnv);

  const store = new PmStore(databaseUrl);
  try {
    const owner = await store.ensureUser(identity(ownerName));
    const member = await store.ensureUser(identity(memberName));
    const viewer = await store.ensureUser(identity(viewerName));
    const project = (await store.listProjects(owner.id, true)).find((item) => item.key === projectKey);
    assert.ok(project);
    assert.equal(project.role, "project_owner");

    await store.setMemberRole(owner, project.id, member.id, "member");
    await store.setMemberRole(owner, project.id, viewer.id, "viewer");
    assert.equal(await store.getProjectRole(member.id, project.id), "member");
    assert.equal(await store.getProjectRole(viewer.id, project.id), "viewer");

    const label = await store.createLabel(owner, { projectId: project.id, name: "Backend", color: "#44a4ff" });
    const updatedLabel = await store.updateLabel(owner, project.id, label.id, { name: "API", color: "#00d084" });
    assert.equal(updatedLabel.name, "API");
    assert.equal(updatedLabel.color, "#00d084");

    const blockingTask = await store.createTask(owner, {
      projectId: project.id,
      title: "Prepare API",
      priority: "high",
      dueAt: "2026-07-07"
    });
    const blockedTask = await store.createTask(owner, {
      projectId: project.id,
      title: "Ship UI",
      priority: "medium",
      assigneeId: member.id,
      dueAt: "2026-07-08"
    });

    await store.addTaskLabel(owner, blockedTask.id, label.id);
    const taskLabels = await store.listTaskLabels(blockedTask.id);
    assert.deepEqual(taskLabels.map((item) => item.id), [label.id]);

    const tasks = await store.listTasks(project.id);
    const listedBlocked = tasks.find((item) => item.id === blockedTask.id);
    assert.ok(listedBlocked);
    assert.ok(listedBlocked.labelIds?.includes(label.id));

    await store.addDependency(owner, blockingTask.id, blockedTask.id);
    const dependencies = await store.listDependencies(blockedTask.id);
    assert.equal(dependencies.blockingTasks[0]?.blockingTaskId, blockingTask.id);
    await store.removeDependency(owner, blockingTask.id, blockedTask.id);
    assert.equal((await store.listDependencies(blockedTask.id)).blockingTasks.length, 0);

    const saved = await store.createSavedFilter(owner, {
      projectId: project.id,
      userId: owner.id,
      name: "API work",
      filter: { priority: "medium", labelId: label.id }
    });
    const updatedFilter = await store.updateSavedFilter(owner, project.id, saved.id, {
      name: "Updated API work",
      filter: { priority: "high", due: "overdue" }
    });
    assert.equal(updatedFilter.name, "Updated API work");
    assert.equal(updatedFilter.filter.priority, "high");
    assert.equal((await store.listSavedFilters(project.id, owner.id)).length, 1);
    await store.deleteSavedFilter(owner, project.id, saved.id);
    assert.equal((await store.listSavedFilters(project.id, owner.id)).length, 0);

    const staleLabel = await store.createLabel(owner, { projectId: project.id, name: "Temporary", color: "#ff4d4d" });
    const staleFilter = await store.createSavedFilter(owner, {
      projectId: project.id,
      userId: owner.id,
      name: "Temporary label filter",
      filter: { status: "todo", labelId: staleLabel.id }
    });
    await store.deleteLabel(owner, project.id, staleLabel.id);
    const cleanedFilter = (await store.listSavedFilters(project.id, owner.id)).find((item) => item.id === staleFilter.id);
    assert.ok(cleanedFilter);
    assert.equal(cleanedFilter.filter.labelId, undefined);

    const archived = await store.archiveTask(owner, blockedTask.id, true);
    assert.ok(archived.archivedAt);
    assert.equal((await store.listTasks(project.id)).some((item) => item.id === blockedTask.id), false);
    assert.equal((await store.listTasks(project.id, { includeArchived: true })).some((item) => item.id === blockedTask.id), true);

    const deleted = await store.softDeleteTask(owner, blockingTask.id);
    assert.ok(deleted.deletedAt);
    await assert.rejects(() => store.loadTask(blockingTask.id), /Task not found/);
  } finally {
    await store.close();
  }
});

function identity(username: string): AuthenticatedUser {
  return {
    username,
    email: `${username}@example.test`,
    name: username
  };
}
