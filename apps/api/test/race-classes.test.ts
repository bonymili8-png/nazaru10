import type { HorseSummaryDto, RaceDetailDto, RaceSummaryDto } from "@thoroughline/contracts";
import { defaultConfig, RACE_CLASSES, type RaceClass } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

/** Entry at every class boundary, checked against the server (the source of truth). */
describe("race class eligibility", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  const races = new Map<RaceClass, RaceSummaryDto>();
  // One owner (and horse) per class keeps each under the per-user mutation rate limit.
  const owners = new Map<RaceClass, { token: string; horse: string }>();

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(4101, "Olena");
    for (const [i, c] of RACE_CLASSES.entries()) {
      const u = await t.login(4110 + i, `Owner ${c}`);
      owners.set(c, {
        token: u.token,
        horse: (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!.id,
      });
    }
    // Every class needs an open race; near a card's lock time one may briefly be missing, so
    // step the clock until the schedule has one of each (independent of the time of day).
    const runner = t.service(RaceRunnerService);
    for (let tries = 0; races.size < RACE_CLASSES.length && tries < 20; tries++) {
      if (tries > 0) t.clock.advance(3 * 60_000);
      races.clear();
      await runner.scheduleAhead();
      for (const c of RACE_CLASSES) {
        const list = await t.get<RaceSummaryDto[]>(`/races?status=upcoming&class=${c}&limit=5`, owner.token);
        const open = list.body.find(
          (r) => r.status === "OPEN" && new Date(r.locksAt).getTime() > t.clock.now().getTime() + 60_000,
        );
        if (open) races.set(c, open);
      }
    }
  });
  afterAll(() => t.close());

  /** Try to enter at a given rating and win count; withdraws again on success. */
  async function tryEnter(c: RaceClass, rating: number, wins: number): Promise<string> {
    const { token, horse } = owners.get(c)!;
    await t.db.query(
      "UPDATE horses SET race_rating = $2, wins = $3, seconds = 0, thirds = 0, starts = $3 WHERE id = $1",
      [horse, rating, wins],
    );
    const race = races.get(c)!;
    const res = await t.post<{ error?: { code: string } }>(
      `/races/${race.id}/entries`,
      { horseId: horse, strategy: "MID_PACK" },
      token,
    );
    if (res.status !== 201) return res.body.error!.code;
    expect((await t.del(`/races/${race.id}/entries/${horse}`, token)).status).toBe(200);
    // A withdrawn entry keeps its row (one entry per horse per race); clear it to probe again.
    await t.db.query("DELETE FROM race_entries WHERE race_id = $1 AND horse_id = $2", [race.id, horse]);
    return "OK";
  }

  it("publishes each class's band on the race card", async () => {
    for (const c of RACE_CLASSES) {
      const d = (await t.get<RaceDetailDto>(`/races/${races.get(c)!.id}`, owner.token)).body;
      const cc = defaultConfig.race.classes[c];
      expect(d.eligibility, c).toEqual({
        minRating: cc.minRating,
        maxRating: cc.maxRating,
        maidenOnly: cc.maidenOnly,
      });
    }
  });

  it("admits exactly the ratings inside each band", async () => {
    const cases: [RaceClass, number, string][] = [
      ["CLASS_5", 700, "OK"],
      ["CLASS_5", 1099, "OK"],
      ["CLASS_5", 1100, "RATING_TOO_HIGH"],
      ["CLASS_4", 1099, "RATING_TOO_LOW"],
      ["CLASS_4", 1100, "OK"],
      ["CLASS_4", 1199, "OK"],
      ["CLASS_4", 1200, "RATING_TOO_HIGH"],
      ["CLASS_3", 1199, "RATING_TOO_LOW"],
      ["CLASS_3", 1200, "OK"],
      ["CLASS_3", 1299, "OK"],
      ["CLASS_3", 1300, "RATING_TOO_HIGH"],
      ["CLASS_2", 1299, "RATING_TOO_LOW"],
      ["CLASS_2", 1300, "OK"],
      ["CLASS_2", 1399, "OK"],
      ["CLASS_2", 1400, "RATING_TOO_HIGH"],
      ["CLASS_1", 1399, "RATING_TOO_LOW"],
      ["CLASS_1", 1400, "OK"],
      ["CLASS_1", 2200, "OK"],
    ];
    for (const [c, rating, want] of cases)
      expect(await tryEnter(c, rating, 2), `${c} @ ${rating}`).toBe(want);
  });

  it("opens maiden races to any rating, but only before the first win", async () => {
    expect(await tryEnter("MAIDEN", 900, 0)).toBe("OK");
    expect(await tryEnter("MAIDEN", 1300, 0)).toBe("OK");
    expect(await tryEnter("MAIDEN", 1000, 1)).toBe("NOT_A_MAIDEN");
  });

  it("keeps the ledger balanced (every entry refunded)", async () => {
    await assertLedgerIntegrity(t.db);
    for (const { token } of owners.values()) {
      const wallet = await t.get<{ balances: { CREDITS: number } }>("/wallet", token);
      expect(wallet.body.balances.CREDITS).toBe(defaultConfig.economy.startingCredits);
    }
  });
});
