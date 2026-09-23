import pg, { Pool, type PoolClient, type QueryResultRow } from "pg";

// int8 → number (all our int8 values — balances, ids — stay far below 2^53); numeric → number.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));

export type Queryable = Pick<PoolClient, "query">;

const RETRYABLE = new Set(["40001", "40P01"]); // serialization_failure, deadlock_detected

/** Thin wrapper around a pg Pool with a transaction helper. All SQL must be parameterized. */
export class Db {
  readonly pool: Pool;

  constructor(connectionString: string, max = 20) {
    this.pool = new Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
  }

  async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(text, params);
    return res.rows;
  }

  async one<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /**
   * Run `fn` in a transaction (READ COMMITTED + explicit row locks). Retries on deadlock /
   * serialization failure. `fn` must be safe to re-run (no external side effects inside).
   */
  async tx<T>(fn: (client: PoolClient) => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (err as { code?: string }).code;
        if (attempt < attempts && code && RETRYABLE.has(code)) continue;
        throw err;
      } finally {
        client.release();
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const rows = async <T extends QueryResultRow>(
  c: Queryable,
  text: string,
  params: unknown[] = [],
): Promise<T[]> => (await c.query<T>(text, params)).rows;

export const row = async <T extends QueryResultRow>(
  c: Queryable,
  text: string,
  params: unknown[] = [],
): Promise<T | null> => (await c.query<T>(text, params)).rows[0] ?? null;
