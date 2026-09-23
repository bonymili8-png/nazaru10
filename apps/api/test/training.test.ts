import type { HorseDetailDto, HorseSummaryDto, TrainingSessionDto } from "@thoroughline/contracts";
import { TRAINABLE_ATTRIBUTES } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TrainingService } from "../src/modules/training/training.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("training", () => {
  let t: TestApp;
  let token: string;
  let horseId: string;
  beforeAll(async () => {
    t = await createTestApp();
    token = (await t.login(3001)).token;
    horseId = (await t.get<HorseSummaryDto[]>("/horses", token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("validates input", async () => {
    expect(
      (await t.post(`/horses/${horseId}/training`, { type: "TELEPORT", intensity: "NORMAL" }, token)).status,
    ).toBe(400);
    expect(
      (await t.post(`/horses/not-a-uuid/training`, { type: "SPEED", intensity: "NORMAL" }, token)).status,
    ).toBe(400);
  });

  it("forbids training someone else's horse", async () => {
    const other = await t.login(3002);
    expect(
      (await t.post(`/horses/${horseId}/training`, { type: "SPEED", intensity: "NORMAL" }, other.token))
        .status,
    ).toBe(403);
  });

  it("starts exactly one session under concurrent requests and charges once", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.post<TrainingSessionDto>(
          `/horses/${horseId}/training`,
          { type: "SPEED", intensity: "NORMAL" },
          token,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    const wallet = await t.get<{ balances: { CREDITS: number } }>("/wallet", token);
    expect(wallet.body.balances.CREDITS).toBe(5000 - 100);
    const detail = await t.get<HorseDetailDto>(`/horses/${horseId}`, token);
    expect(detail.body.status).toBe("TRAINING");
    expect(detail.body.private!.activeTraining).not.toBeNull();
  });

  it("applies results only after the session ends, within genetic ceilings", async () => {
    const before = (await t.get<HorseDetailDto>(`/horses/${horseId}`, token)).body.private!;
    expect(await t.service(TrainingService).settleAllDue()).toBe(0);
    t.clock.advance(61 * 60_000);
    const after = (await t.get<HorseDetailDto>(`/horses/${horseId}`, token)).body;
    expect(after.status === "IDLE" || after.status === "INJURED").toBe(true);
    expect(after.private!.attributes.speed).toBeGreaterThan(before.attributes.speed);
    const h = await t.db.one<{
      genome: { ceilings: Record<string, number> };
      attributes: Record<string, number>;
    }>("SELECT genome, attributes FROM horses WHERE id = $1", [horseId]);
    for (const a of TRAINABLE_ATTRIBUTES)
      expect(h!.attributes[a]).toBeLessThanOrEqual(h!.genome.ceilings[a]!);
    expect(await t.service(TrainingService).settleAllDue()).toBe(0);
    const quests = await t.get<{ code: string; completed: boolean }[]>("/quests", token);
    expect(quests.body.find((q) => q.code === "FIRST_TRAINING")!.completed).toBe(true);
  });

  it("refuses to train an exhausted horse but allows recovery", async () => {
    await t.db.query(
      "UPDATE horses SET fatigue = 95, status = 'IDLE', injured_until = NULL, condition_updated_at = $2 WHERE id = $1",
      [horseId, t.clock.now()],
    );
    const res = await t.post<{ error: { code: string } }>(
      `/horses/${horseId}/training`,
      { type: "SPEED", intensity: "HARD" },
      token,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TOO_FATIGUED");
    expect(
      (await t.post(`/horses/${horseId}/training`, { type: "RECOVERY", intensity: "NORMAL" }, token)).status,
    ).toBe(201);
  });

  it("fatigue recovers lazily over time", async () => {
    t.clock.advance(3 * 3_600_000);
    await t.service(TrainingService).settleAllDue();
    const a = (await t.get<HorseDetailDto>(`/horses/${horseId}`, token)).body.private!.condition.fatigue;
    t.clock.advance(5 * 3_600_000);
    const b = (await t.get<HorseDetailDto>(`/horses/${horseId}`, token)).body.private!.condition.fatigue;
    expect(b).toBeLessThan(a);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
