import type { SponsorsDto } from "@thoroughline/contracts";
import { defaultConfig, sponsorOffers, sponsorWeek, sponsorWeekStart } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SponsorsService } from "../src/modules/sponsors/sponsors.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };

describe("sponsors", () => {
  let t: TestApp;
  let owner: User;

  const wallet = async () =>
    (await t.get<{ balances: { CREDITS: number; REPUTATION: number } }>("/wallet", owner.token)).body
      .balances;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(8501, "Sponsored");
  });
  afterAll(() => t.close());

  it("offers this week's three sponsors and signs one", async () => {
    const v = (await t.get<SponsorsDto>("/sponsors", owner.token)).body;
    const week = sponsorWeek(t.clock.now());
    expect(v.week).toBe(week);
    expect(v.offers.map((o) => o.code)).toEqual(
      sponsorOffers(owner.userId, week, defaultConfig).map((o) => o.code),
    );
    expect(v.active).toBeNull();
    expect((await t.post("/sponsors/NOT_OFFERED/sign", {}, owner.token)).status).toBe(404);
    const signed = await t.post<SponsorsDto>(`/sponsors/${v.offers[0]!.code}/sign`, {}, owner.token);
    expect(signed.status).toBe(201);
    expect(signed.body.active).toMatchObject({ code: v.offers[0]!.code, progress: 0, status: "ACTIVE" });
    expect(signed.body.signedThisWeek).toBe(true);
    // One contract per week.
    const again = await t.post<{ error: { code: string } }>(
      `/sponsors/${v.offers[1]!.code}/sign`,
      {},
      owner.token,
    );
    expect(again.status).toBe(409);
  });

  it("counts qualifying runs and pays once the goal is met", async () => {
    const v = (await t.get<SponsorsDto>("/sponsors", owner.token)).body;
    const goal = v.active!.goal;
    const run = {
      surface: goal.surface ?? "TURF",
      distance: goal.minDistance ?? goal.maxDistance ?? 1400,
      wetness: goal.minWetness ?? 0,
      position: 1,
    };
    const before = await wallet();
    const svc = t.service(SponsorsService);
    // A run that does not qualify (last place when a placing is needed, or wrong surface) is ignored.
    await t.db.tx((c) =>
      svc.onRun(
        c,
        owner.userId,
        { ...run, position: 9, surface: run.surface === "TURF" ? "DIRT" : "TURF" },
        t.clock.now(),
      ),
    );
    const mid = (await t.get<SponsorsDto>("/sponsors", owner.token)).body.active!;
    expect(mid.progress).toBe(goal.result === "START" && !goal.surface ? 1 : 0);
    for (let i = mid.progress; i < goal.count; i++)
      await t.db.tx((c) => svc.onRun(c, owner.userId, run, t.clock.now()));
    const done = (await t.get<SponsorsDto>("/sponsors", owner.token)).body;
    expect(done.active).toBeNull();
    expect(done.history[0]).toMatchObject({ status: "COMPLETED", progress: goal.count });
    const after = await wallet();
    expect(after.CREDITS).toBe(before.CREDITS + v.active!.reward);
    expect(after.REPUTATION).toBe(before.REPUTATION + v.active!.reputation);
    // Further runs do nothing.
    await t.db.tx((c) => svc.onRun(c, owner.userId, run, t.clock.now()));
    expect((await wallet()).CREDITS).toBe(after.CREDITS);
  });

  it("expires unfinished contracts when the week ends and offers new ones", async () => {
    const week = sponsorWeek(t.clock.now());
    t.clock.advance(sponsorWeekStart(week + 1).getTime() - t.clock.now().getTime() + 1000);
    const v = (await t.get<SponsorsDto>("/sponsors", owner.token)).body;
    expect(v.week).toBe(week + 1);
    expect(v.signedThisWeek).toBe(false);
    const s = (await t.post<SponsorsDto>(`/sponsors/${v.offers[0]!.code}/sign`, {}, owner.token)).body;
    // A full contract period from signing, whatever the day of the week.
    const period = defaultConfig.sponsors.contractDays * 86_400_000;
    const left = new Date(s.active!.expiresAt).getTime() - t.clock.now().getTime();
    expect(left).toBeGreaterThan(period - 60_000);
    expect(left).toBeLessThanOrEqual(period);
    t.clock.advance(defaultConfig.sponsors.contractDays * 86_400_000 + 1000);
    expect(await t.service(SponsorsService).expireDue()).toBe(1);
    const later = (await t.get<SponsorsDto>("/sponsors", owner.token)).body;
    expect(later.active).toBeNull();
    expect(later.history[0]!.status).toBe("EXPIRED");
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
