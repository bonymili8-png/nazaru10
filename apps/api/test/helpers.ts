import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { buildApp } from "../src/app.js";
import { Clock } from "../src/common/clock.js";
import { Db } from "../src/common/db.js";
import { createLogger } from "../src/common/logger.js";
import { loadEnv } from "../src/config/env.js";
import { signInitData } from "../src/modules/auth/telegram-init-data.js";
import { FakeBotApi } from "../src/modules/telegram/bot-api.js";
import { resetDatabase } from "./db.js";

export interface TestApp {
  app: NestFastifyApplication;
  db: Db;
  bot: FakeBotApi;
  clock: Clock;
  env: ReturnType<typeof loadEnv>;
  get<T = unknown>(url: string, token?: string): Promise<{ status: number; body: T }>;
  post<T = unknown>(
    url: string,
    body?: unknown,
    token?: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: T }>;
  del<T = unknown>(url: string, token?: string): Promise<{ status: number; body: T }>;
  put<T = unknown>(url: string, body?: unknown, token?: string): Promise<{ status: number; body: T }>;
  login(
    telegramId: number,
    firstName?: string,
    startParam?: string,
  ): Promise<{ token: string; userId: string }>;
  service<T>(cls: abstract new (...args: never[]) => T): T;
  close(): Promise<void>;
}

let counter = 0;

export async function createTestApp(): Promise<TestApp> {
  await resetDatabase();
  const env = loadEnv();
  const db = new Db(env.DATABASE_URL, 30);
  const bot = new FakeBotApi();
  const clock = new Clock();
  const app = await buildApp({ env, logger: createLogger("silent"), db, bot, clock });
  const request = async <T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    body?: unknown,
    token?: string,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        // Distinct client IPs so per-IP rate limits don't couple unrelated tests.
        "x-forwarded-for": `10.0.${Math.floor(counter / 250) % 250}.${counter++ % 250}`,
        ...headers,
      },
    });
    return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : null) as T };
  };
  const t: TestApp = {
    app,
    db,
    bot,
    clock,
    env,
    get: (url, token) => request("GET", url, undefined, token),
    post: (url, body, token, headers) => request("POST", url, body ?? {}, token, headers),
    del: (url, token) => request("DELETE", url, undefined, token),
    put: (url, body, token) => request("PUT", url, body ?? {}, token),
    async login(telegramId, firstName = "Tester", startParam) {
      const initData = signInitData(
        {
          auth_date: String(Math.floor(clock.now().getTime() / 1000)),
          query_id: `q${telegramId}`,
          user: JSON.stringify({ id: telegramId, first_name: firstName, username: `u${telegramId}` }),
          ...(startParam ? { start_param: startParam } : {}),
        },
        env.TELEGRAM_BOT_TOKEN,
      );
      const res = await request<{ token: string; user: { id: string } }>("POST", "/auth/telegram", {
        initData,
      });
      if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
      return { token: res.body.token, userId: res.body.user.id };
    },
    service: (cls) => app.get(cls as never),
    async close() {
      await app.close();
      await db.close();
    },
  };
  return t;
}

/** Double-entry invariants that must hold after any sequence of operations. */
export async function assertLedgerIntegrity(db: Db): Promise<void> {
  const unbalanced = await db.query(
    `SELECT e.tx_id, a.currency, sum(e.amount) AS s FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
      GROUP BY e.tx_id, a.currency HAVING sum(e.amount) <> 0`,
  );
  if (unbalanced.length) throw new Error(`unbalanced ledger transactions: ${JSON.stringify(unbalanced)}`);
  const totals = await db.query<{ currency: string; s: number }>(
    "SELECT currency, sum(balance)::bigint AS s FROM accounts GROUP BY currency",
  );
  for (const t of totals)
    if (Number(t.s) !== 0) throw new Error(`currency ${t.currency} does not net to zero: ${t.s}`);
  const drift = await db.query(
    `SELECT a.id FROM accounts a
      WHERE a.balance <> COALESCE((SELECT sum(amount) FROM ledger_entries e WHERE e.account_id = a.id), 0)`,
  );
  if (drift.length) throw new Error(`account balances drifted from ledger: ${JSON.stringify(drift)}`);
  const negative = await db.query("SELECT id FROM accounts WHERE owner_type <> 'SYSTEM' AND balance < 0");
  if (negative.length) throw new Error("negative user balance");
}
