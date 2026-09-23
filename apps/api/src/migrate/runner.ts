import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");
const LOCK_KEY = 72_410_001; // pg_advisory_lock key: one migrator at a time

interface Migration {
  version: string;
  up: string;
  down: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = await readdir(dir);
  const versions = [
    ...new Set(files.filter((f) => f.endsWith(".up.sql")).map((f) => f.replace(/\.up\.sql$/, ""))),
  ].sort();
  return Promise.all(
    versions.map(async (version) => {
      const down = path.join(dir, `${version}.down.sql`);
      if (!files.includes(`${version}.down.sql`)) throw new Error(`Migration ${version} has no down script`);
      return {
        version,
        up: await readFile(path.join(dir, `${version}.up.sql`), "utf8"),
        down: await readFile(down, "utf8"),
      };
    }),
  );
}

async function withLock<T>(pool: Pool, fn: (q: Pool["query"]) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    return await fn(client.query.bind(client) as Pool["query"]);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/** Apply all pending migrations, each in its own transaction. Returns applied versions. */
export async function migrateUp(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  return withLock(pool, async (query) => {
    const done = new Set(
      (await query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version),
    );
    const applied: string[] = [];
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      await query("BEGIN");
      try {
        await query(m.up);
        await query("INSERT INTO schema_migrations (version) VALUES ($1)", [m.version]);
        await query("COMMIT");
        applied.push(m.version);
      } catch (err) {
        await query("ROLLBACK");
        throw new Error(`Migration ${m.version} failed: ${(err as Error).message}`);
      }
    }
    return applied;
  });
}

/** Roll back the last `steps` applied migrations. */
export async function migrateDown(pool: Pool, steps = 1, dir = MIGRATIONS_DIR): Promise<string[]> {
  const migrations = new Map((await loadMigrations(dir)).map((m) => [m.version, m] as const));
  return withLock(pool, async (query) => {
    const done = (
      await query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT $1",
        [steps],
      )
    ).rows;
    const reverted: string[] = [];
    for (const { version } of done) {
      const m = migrations.get(version);
      if (!m) throw new Error(`No files for applied migration ${version}`);
      await query("BEGIN");
      try {
        await query(m.down);
        await query("DELETE FROM schema_migrations WHERE version = $1", [version]);
        await query("COMMIT");
        reverted.push(version);
      } catch (err) {
        await query("ROLLBACK");
        throw new Error(`Rollback ${version} failed: ${(err as Error).message}`);
      }
    }
    return reverted;
  });
}
