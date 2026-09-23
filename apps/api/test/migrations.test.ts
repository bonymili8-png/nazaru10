import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations, migrateDown, migrateUp } from "../src/migrate/runner.js";
import { resetDatabase } from "./db.js";

describe("migrations", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  beforeAll(() => resetDatabase());
  afterAll(() => pool.end());

  it("apply up → down (all) → up cleanly and are idempotent", async () => {
    const all = await loadMigrations();
    expect(await migrateUp(pool)).toEqual([]);
    const reverted = await migrateDown(pool, all.length);
    expect(reverted).toEqual(all.map((m) => m.version).reverse());
    const tables = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'",
    );
    expect(tables.rows[0].n).toBe(0);
    expect(await migrateUp(pool)).toEqual(all.map((m) => m.version));
  });

  it("enforces non-negative user balances and balanced ledger transactions", async () => {
    const c = await pool.connect();
    try {
      const u = await c.query("INSERT INTO users (telegram_id, referral_code) VALUES (1, 'R1') RETURNING id");
      await expect(
        c.query(
          "INSERT INTO accounts (owner_type, owner_id, currency, balance) VALUES ('USER', $1, 'CREDITS', -1)",
          [u.rows[0].id],
        ),
      ).rejects.toThrow(/check constraint/);

      await c.query("BEGIN");
      const acc = await c.query(
        "INSERT INTO accounts (owner_type, owner_id, currency) VALUES ('USER', $1, 'CREDITS') RETURNING id",
        [u.rows[0].id],
      );
      const tx = await c.query(
        "INSERT INTO ledger_transactions (idempotency_key, type) VALUES ('k1', 'TEST') RETURNING id",
      );
      await c.query(
        "INSERT INTO ledger_entries (tx_id, account_id, amount, balance_after) VALUES ($1, $2, 10, 10)",
        [tx.rows[0].id, acc.rows[0].id],
      );
      await expect(c.query("COMMIT")).rejects.toThrow(/unbalanced/);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  it("makes ledger and audit rows append-only", async () => {
    await pool.query("INSERT INTO audit_logs (action, target_type) VALUES ('TEST', 'x')");
    await expect(pool.query("UPDATE audit_logs SET action = 'HACK'")).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM audit_logs")).rejects.toThrow(/append-only/);
  });
});
