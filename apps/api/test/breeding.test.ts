import type {
  BreedingEventDto,
  BreedingPreviewDto,
  HorseDetailDto,
  PedigreeNodeDto,
  StudDto,
} from "@thoroughline/contracts";
import type { Sex } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BreedingService } from "../src/modules/breeding/breeding.service.js";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { HorseFactory } from "../src/modules/horses/horse.factory.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };

describe("breeding", () => {
  let t: TestApp;
  let alice: User;
  let bob: User;
  const credits = async (u: User) =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", u.token)).body.balances.CREDITS;

  /** Adult horse of a given sex for a user (tests bypass the sales ring). */
  const adult = async (u: User, sex: Sex, age = 4): Promise<string> => {
    const stable = await t.db.one<{ id: string }>("SELECT id FROM stables WHERE owner_id = $1", [u.userId]);
    const h = await t.db.tx((c) =>
      t.service(HorseFactory).generate(c, {
        quality: 0.6,
        age,
        ownerId: u.userId,
        stableId: stable!.id,
        isHouse: false,
        now: t.clock.now(),
      }),
    );
    await t.db.query("UPDATE horses SET sex = $2 WHERE id = $1", [h.id, sex]);
    return h.id;
  };
  const fund = (u: User, amount: number) =>
    t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: u.userId,
        currency: "CREDITS",
        amount,
        source: "ADMIN_ADJUSTMENT",
        key: `fund:${u.userId}:${Math.random()}`,
        type: "TEST",
      }),
    );

  beforeAll(async () => {
    t = await createTestApp();
    alice = await t.login(8001, "Alice");
    bob = await t.login(8002, "Bob");
    await t.db.query("UPDATE stables SET level = 4"); // 12 boxes: capacity is tested separately
    await fund(alice, 50_000);
    await fund(bob, 50_000);
  });
  afterAll(() => t.close());

  let stallion: string;
  let mare: string;
  let event: BreedingEventDto;

  it("previews and covers an owned pair, charging the breeding fee and putting the mare in foal", async () => {
    stallion = await adult(alice, "STALLION");
    mare = await adult(alice, "MARE");
    const prev = await t.get<BreedingPreviewDto>(
      `/breeding/preview?sireId=${stallion}&damId=${mare}`,
      alice.token,
    );
    expect(prev.body).toMatchObject({
      eligible: true,
      reasons: [],
      inbreeding: 0,
      cost: { breedingFee: 500, studFee: 0, total: 500 },
    });
    expect(prev.body.expectedStars).toBeGreaterThanOrEqual(1);

    const before = await credits(alice);
    const res = await t.post<BreedingEventDto>("/breeding", { sireId: stallion, damId: mare }, alice.token);
    expect(res.status).toBe(201);
    event = res.body;
    expect(event.status).toBe("PENDING");
    expect(await credits(alice)).toBe(before - 500);
    expect((await t.get<HorseDetailDto>(`/horses/${mare}`, alice.token)).body.status).toBe("BREEDING");
    expect(
      (await t.post(`/horses/${mare}/training`, { type: "SPEED", intensity: "NORMAL" }, alice.token)).status,
    ).toBe(409);
    const again = await t.post<{ error: { code: string } }>(
      "/breeding",
      { sireId: stallion, damId: mare },
      alice.token,
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("NOT_ELIGIBLE");
  });

  it("rejects wrong sexes, others' mares and self-breeding", async () => {
    const gelding = await adult(alice, "GELDING");
    const mare2 = await adult(alice, "MARE");
    const bad = await t.get<BreedingPreviewDto>(
      `/breeding/preview?sireId=${gelding}&damId=${mare2}`,
      alice.token,
    );
    expect(bad.body.eligible).toBe(false);
    expect(bad.body.reasons.join()).toMatch(/not a stallion/);
    expect((await t.get(`/breeding/preview?sireId=${stallion}&damId=${mare2}`, bob.token)).status).toBe(403);
    expect((await t.post("/breeding", { sireId: mare2, damId: mare2 }, alice.token)).status).toBe(400);
  });

  it("delivers the foal exactly once after gestation, with lineage and pedigree", async () => {
    const svc = t.service(BreedingService);
    expect(await svc.deliverDue()).toBe(0);
    t.clock.advance(24 * 3_600_000 + 1000);
    expect(await svc.deliverDue()).toBe(1);
    expect(await svc.deliver(event.id)).toBe(false);

    const mine = (await t.get<BreedingEventDto[]>("/breeding/mine", alice.token)).body.find(
      (e) => e.id === event.id,
    )!;
    expect(mine.status).toBe("DELIVERED");
    const foal = (await t.get<HorseDetailDto>(`/horses/${mine.foal!.id}`, alice.token)).body;
    expect(foal).toMatchObject({ ownerId: alice.userId, status: "IDLE" });
    expect(["COLT", "FILLY"]).toContain(foal.sex);
    expect(foal.age).toBeCloseTo(1, 0);
    const row = await t.db.one<{ sire_id: string; dam_id: string; generation: number; breeder_id: string }>(
      "SELECT sire_id, dam_id, generation, breeder_id FROM horses WHERE id = $1",
      [foal.id],
    );
    expect(row).toMatchObject({ sire_id: stallion, dam_id: mare, generation: 1, breeder_id: alice.userId });
    expect((await t.get<HorseDetailDto>(`/horses/${mare}`, alice.token)).body.status).toBe("IDLE");

    const tree = (await t.get<PedigreeNodeDto>(`/breeding/pedigree/${foal.id}`, bob.token)).body;
    expect(tree.sire?.id).toBe(stallion);
    expect(tree.dam?.id).toBe(mare);
    expect(tree.sire?.sire).toBeNull();
  });

  it("rests the mare after delivery and caps sire covers per week", async () => {
    const rest = await t.get<BreedingPreviewDto>(
      `/breeding/preview?sireId=${stallion}&damId=${mare}`,
      alice.token,
    );
    expect(rest.body.reasons.join()).toMatch(/resting/);
    // Two more covers with fresh mares use up the stallion's 3 weekly covers.
    for (let i = 0; i < 2; i++) {
      const m = await adult(alice, "MARE");
      expect((await t.post("/breeding", { sireId: stallion, damId: m }, alice.token)).status).toBe(201);
    }
    const m4 = await adult(alice, "MARE");
    const capped = await t.get<BreedingPreviewDto>(
      `/breeding/preview?sireId=${stallion}&damId=${m4}`,
      alice.token,
    );
    expect(capped.body.reasons.join()).toMatch(/no covers left/);
  });

  it("flags inbreeding when a parent is bred back to its foal", async () => {
    const foal = (await t.get<BreedingEventDto[]>("/breeding/mine", alice.token)).body.find(
      (e) => e.id === event.id,
    )!.foal!.id;
    await t.db.query(
      "UPDATE horses SET sex = 'MARE', birth_at = birth_at - interval '84 days' WHERE id = $1",
      [foal],
    );
    const p = await t.get<BreedingPreviewDto>(
      `/breeding/preview?sireId=${stallion}&damId=${foal}`,
      alice.token,
    );
    expect(p.body.inbreeding).toBeCloseTo(0.25, 3);
  });

  it("pays stud fees to the stallion owner minus the platform cut", async () => {
    const bobStallion = await adult(bob, "STALLION");
    expect((await t.post("/breeding/studs", { horseId: bobStallion, fee: 1000 }, alice.token)).status).toBe(
      403,
    );
    const bobMare = await adult(bob, "MARE");
    expect((await t.post("/breeding/studs", { horseId: bobMare, fee: 1000 }, bob.token)).status).toBe(409);
    const offer = await t.post<StudDto>("/breeding/studs", { horseId: bobStallion, fee: 1000 }, bob.token);
    expect(offer.status).toBe(201);
    expect(offer.body).toMatchObject({ fee: 1000, mine: true, coversThisWeek: 0 });
    const list = await t.get<StudDto[]>("/breeding/studs", alice.token);
    expect(list.body.map((s) => s.horse.id)).toContain(bobStallion);

    await t.db.query("UPDATE stables SET level = 5 WHERE owner_id = $1", [alice.userId]); // 20 boxes
    const aliceMare = await adult(alice, "MARE");
    const [aBefore, bBefore] = [await credits(alice), await credits(bob)];
    const prev = await t.get<BreedingPreviewDto>(
      `/breeding/preview?sireId=${bobStallion}&damId=${aliceMare}`,
      alice.token,
    );
    expect(prev.body.cost).toEqual({ breedingFee: 500, studFee: 1000, total: 1500 });
    expect(prev.body.reasons).toEqual([]);
    const covered = await t.post<{ error?: { message: string } }>(
      "/breeding",
      { sireId: bobStallion, damId: aliceMare },
      alice.token,
    );
    expect(covered.body.error?.message).toBeUndefined();
    expect(covered.status).toBe(201);
    expect(await credits(alice)).toBe(aBefore - 1500);
    expect(await credits(bob)).toBe(bBefore + 940);

    // Withdrawn studs are no longer available to others.
    expect((await t.del(`/breeding/studs/${bobStallion}`, bob.token)).status).toBe(204);
    const m2 = await adult(alice, "MARE");
    const closed = await t.get<BreedingPreviewDto>(
      `/breeding/preview?sireId=${bobStallion}&damId=${m2}`,
      alice.token,
    );
    expect(closed.body.reasons.join()).toMatch(/not standing at stud/);
  });

  it("requires a free box for every foal on the way", async () => {
    const carol = await t.login(8003, "Carol"); // level-1 stable: 3 boxes, 1 starter horse
    await fund(carol, 10_000);
    const s = await adult(carol, "STALLION");
    const m = await adult(carol, "MARE"); // 3/3 boxes used
    const p = await t.get<BreedingPreviewDto>(`/breeding/preview?sireId=${s}&damId=${m}`, carol.token);
    expect(p.body.reasons.join()).toMatch(/No free box/);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
