import type { HorseSummaryDto, YardDto, YardEventDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("yard events", () => {
  let t: TestApp;
  let token: string;
  let userId: string;
  let horseId: string;
  const yard = async () => (await t.get<YardDto>("/yard", token)).body.events;
  const credits = async () =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", token)).body.balances.CREDITS;
  const horse = () =>
    t.db.one<{ fatigue: number; health: number; shoe_starts: number; next_start_injury: number }>(
      "SELECT fatigue, health, shoe_starts, next_start_injury FROM horses WHERE id = $1",
      [horseId],
    );
  /** Plant an event of a given kind (the natural ones are seeded by owner and time). */
  const plant = async (kind: string, window: number) =>
    (await t.db.one<{ id: string }>(
      `INSERT INTO yard_events (user_id, horse_id, kind, window_no, happened_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, horseId, kind, window, t.clock.now(), new Date(t.clock.now().getTime() + 12 * 3_600_000)],
    ))!.id;

  beforeAll(async () => {
    t = await createTestApp();
    ({ token, userId } = await t.login(9821, "Yardman"));
    horseId = (await t.get<HorseSummaryDto[]>("/horses", token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("a new owner settles in first; then events turn up about daily", async () => {
    expect(await yard()).toEqual([]);
    let seen = 0;
    for (let i = 0; i < 20; i++) {
      t.clock.advance(6 * 3_600_000);
      seen = (await yard()).length;
      if (seen) break;
    }
    expect(seen).toBeGreaterThan(0);
    const [ev] = await yard();
    expect(ev).toMatchObject({ horseId, choice: null, outcome: null });
    expect(["OFF_FEED", "CAST_IN_BOX"]).toContain(ev!.kind); // never raced: no shoe or leg events
    // Idempotent: looking again does not create another event in the same window.
    expect((await yard()).length).toBe(seen);
  });

  it("paying the vet costs credits and spares the horse", async () => {
    const id = await plant("OFF_FEED", -1);
    const before = await credits();
    const health = (await horse())!.health;
    const res = await t.post<YardEventDto>(`/yard/${id}/ACT`, {}, token);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ choice: "ACT", answered: true, actCost: 120 });
    expect(await credits()).toBe(before - 120);
    expect((await horse())!.health).toBeCloseTo(health, 0);
    expect((await t.post(`/yard/${id}/WAIT`, {}, token)).status).toBe(409);
  });

  it("waiting costs nothing but the horse pays for it", async () => {
    await t.db.query("UPDATE horses SET health = 100, condition_updated_at = $2 WHERE id = $1", [
      horseId,
      t.clock.now(),
    ]);
    const id = await plant("OFF_FEED", -2);
    const before = await credits();
    expect((await t.post(`/yard/${id}/WAIT`, {}, token)).status).toBe(201);
    expect(await credits()).toBe(before);
    expect((await horse())!.health).toBeCloseTo(88, 0);
  });

  it("untreated heat in a leg raises the next start's injury risk; a pulled shoe left waits", async () => {
    const heat = await plant("HEAT_IN_LEG", -3);
    await t.post(`/yard/${heat}/WAIT`, {}, token);
    expect((await horse())!.next_start_injury).toBeCloseTo(1.6);
    const shoe = await plant("LOST_SHOE", -4);
    await t.post(`/yard/${shoe}/WAIT`, {}, token);
    expect((await horse())!.shoe_starts).toBe(6);
    // The farrier's round is tomorrow, not now.
    const care = (
      await t.get<{ private: { care: { actions: { action: string; block: string | null }[] } } }>(
        `/horses/${horseId}`,
        token,
      )
    ).body.private.care;
    expect(care.actions.find((a) => a.action === "FARRIER")!.block).toBe("COOLDOWN");
  });

  it("an unanswered event settles on its own as WAIT once it expires", async () => {
    const id = await plant("HEAT_IN_LEG", -5);
    t.clock.advance(13 * 3_600_000);
    const ev = (await yard()).find((e) => e.id === id)!;
    expect(ev).toMatchObject({ choice: "WAIT", answered: false });
    expect((await t.post(`/yard/${id}/ACT`, {}, token)).status).toBe(409);
  });

  it("strangers cannot answer, and nonsense choices are refused", async () => {
    const id = await plant("CAST_IN_BOX", -6);
    const other = await t.login(9822, "Nosy");
    expect((await t.post(`/yard/${id}/ACT`, {}, other.token)).status).toBe(404);
    expect((await t.post(`/yard/${id}/PANIC`, {}, token)).status).toBe(400);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
