import type { HorseSummaryDto, RaceSummaryDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FraudService } from "../src/modules/fraud/fraud.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };
const DAY = 86_400_000;

describe("anti-fraud", () => {
  let t: TestApp;
  let analyst: User;
  let a: User;
  let b: User;
  let c: User;

  const addIp = (u: User, hash: string) =>
    t.db.query(
      "INSERT INTO login_ips (user_id, ip_hash, first_seen, last_seen) VALUES ($1,$2,$3,$3) ON CONFLICT DO NOTHING",
      [u.userId, hash, t.clock.now()],
    );

  beforeAll(async () => {
    t = await createTestApp();
    analyst = await t.login(9901, "Sleuth");
    a = await t.login(9902, "Ann");
    b = await t.login(9903, "Ben");
    c = await t.login(9904, "Cat");
    await t.db.query("UPDATE users SET role = 'FRAUD_ANALYST' WHERE id = $1", [analyst.userId]);
  });
  afterAll(() => t.close());

  it("stores only a keyed hash of the sign-in address", async () => {
    const rows = await t.db.query<{ ip_hash: string }>("SELECT ip_hash FROM login_ips WHERE user_id = $1", [
      a.userId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0]!.ip_hash).not.toContain("10.0");
  });

  it("flags address clusters once, never punishing on its own", async () => {
    for (const u of [a, b, c]) await addIp(u, "shared-hash");
    const svc = t.service(FraudService);
    expect(await svc.detect()).toBe(3);
    expect(await svc.detect()).toBe(0);
    const flags = (
      await t.get<{ user_id: string; kind: string; severity: number }[]>("/admin/fraud/flags", analyst.token)
    ).body;
    expect(flags.filter((f) => f.kind === "SHARED_IP")).toHaveLength(3);
    // Flags lower trust but nobody is suspended.
    const st = await t.db.query<{ status: string; trust_score: number }>(
      "SELECT status, trust_score FROM users WHERE id = ANY($1::uuid[])",
      [[a.userId, b.userId, c.userId]],
    );
    expect(st.every((s) => s.status === "ACTIVE" && s.trust_score === 45)).toBe(true);
  });

  it("detects circular trades between two accounts", async () => {
    const horse = (await t.get<HorseSummaryDto[]>("/horses", a.token)).body[0]!;
    const sold = (seller: User, buyer: User, at: Date) =>
      t.db.query(
        `INSERT INTO market_listings (horse_id, seller_id, type, status, price, reference_value, ends_at, buyer_id,
                                      sale_price, fee, closed_at)
         VALUES ($1,$2,'FIXED','SOLD',1000,1000,$3,$4,1000,60,$3)`,
        [horse.id, seller.userId, at, buyer.userId],
      );
    const now = t.clock.now().getTime();
    await sold(a, b, new Date(now - 3 * DAY));
    await sold(b, a, new Date(now - DAY));
    expect(await t.service(FraudService).detect()).toBe(2);
    const flags = (await t.get<{ user_id: string; kind: string }[]>("/admin/fraud/flags", analyst.token))
      .body;
    expect(
      flags
        .filter((f) => f.kind === "CIRCULAR_TRADE")
        .map((f) => f.user_id)
        .sort(),
    ).toEqual([a.userId, b.userId].sort());
  });

  it("lets analysts (only) dismiss or confirm, once, with an audited note", async () => {
    expect((await t.get("/admin/fraud/flags", a.token)).status).toBe(403);
    const flags = (
      await t.get<{ id: number; user_id: string; kind: string }[]>("/admin/fraud/flags", analyst.token)
    ).body;
    const ip = flags.find((f) => f.kind === "SHARED_IP" && f.user_id === c.userId)!;
    const r = await t.post(
      `/admin/fraud/flags/${ip.id}/review`,
      { decision: "DISMISSED", note: "Same university network" },
      analyst.token,
    );
    expect(r.status).toBe(201);
    expect(
      (
        await t.post(
          `/admin/fraud/flags/${ip.id}/review`,
          { decision: "CONFIRMED", note: "changed my mind" },
          analyst.token,
        )
      ).status,
    ).toBe(409);
    const trust = await t.db.one<{ trust_score: number }>("SELECT trust_score FROM users WHERE id = $1", [
      c.userId,
    ]);
    expect(trust!.trust_score).toBe(50);
    const audit = await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'FRAUD_FLAG_DISMISSED'");
    expect(audit).toHaveLength(1);
    const dismissed = (await t.get<{ id: number }[]>("/admin/fraud/flags?status=DISMISSED", analyst.token))
      .body;
    expect(dismissed.map((f) => f.id)).toEqual([ip.id]);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});

describe("referral rewards", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const credits = async (u: User) =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", u.token)).body.balances.CREDITS;

  /** Enter the invitee's horse in the next maiden race and run it to settlement. */
  const raceOnce = async (u: User) => {
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN", u.token)).body[0]!;
    const horse = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!;
    // Condition, injuries and maiden status are not what this test is about: start every race fresh.
    await t.db.query(
      `UPDATE horses SET status = 'IDLE', injured_until = NULL, fatigue = 0, health = 100, wins = 0,
              condition_updated_at = $2 WHERE id = $1`,
      [horse.id, t.clock.now()],
    );
    expect(
      (await t.post(`/races/${race.id}/entries`, { horseId: horse.id, strategy: "MID_PACK" }, u.token))
        .status,
    ).toBe(201);
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    await runner.runDue();
    t.clock.advance(5 * 60_000);
    await runner.settleDue();
    // Recover before the next race.
    t.clock.advance(2 * DAY);
  };

  it("waits a day, skips same-address invitees, then pays both sides once", async () => {
    const referrer = await t.login(9951, "Host");
    const code = (await t.get<{ referralCode: string }>("/me", referrer.token)).body.referralCode;
    const young = await t.login(9952, "Newbie", `ref_${code}`);
    const sameIp = await t.login(9953, "Sock", `ref_${code}`);
    await t.db.query(
      "INSERT INTO login_ips (user_id, ip_hash) SELECT $1, ip_hash FROM login_ips WHERE user_id = $2",
      [sameIp.userId, referrer.userId],
    );

    // Too young: no reward yet (the first race happens within the first day).
    const before = await credits(referrer);
    await t.db.query("UPDATE users SET created_at = $2 WHERE id = $1", [young.userId, t.clock.now()]);
    await raceOnce(young);
    const referrerAfterFirst = await credits(referrer);
    expect(referrerAfterFirst).toBe(before);

    // A later race, now older than a day: both sides are rewarded, once.
    await raceOnce(young);
    expect(await credits(referrer)).toBe(referrerAfterFirst + 500);
    const tx = await t.db.query("SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1", [
      `referral:${young.userId}:referee`,
    ]);
    expect(tx).toHaveLength(1);

    // Same address as the referrer: never rewarded, even once old enough.
    await t.db.query("UPDATE users SET created_at = $2 WHERE id = $1", [
      sameIp.userId,
      new Date(t.clock.now().getTime() - 3 * DAY),
    ]);
    const hostBefore = await credits(referrer);
    await raceOnce(sameIp);
    expect(await credits(referrer)).toBe(hostBefore);
    const none = await t.db.query("SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1", [
      `referral:${sameIp.userId}:referee`,
    ]);
    expect(none).toHaveLength(0);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
