import { Pool } from "pg";
import { migrateDown, migrateUp } from "../src/migrate/runner.js";

/** Reset the test database to a fresh, fully-migrated schema. */
export async function resetDatabase(url = process.env.DATABASE_URL!): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrateUp(pool);
  } finally {
    await pool.end();
  }
}

export { migrateDown, migrateUp };
