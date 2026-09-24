import type { StableDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GameConfigService } from "../src/common/game-config.js";
import { createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };

describe("admin console API", () => {
  let t: TestApp;
  let admin: User;
  let support: User;
  let player: User;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login(9801, "Econ");
    support = await t.login(9802, "Helper");
    player = await t.login(9803, "Rider");
    await t.db.query("UPDATE users SET role = 'ECONOMY_ADMIN' WHERE id = $1", [admin.userId]);
    await t.db.query("UPDATE users SET role = 'SUPPORT_ADMIN' WHERE id = $1", [support.userId]);
  });
  afterAll(() => t.close());

  it("keeps every console endpoint away from players", async () => {
    for (const url of ["/admin/users?q=u98", "/admin/audit", "/admin/config", "/admin/economy"])
      expect((await t.get(url, player.token)).status).toBe(403);
    expect((await t.post("/admin/config", { override: {}, note: "nope nope" }, player.token)).status).toBe(
      403,
    );
    // Support can search and read the audit log, but not change the economy.
    expect((await t.get("/admin/users?q=u98", support.token)).status).toBe(200);
    expect((await t.get("/admin/config", support.token)).status).toBe(403);
  });

  it("finds users by username, telegram id and stable name (LIKE-safe)", async () => {
    const byName = (await t.get<{ id: string }[]>("/admin/users?q=u9803", support.token)).body;
    expect(byName.map((u) => u.id)).toEqual([player.userId]);
    const byTg = (await t.get<{ id: string }[]>("/admin/users?q=9803", support.token)).body;
    expect(byTg.some((u) => u.id === player.userId)).toBe(true);
    const wildcard = (await t.get<unknown[]>("/admin/users?q=%25", support.token)).body;
    expect(wildcard).toEqual([]);
  });

  it("rejects malformed config overrides with the exact problems", async () => {
    const r = await t.post<{ error: { code: string; details: string[] } }>(
      "/admin/config",
      { override: { economy: { startingCredits: "many", free: 1 } }, note: "try a bad change" },
      admin.token,
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_CONFIG");
    expect(r.body.error.details).toEqual([
      "economy.startingCredits: expected a number",
      "economy.free: unknown setting",
    ]);
  });

  it("publishes a versioned override that applies live and is audited", async () => {
    const r = await t.post<{ version: number }>(
      "/admin/config",
      {
        override: { economy: { stableUpgradeCost: [2500, 12000, 35000, 90000] } },
        note: "cheaper first upgrade",
      },
      admin.token,
    );
    expect(r.status).toBe(201);
    expect(t.service(GameConfigService).get().economy.stableUpgradeCost[0]).toBe(2500);
    const stable = (await t.get<StableDto>("/stable", player.token)).body;
    expect(stable.nextUpgradeCost).toBe(2500);

    const cfg = (
      await t.get<{ version: number; history: { version: number; note: string }[] }>(
        "/admin/config",
        admin.token,
      )
    ).body;
    expect(cfg.version).toBe(r.body.version);
    expect(cfg.history[0]).toMatchObject({ version: r.body.version, note: "cheaper first upgrade" });

    const audit = (
      await t.get<{ action: string; reason: string; actor_name: string }[]>(
        "/admin/audit?limit=5",
        support.token,
      )
    ).body;
    expect(audit[0]).toMatchObject({
      action: "CONFIG_PUBLISH",
      reason: "cheaper first upgrade",
      actor_name: "u9801",
    });

    // Roll back to defaults by publishing an empty override.
    await t.post("/admin/config", { override: {}, note: "back to defaults" }, admin.token);
    expect((await t.get<StableDto>("/stable", player.token)).body.nextUpgradeCost).toBe(3000);
  });
});

describe("admin console — payments and races", () => {
  let t: TestApp;
  let finance: User;
  let game: User;
  let player: User;

  beforeAll(async () => {
    t = await createTestApp();
    finance = await t.login(9811, "Ledger");
    game = await t.login(9812, "Steward");
    player = await t.login(9813, "Punter");
    await t.db.query("UPDATE users SET role = 'FINANCE_ADMIN' WHERE id = $1", [finance.userId]);
    await t.db.query("UPDATE users SET role = 'GAME_ADMIN' WHERE id = $1", [game.userId]);
  });
  afterAll(() => t.close());

  it("lists payments for finance only", async () => {
    expect((await t.get("/admin/payments", game.token)).status).toBe(403);
    expect((await t.get("/admin/payments", player.token)).status).toBe(403);
    const r = await t.get<unknown[]>("/admin/payments?status=COMPLETED", finance.token);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect((await t.get("/admin/payments?status=LOST", finance.token)).status).toBe(400);
  });

  it("creates a special race (validated) and cancels it with refunds", async () => {
    const startsAt = new Date(t.clock.now().getTime() + 60 * 60_000).toISOString();
    const bad = await t.post<{ error: { code: string } }>(
      "/admin/races",
      { name: "Bad distance", class: "MAIDEN", trackCode: "GCS", distance: 1234, startsAt },
      game.token,
    );
    expect(bad.status).toBe(400);
    const tracks = (await import("@thoroughline/engine")).TRACKS;
    const track = tracks[0]!;
    const created = await t.post<{ id: string }>(
      "/admin/races",
      {
        name: "Steward's Cup",
        class: "MAIDEN",
        trackCode: track.code,
        distance: track.distances[0],
        startsAt,
        purse: 5000,
        entryFee: 50,
      },
      game.token,
    );
    expect(created.status).toBe(201);
    const listed = (
      await t.get<{ id: string; is_special: boolean }[]>("/admin/races?scope=upcoming", game.token)
    ).body;
    expect(listed.find((r) => r.id === created.body.id)?.is_special).toBe(true);

    const horse = (await t.get<{ id: string }[]>("/horses", player.token)).body[0]!;
    expect(
      (
        await t.post(
          `/races/${created.body.id}/entries`,
          { horseId: horse.id, strategy: "CLOSER" },
          player.token,
        )
      ).status,
    ).toBe(201);
    const before = (await t.get<{ balances: { CREDITS: number } }>("/wallet", player.token)).body.balances
      .CREDITS;
    const cancel = await t.post(
      `/admin/races/${created.body.id}/cancel`,
      { reason: "Track closed for maintenance" },
      game.token,
    );
    expect(cancel.status).toBe(201);
    const after = (await t.get<{ balances: { CREDITS: number } }>("/wallet", player.token)).body.balances
      .CREDITS;
    expect(after).toBe(before + 50);
  });
});
