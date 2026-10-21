import type { HorseSummaryDto, RaceSummaryDto, ReferralDto } from "@thoroughline/contracts";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FraudService } from "../src/modules/fraud/fraud.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { ReferralsService } from "../src/modules/users/referrals.service.js";
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

  it("flags only larger address clusters, informational: no punishment, no trust lost", async () => {
    for (const u of [a, b, c]) await addIp(u, "shared-hash");
    const svc = t.service(FraudService);
    // Three people behind one address (a family, a carrier gateway) is nothing to look at.
    expect(await svc.detect()).toBe(0);
    for (const id of [9905, 9906]) await addIp(await t.login(id, `Mate${id}`), "shared-hash");
    expect(await svc.detect()).toBe(5);
    expect(await svc.detect()).toBe(0);
    const flags = (
      await t.get<{ user_id: string; kind: string; severity: number }[]>("/admin/fraud/flags", analyst.token)
    ).body;
    expect(flags.filter((f) => f.kind === "SHARED_IP")).toHaveLength(5);
    expect(flags.every((f) => f.severity === 1)).toBe(true);
    // A shared address alone costs no trust, and nobody is suspended.
    const st = await t.db.query<{ status: string; trust_score: number }>(
      "SELECT status, trust_score FROM users WHERE id = ANY($1::uuid[])",
      [[a.userId, b.userId, c.userId]],
    );
    expect(st.every((s) => s.status === "ACTIVE" && s.trust_score === 50)).toBe(true);
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

  it("dismisses the open flags of one weak network kind in bulk, audited once", async () => {
    const bulk = (token: string, kind = "SHARED_IP") =>
      t.post<{ dismissed: number }>(
        "/admin/fraud/flags/dismiss-bulk",
        { kind, note: "Mobile carrier gateway" },
        token,
      );
    expect((await bulk(a.token)).status).toBe(403);
    // Trade and income signals always need a look one by one.
    expect((await bulk(analyst.token, "CIRCULAR_TRADE")).status).toBe(400);
    const open = async () =>
      (await t.get<{ kind: string }[]>("/admin/fraud/flags", analyst.token)).body.filter(
        (f) => f.kind === "SHARED_IP",
      ).length;
    expect(await open()).toBe(4);
    const r = await bulk(analyst.token);
    expect(r.status).toBe(201);
    expect(r.body.dismissed).toBe(4);
    expect(await open()).toBe(0);
    const audit = await t.db.query<{ after: { count: number } }>(
      "SELECT after FROM audit_logs WHERE action = 'FRAUD_FLAGS_BULK_DISMISSED'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after.count).toBe(4);
  });

  it("the one-time approval migration dismisses open network flags only, audited once", async () => {
    const u = await t.login(9907, "Held");
    for (const [kind, key] of [
      ["SHARED_IP", "ip:x"],
      ["REFERRAL_SHARED_IP", "refnet:x"],
      ["REFERRAL_CLUSTER", "refs:some"],
      ["INCOME_SPIKE", "income:x"],
    ] as const)
      await t.db.query(
        "INSERT INTO fraud_flags (user_id, kind, severity, dedupe_key) VALUES ($1, $2, 1, $3)",
        [u.userId, kind, key],
      );
    const sql = readFileSync(
      new URL("../migrations/0051_approve_network_flags.up.sql", import.meta.url),
      "utf8",
    );
    await t.db.query(sql);
    const left = await t.db.query<{ kind: string; status: string }>(
      "SELECT kind, status FROM fraud_flags WHERE user_id = $1 ORDER BY kind",
      [u.userId],
    );
    expect(left).toEqual([
      { kind: "INCOME_SPIKE", status: "OPEN" },
      { kind: "REFERRAL_CLUSTER", status: "DISMISSED" },
      { kind: "REFERRAL_SHARED_IP", status: "DISMISSED" },
      { kind: "SHARED_IP", status: "DISMISSED" },
    ]);
    const audit = await t.db.query<{ after: { count: number } }>(
      "SELECT after FROM audit_logs WHERE target_id = 'network-flags-2026-10'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after.count).toBe(3);
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

  it("waits a day, holds same-network invites for review, then pays both sides once", async () => {
    const referrer = await t.login(9951, "Host");
    const code = (await t.get<{ referralCode: string }>("/me", referrer.token)).body.referralCode;
    const young = await t.login(9952, "Newbie", `ref_${code}`);
    // Three invitees on the referrer's own private network: a household is fine, a farm is not.
    const home = [
      await t.login(9953, "Sock", `ref_${code}`),
      await t.login(9955, "Sock2", `ref_${code}`),
      await t.login(9956, "Sock3", `ref_${code}`),
    ];
    for (const u of home)
      await t.db.query(
        "INSERT INTO login_ips (user_id, ip_hash) SELECT $1, ip_hash FROM login_ips WHERE user_id = $2",
        [u.userId, referrer.userId],
      );
    const sameIp = home[2]!;

    // Too young: no reward yet (the first race happens within the first day).
    const before = await credits(referrer);
    await t.db.query("UPDATE users SET created_at = $2 WHERE id = $1", [young.userId, t.clock.now()]);
    await raceOnce(young);
    const referrerAfterFirst = await credits(referrer);
    expect(referrerAfterFirst).toBe(before);

    // Once the invitee is a day old the background sweep pays both sides — no second race needed.
    expect(
      t.clock.now().getTime() -
        new Date((await t.get<{ createdAt: string }>("/me", young.token)).body.createdAt).getTime(),
    ).toBeGreaterThan(DAY);
    const statuses = (await t.get<ReferralDto[]>("/me/referrals", referrer.token)).body;
    expect(statuses.find((r) => r.name === "Newbie")?.status).toBe("PROCESSING");
    expect(await t.service(ReferralsService).sweep()).toBe(1);
    expect(await t.service(ReferralsService).sweep()).toBe(0);
    expect(await credits(referrer)).toBe(referrerAfterFirst + 500);
    // Racing again pays nothing more.
    await raceOnce(young);
    expect(await credits(referrer)).toBe(referrerAfterFirst + 500);
    const tx = await t.db.query("SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1", [
      `referral:${young.userId}:referee`,
    ]);
    expect(tx).toHaveLength(1);

    // Same private address as the referrer: the first two (a household) are paid automatically,
    // with an auto-approved flag on record…
    for (const u of home)
      await t.db.query("UPDATE users SET created_at = $2 WHERE id = $1", [
        u.userId,
        new Date(t.clock.now().getTime() - 3 * DAY),
      ]);
    const homeBefore = await credits(referrer);
    for (const u of home.slice(0, 2)) await raceOnce(u);
    await t.service(ReferralsService).sweep();
    expect(await credits(referrer)).toBe(homeBefore + 1000);
    const auto = await t.db.query<{ status: string; review_note: string }>(
      "SELECT status, review_note FROM fraud_flags WHERE kind = 'REFERRAL_SHARED_IP' AND user_id = ANY($1::uuid[])",
      [home.slice(0, 2).map((u) => u.userId)],
    );
    expect(auto).toHaveLength(2);
    expect(auto.every((f) => f.status === "DISMISSED" && f.review_note.startsWith("Auto-approved"))).toBe(
      true,
    );

    // …from the third on, held for review: not paid and not refused.
    const hostBefore = await credits(referrer);
    await raceOnce(sameIp);
    await t.service(ReferralsService).sweep();
    expect(await credits(referrer)).toBe(hostBefore);
    const status = async () =>
      Object.fromEntries(
        (await t.get<ReferralDto[]>("/me/referrals", referrer.token)).body.map((r) => [r.name, r.status]),
      );
    expect(await status()).toEqual({ Sock3: "REVIEW", Sock2: "PAID", Sock: "PAID", Newbie: "PAID" });
    const flag = await t.db.one<{ id: number }>(
      "SELECT id FROM fraud_flags WHERE user_id = $1 AND kind = 'REFERRAL_SHARED_IP' AND status = 'OPEN'",
      [sameIp.userId],
    );
    expect(flag).not.toBeNull();

    // The referrer may not approve their own invite, even as an admin.
    await t.db.query("UPDATE users SET role = 'SUPER_ADMIN' WHERE id = $1", [referrer.userId]);
    const self = await t.post<{ error: { code: string } }>(
      `/admin/fraud/flags/${flag!.id}/review`,
      { decision: "DISMISSED", note: "that's my friend" },
      referrer.token,
    );
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe("SELF_ACTION");

    // Another analyst confirms they are different people: the sweep pays both sides.
    const analyst = await t.login(9954, "Checker");
    await t.db.query("UPDATE users SET role = 'FRAUD_ANALYST' WHERE id = $1", [analyst.userId]);
    const ok = await t.post(
      `/admin/fraud/flags/${flag!.id}/review`,
      { decision: "DISMISSED", note: "Different phones on the same mobile carrier" },
      analyst.token,
    );
    expect(ok.status).toBe(201);
    expect(await t.service(ReferralsService).sweep()).toBe(1);
    expect(await credits(referrer)).toBe(hostBefore + 500);
    expect((await status()).Sock3).toBe("PAID");
  });

  it("ignores addresses shared with unrelated players (mobile carrier gateways)", async () => {
    const referrer = await t.login(9961, "Carrier");
    const code = (await t.get<{ referralCode: string }>("/me", referrer.token)).body.referralCode;
    const friend = await t.login(9962, "Mate", `ref_${code}`);
    const gateway = "carrier-gateway";
    const onGateway = (userId: string) =>
      t.db.query(
        "INSERT INTO login_ips (user_id, ip_hash, first_seen, last_seen) VALUES ($1,$2,$3,$3) ON CONFLICT DO NOTHING",
        [userId, gateway, t.clock.now()],
      );
    await onGateway(referrer.userId);
    await onGateway(friend.userId);
    const svc = t.service(FraudService);
    const shares = () => t.db.tx((c) => svc.sharesPrivateNetwork(c, friend.userId, referrer.userId));
    expect(await shares()).toBe(true);
    // Three unrelated subscribers behind the same address make it a public gateway.
    for (const id of [9963, 9964, 9965]) await onGateway((await t.login(id, `Stranger${id}`)).userId);
    expect(await shares()).toBe(false);
    // The referrer's own invitees never make an address look public (no invite farms).
    const farmer = await t.login(9971, "Farmer");
    const farmCode = (await t.get<{ referralCode: string }>("/me", farmer.token)).body.referralCode;
    const farm: { token: string; userId: string }[] = [];
    for (const id of [9972, 9973, 9974, 9975]) farm.push(await t.login(id, `Farm${id}`, `ref_${farmCode}`));
    for (const u of [farmer, ...farm])
      await t.db.query(
        "INSERT INTO login_ips (user_id, ip_hash, first_seen, last_seen) VALUES ($1,'farm',$2,$2)",
        [u.userId, t.clock.now()],
      );
    expect(await t.db.tx((c) => svc.sharesPrivateNetwork(c, farm[0]!.userId, farmer.userId))).toBe(true);
  });

  it("flags a referrer only for several invitees on their own private address", async () => {
    const svc = t.service(FraudService);
    await svc.detect();
    const cluster = await t.db.query<{ user_id: string; severity: number }>(
      "SELECT user_id, severity FROM fraud_flags WHERE kind = 'REFERRAL_CLUSTER'",
    );
    const farmer = await t.db.one<{ id: string }>("SELECT id FROM users WHERE telegram_id = 9971");
    const carrier = await t.db.one<{ id: string }>("SELECT id FROM users WHERE telegram_id = 9961");
    // Four invitees on the farmer's own address; one friend behind a public gateway is nothing.
    expect(cluster.find((f) => f.user_id === farmer!.id)?.severity).toBe(2);
    expect(cluster.some((f) => f.user_id === carrier!.id)).toBe(false);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
