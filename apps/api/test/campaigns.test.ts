import type { CampaignDto, HorseSummaryDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("campaign links", () => {
  let t: TestApp;
  let admin: { token: string; userId: string };
  let player: { token: string; userId: string };
  let link: CampaignDto;
  const list = async (q = "") => (await t.get<CampaignDto[]>(`/admin/campaigns${q}`, admin.token)).body;
  const funnel = async (q = "") => (await list(q)).find((c) => c.id === link.id)!.funnel;
  const click = (code: string, ip: string) =>
    t.post<{ startParam: string | null }>(`/public/campaigns/${code}/click`, {}, undefined, {
      "x-forwarded-for": ip,
      "user-agent": "test-browser",
    });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login(9881, "Marketer");
    player = await t.login(9882, "Existing");
    await t.db.query("UPDATE users SET role = 'CONTENT_ADMIN' WHERE id = $1", [admin.userId]);
  });
  afterAll(() => t.close());

  it("only the team can create and read campaign links", async () => {
    expect((await t.get("/admin/campaigns", player.token)).status).toBe(403);
    expect((await t.post("/admin/campaigns", { name: "Nope" }, player.token)).status).toBe(403);
  });

  it("creates a link per partner, with a generated or custom code", async () => {
    const gen = await t.post<CampaignDto>(
      "/admin/campaigns",
      { name: "TG chat", platform: "TELEGRAM" },
      admin.token,
    );
    expect(gen.status).toBe(201);
    expect(gen.body.code).toMatch(/^[A-Z0-9]{6}$/);
    const res = await t.post<CampaignDto>(
      "/admin/campaigns",
      { name: "UK Racing FB group", partner: "John (admin)", platform: "FACEBOOK", code: "ukrace" },
      admin.token,
    );
    expect(res.status).toBe(201);
    link = res.body;
    expect(link).toMatchObject({
      code: "UKRACE",
      startParam: "c_UKRACE",
      partner: "John (admin)",
      archived: false,
    });
    expect(
      (
        await t.post<{ error: { code: string } }>(
          "/admin/campaigns",
          { name: "Dup", code: "UKRACE" },
          admin.token,
        )
      ).body.error.code,
    ).toBe("CODE_TAKEN");
  });

  it("counts visits to the tracked link, and distinct visitors", async () => {
    expect((await click("UKRACE", "203.0.113.5")).body.startParam).toBe("c_UKRACE");
    await click("UKRACE", "203.0.113.5");
    await click("UKRACE", "198.51.100.7");
    expect((await click("NOSUCH", "203.0.113.5")).body.startParam).toBeNull();
    expect(await funnel()).toMatchObject({ clicks: 3, visitors: 2 });
  });

  it("follows the players it brought in: opened, first race, came back, paid", async () => {
    const fresh = await t.login(9883, "Newcomer", "c_UKRACE");
    await t.login(9882, "Existing", "c_UKRACE"); // an existing player opens it too
    let f = await funnel();
    expect(f).toMatchObject({ opened: 2, newPlayers: 1, firstRace: 0, payers: 0, active7d: 1 });

    // A first race, a visit the next day, and a gem purchase.
    await t.service(RaceRunnerService).scheduleAhead();
    const race = await t.db.one<{ id: string }>("SELECT id FROM races ORDER BY starts_at LIMIT 1");
    const horse = (await t.get<HorseSummaryDto[]>("/horses", fresh.token)).body[0]!.id;
    await t.db.query(
      "INSERT INTO race_entries (race_id, horse_id, owner_id, strategy, status) VALUES ($1, $2, $3, 'CLOSER', 'RAN')",
      [race!.id, horse, fresh.userId],
    );
    await t.db.query("INSERT INTO user_activity (user_id, day) VALUES ($1, current_date + 1)", [
      fresh.userId,
    ]);
    await t.db.query(
      `INSERT INTO payments (user_id, provider, product_id, amount, currency, status, provider_charge_id, completed_at)
       VALUES ($1, 'TELEGRAM_STARS', 'GEMS_550', 250, 'XTR', 'COMPLETED', 'charge-test-1', now())`,
      [fresh.userId],
    );
    f = await funnel();
    expect(f).toMatchObject({ newPlayers: 1, firstRace: 1, returned: 1, payers: 1, stars: 250 });
  });

  it("a player is acquired once: a second link counts the open, not a new player", async () => {
    const other = (
      await t.post<CampaignDto>("/admin/campaigns", { name: "Insta", platform: "INSTAGRAM" }, admin.token)
    ).body;
    await t.login(9883, "Newcomer", `c_${other.code}`);
    const o = (await list()).find((c) => c.id === other.id)!.funnel;
    expect(o).toMatchObject({ opened: 1, newPlayers: 0 });
  });

  it("filters by period and stops counting once archived", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(await funnel(`?from=${encodeURIComponent(future)}`)).toMatchObject({
      clicks: 0,
      opened: 0,
      newPlayers: 0,
    });
    expect(
      (await t.post<CampaignDto>(`/admin/campaigns/${link.id}/archive`, {}, admin.token)).body.archived,
    ).toBe(true);
    expect((await click("UKRACE", "192.0.2.9")).body.startParam).toBeNull();
    expect((await funnel()).clicks).toBe(3);
    const audit = await t.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'CAMPAIGN_%' AND actor_id = $1",
      [admin.userId],
    );
    expect(audit!.n).toBeGreaterThanOrEqual(4);
  });
});
