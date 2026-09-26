import type { CosmeticsDto, HorseSummaryDto, RaceSummaryDto, RacingPassDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { PassService } from "../src/modules/pass/pass.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { TrainingService } from "../src/modules/training/training.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("Racing Pass", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  const cfg = defaultConfig.pass;
  const view = async () => (await t.get<RacingPassDto>("/pass", owner.token)).body;
  const claim = (tier: number, track: "FREE" | "PREMIUM") =>
    t.post<RacingPassDto>("/pass/claim", { tier, track }, owner.token);

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(9981, "Passer");
  });
  afterAll(() => t.close());

  it("earns XP from training and races, once per source", async () => {
    expect((await view()).xp).toBe(0);
    const horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!;
    await t.post(`/horses/${horse.id}/training`, { type: "MENTAL", intensity: "LIGHT" }, owner.token);
    t.clock.advance(2 * 3_600_000);
    await t.service(TrainingService).settleAllDue();
    expect((await view()).xp).toBe(cfg.xp.training);

    // A training injury (rare) would block the entry; condition is not what this test checks.
    await t.db.query(
      "UPDATE horses SET status = 'IDLE', injured_until = NULL, health = 100, fatigue = 0, condition_updated_at = $2 WHERE id = $1",
      [horse.id, t.clock.now()],
    );
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN", owner.token)).body[0]!;
    expect(
      (await t.post(`/races/${race.id}/entries`, { horseId: horse.id, strategy: "MID_PACK" }, owner.token))
        .status,
    ).toBe(201);
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    await runner.runDue();
    t.clock.advance(5 * 60_000);
    await runner.settleDue();
    const pos = await t.db.one<{ position: number }>(
      "SELECT position FROM race_entries WHERE race_id = $1 AND horse_id = $2",
      [race.id, horse.id],
    );
    const expected = cfg.xp.training + t.service(PassService).raceXp(pos!.position);
    expect((await view()).xp).toBe(expected);
    // Replaying the same award does nothing.
    await t.db.tx((c) =>
      t.service(PassService).addXp(c, owner.userId, `race:${race.id}:${horse.id}`, 999, t.clock.now()),
    );
    expect((await view()).xp).toBe(expected);
  });

  it("gates rewards by tier and premium; free rewards pay gems once", async () => {
    expect((await claim(2, "FREE")).status).toBe(409);
    await t.db.tx((c) =>
      t.service(PassService).addXp(c, owner.userId, "test:boost", cfg.xpPerTier * cfg.tiers, t.clock.now()),
    );
    const v = await view();
    expect(v.tier).toBe(cfg.tiers);
    const before = v.gems;
    const r = await claim(2, "FREE");
    expect(r.status).toBe(201);
    expect(r.body.gems).toBe(before + cfg.free["2"]!.gems!);
    expect((await claim(2, "FREE")).status).toBe(409);
    expect((await claim(4, "FREE")).status).toBe(400); // no reward on this tier
    expect((await claim(5, "PREMIUM")).status).toBe(409); // premium required
  });

  it("sells the premium track for gems and grants pass-exclusive silks", async () => {
    expect((await t.post("/pass/premium", {}, owner.token)).status).toBe(409); // not enough gems
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "GEMS",
        amount: cfg.premiumPriceGems,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gems:passer",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
    const gemsBefore = (await view()).gems;
    const bought = await t.post<RacingPassDto>("/pass/premium", {}, owner.token);
    expect(bought.status).toBe(201);
    expect(bought.body.premium).toBe(true);
    expect(bought.body.gems).toBe(gemsBefore - cfg.premiumPriceGems);
    expect((await t.post("/pass/premium", {}, owner.token)).status).toBe(409);

    // Exclusive silks cannot be bought, only earned.
    expect((await t.post("/cosmetics/silks/patterns/CHEVRON/unlock", {}, owner.token)).status).toBe(409);
    expect((await claim(5, "PREMIUM")).status).toBe(201);
    const c = (await t.get<CosmeticsDto>("/cosmetics", owner.token)).body;
    expect(c.patterns.find((p) => p.pattern === "CHEVRON")).toMatchObject({ owned: true, priceGems: null });
    expect(
      (
        await t.put(
          "/cosmetics/silks",
          { pattern: "CHEVRON", primary: "navy", secondary: "gold" },
          owner.token,
        )
      ).status,
    ).toBe(200);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
