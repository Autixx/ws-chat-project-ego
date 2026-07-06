import { Pool } from "pg";
import { loadPmConfig } from "./config.js";

type BootstrapEnv = NodeJS.ProcessEnv;

export async function bootstrapPm(env: BootstrapEnv = process.env): Promise<{ userId: string; projectId?: string; role?: string }> {
  const config = loadPmConfig(env);
  if (!config.databaseUrl) throw new Error("PM_DATABASE_URL is required to bootstrap ProjectEGO PM.");

  const username = requiredEnv(env.PM_BOOTSTRAP_USERNAME, "PM_BOOTSTRAP_USERNAME");
  const email = optionalEnv(env.PM_BOOTSTRAP_EMAIL);
  const displayName = optionalEnv(env.PM_BOOTSTRAP_DISPLAY_NAME) ?? username;
  const projectKey = optionalEnv(env.PM_BOOTSTRAP_PROJECT_KEY) ?? "PROJECTEGO";
  const projectName = optionalEnv(env.PM_BOOTSTRAP_PROJECT_NAME) ?? "ProjectEGO";
  const projectDescription = optionalEnv(env.PM_BOOTSTRAP_PROJECT_DESCRIPTION) ?? "Bootstrap ProjectEGO PM project.";

  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    return await pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingUser = await client.query(
          `
          SELECT id
          FROM core.users
          WHERE lower(username) = lower($1)
             OR ($2::text IS NOT NULL AND lower(email) = lower($2))
          LIMIT 1
          `,
          [username, email ?? null]
        );

        const userId = existingUser.rows[0]?.id
          ? String(existingUser.rows[0].id)
          : String(
              (
                await client.query(
                  `
                  INSERT INTO core.users (username, email, display_name, external_subject)
                  VALUES ($1, $2, $3, $4)
                  RETURNING id
                  `,
                  [username, email ?? null, displayName, email ?? username]
                )
              ).rows[0].id
            );

        await client.query(
          "UPDATE core.users SET username = $2, email = $3, display_name = $4, disabled = false, updated_at = now() WHERE id = $1",
          [userId, username, email ?? null, displayName]
        );

        const project = await client.query(
          `
          INSERT INTO pm.projects (key, name, description, created_by)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()
          RETURNING id
          `,
          [normalizeProjectKey(projectKey), projectName, projectDescription, userId]
        );
        const projectId = String(project.rows[0].id);

        await client.query(
          `
          INSERT INTO pm.project_members (project_id, user_id, role)
          VALUES ($1, $2, 'project_owner')
          ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'project_owner'
          `,
          [projectId, userId]
        );

        await client.query(
          `
          INSERT INTO audit.events (actor_type, actor_id, project_id, event_type, payload)
          VALUES ('system', $1, $2, 'pm.bootstrap', $3::jsonb)
          `,
          [userId, projectId, JSON.stringify({ username, projectKey: normalizeProjectKey(projectKey) })]
        );

        await client.query("COMMIT");
        return { userId, projectId, role: "project_owner" };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  } finally {
    await pool.end();
  }
}

function requiredEnv(value: string | undefined, name: string): string {
  const normalized = optionalEnv(value);
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function optionalEnv(value: string | undefined): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}

function normalizeProjectKey(value: string): string {
  const normalized = value.trim().toUpperCase().replaceAll(/[^A-Z0-9_-]/g, "-").slice(0, 32);
  if (!normalized) throw new Error("PM_BOOTSTRAP_PROJECT_KEY must contain at least one valid character.");
  return normalized;
}

const isEntrypoint = process.argv[1]?.endsWith("bootstrap.js") || process.argv[1]?.endsWith("bootstrap.ts");
if (isEntrypoint) {
  const result = await bootstrapPm();
  console.log(`ProjectEGO PM bootstrap complete: user=${result.userId} project=${result.projectId} role=${result.role}`);
}
