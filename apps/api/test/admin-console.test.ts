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
