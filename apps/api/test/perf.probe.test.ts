/**
 * Performance probe (not part of the normal suite): `PERF=1 npx vitest run test/perf.probe.test.ts`.
 * Seeds a small world, then reports per endpoint the number of SQL statements and latency, so
 * N+1 query patterns and slow endpoints show up before real traffic does.
 */
import pg from "pg";
import type { HorseSummaryDto, RaceSummaryDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

const stats = { queries: 0, ms: 0, slow: [] as { ms: number; sql: string }[] };
const origQuery = pg.Client.prototype.query;
function instrument() {
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const sql = typeof args[0] === "string" ? args[0] : ((args[0] as { text?: string })?.text ?? "");
    const t0 = performance.now();
    const done = () => {
      const ms = performance.now() - t0;
      stats.ms += ms;
      if (ms > 20) stats.slow.push({ ms, sql: sql.replace(/\s+/g, " ").slice(0, 140) });
    };
    stats.queries++;
    // The pool passes a callback; direct client use gets a promise.
    const cb = args[args.length - 1];
    if (typeof cb === "function")
      args[args.length - 1] = (...r: unknown[]) => {
        done();
        return (cb as (...a: unknown[]) => unknown)(...r);
      };
    const out = (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    if (out && typeof (out as Promise<unknown>).then === "function")
      void (out as Promise<unknown>).then(done, () => undefined);
    return out;
  } as typeof pg.Client.prototype.query;
}

describe.skipIf(!process.env.PERF)("performance probe", () => {
  let t: TestApp;
  const users: { token: string; userId: string }[] = [];
  beforeAll(async () => {
    t = await createTestApp();
    const runner = t.service(RaceRunnerService);
    for (let i = 0; i < 40; i++) {
      const u = await t.login(60_000 + i, `Perf${i}`);
      users.push(u);
      await t.db.tx((c) =>
        t.service(LedgerService).credit(c, {
          userId: u.userId,
          currency: "CREDITS",
          amount: 100_000,
          source: "ADMIN_ADJUSTMENT",
          key: `perf:${u.userId}`,
          type: "TEST",
        }),
      );
    }
    // Three rounds of racing so histories, ledgers and leaderboards have content.
    for (let round = 0; round < 3; round++) {
      await runner.scheduleAhead();
      const races = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&limit=50", users[0]!.token)).body;
      for (const [i, u] of users.entries()) {
        const h = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!;
        const r = races.filter((x) => x.class === "MAIDEN" || x.class === "CLASS_5")[i % 6]!;
        await t.post(`/races/${r.id}/entries`, { horseId: h.id, strategy: "MID_PACK" }, u.token);
      }
      t.clock.advance(3 * 3_600_000);
      await runner.lockDue();
      await runner.runDue();
      t.clock.advance(10 * 60_000);
      await runner.settleDue();
      t.clock.advance(3 * 24 * 3_600_000); // horses recover before the next round
    }
    instrument();
  }, 600_000);
  afterAll(async () => {
    pg.Client.prototype.query = origQuery;
    await t.close();
  });

  it("reports queries and latency per endpoint", async () => {
    const u = users[0]!;
    const horse = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!.id;
    const race = (await t.get<RaceSummaryDto[]>("/races?status=recent&limit=5", u.token)).body[0]?.id;
    const endpoints = [
      "/me",
      "/home",
      "/wallet",
      "/wallet/transactions?limit=20",
      "/horses",
      `/horses/${horse}`,
      `/horses/${horse}/advice`,
      "/races?status=upcoming&limit=50",
      "/races?status=recent&limit=20",
      ...(race ? [`/races/${race}`, `/races/${race}/live`] : []),
      "/races/mine",
      "/leaderboard/horses",
      "/leaderboard/owners",
      "/seasons/current",
      "/market/listings",
      "/market/mine",
      "/shop/horses",
      "/stable",
      "/staff",
      "/sponsors",
      "/pass",
      "/quests",
      "/tournaments",
      "/feed",
      "/events",
      "/clubs",
      "/cosmetics",
    ];
    const rows: string[] = [];
    for (const [k, path] of endpoints.entries()) {
      // A fresh owner per endpoint keeps the probe under the per-user read rate limit.
      const v = users[(k % (users.length - 1)) + 1]!;
      const p = path.replace(horse, (await t.get<HorseSummaryDto[]>("/horses", v.token)).body[0]!.id);
      await t.get(p, v.token); // warm-up
      stats.queries = 0;
      stats.ms = 0;
      const t0 = performance.now();
      const n = 5;
      let status = 0;
      for (let i = 0; i < n; i++) status = (await t.get(p, v.token)).status;
      const ms = (performance.now() - t0) / n;
      rows.push(
        `${String(status).padEnd(4)} ${path.padEnd(48)} ${ms.toFixed(1).padStart(7)} ms  ${String(stats.queries / n).padStart(5)} queries`,
      );
    }
    console.log(`\n${rows.join("\n")}`);
    const worst = [...stats.slow].sort((a, b) => b.ms - a.ms).slice(0, 10);
    console.log("slowest statements (> 20 ms):", worst.length ? "" : "none");
    for (const s of worst) console.log(`${s.ms.toFixed(1)} ms  ${s.sql}`);
  }, 600_000);
});
