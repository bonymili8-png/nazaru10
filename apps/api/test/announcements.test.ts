import type { AnnouncementDto, ShopHorseDto } from "@thoroughline/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnnouncementsService } from "../src/modules/notifications/announcements.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("announcements to every player", () => {
  let t: TestApp;
  let admin: { token: string; userId: string };
  const players: { token: string; userId: string; telegramId: number }[] = [];
  const svc = () => t.service(AnnouncementsService);
  const messages = () =>
    t.bot.calls
      .filter((c) => c.method === "sendMessage")
      .map((c) => ({
        chatId: c.args[0] as number,
        text: c.args[1] as string,
        buttons: c.args[2] as { text: string; web_app: { url: string } }[][] | undefined,
      }));
  const list = async () => (await t.get<AnnouncementDto[]>("/admin/announcements", admin.token)).body;
  const drop = (body: Record<string, unknown>) =>
    t.post<ShopHorseDto>(
      "/admin/limited-horses",
      { rarity: "LEGENDARY", quality: 0.9, price: 15000, hours: 24, ...body },
      admin.token,
    );
  /** Past the minute an announcement waits for siblings, then send everything due. */
  const flush = async () => {
    t.clock.advance(61_000);
    return svc().run();
  };

  beforeAll(async () => {
    process.env.WEBAPP_URL = "https://game.example.com";
    t = await createTestApp();
    svc().pauseMs = 0;
    admin = await t.login(9901, "Boss");
    await t.db.query("UPDATE users SET role = 'GAME_ADMIN' WHERE id = $1", [admin.userId]);
    for (const id of [9902, 9903, 9904]) players.push({ ...(await t.login(id, `P${id}`)), telegramId: id });
    // One plays in Ukrainian, one turned the news off.
    await t.db.query(`UPDATE users SET settings = settings || '{"locale":"uk"}' WHERE telegram_id = 9903`);
    const off = await t.put<{ settings: { announcements: boolean } }>(
      "/me/settings",
      { announcements: false },
      players[2]!.token,
    );
    expect(off.body.settings.announcements).toBe(false);
    t.bot.calls.length = 0;
  });
  afterAll(async () => {
    delete process.env.WEBAPP_URL;
    await t.close();
  });

  it("tells every player once about horses listed together, in their language", async () => {
    const a = await drop({});
    const b = await drop({});
    expect(a.status).toBe(201);
    // Waits a minute for more items: nothing yet.
    expect(await svc().run()).toBe(0);
    let l = await list();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ kind: "SHOP_HORSES", status: "WAITING", items: [a.body.name, b.body.name] });

    const sent = await flush();
    const msgs = messages();
    // The admin and two players; the third turned the news off.
    expect(sent).toBe(3);
    expect(msgs.map((m) => m.chatId).sort()).toEqual([9901, 9902, 9903]);
    const en = msgs.find((m) => m.chatId === 9902)!;
    expect(en.text).toContain("New horses in the shop — limited offer!");
    expect(en.text).toContain(`🌟 Legendary horse <b>${a.body.name}</b> — <b>15,000 credits</b> · 24 h left`);
    expect(en.text).toContain(b.body.name);
    expect(en.buttons?.[0]?.[0]).toEqual({
      text: "🛒 Open the shop",
      web_app: { url: "https://game.example.com/shop/" },
    });
    const uk = msgs.find((m) => m.chatId === 9903)!;
    expect(uk.text).toContain("Нові коні в магазині — обмежена пропозиція!");
    expect(uk.text).toContain("Легендарний кінь");
    expect(uk.text).toContain("ще 24 год");
    l = await list();
    expect(l[0]).toMatchObject({ status: "SENT", sent: 3, skipped: 1, failed: 0 });
    // Never twice.
    expect(await flush()).toBe(0);
  });

  it("leaves out a horse sold before the message goes out, and drops a listing made quietly", async () => {
    t.bot.calls.length = 0;
    const a = await drop({ rarity: "EPIC", price: 9000 });
    const b = await drop({ rarity: "RARE", price: 5000 });
    // Someone buys the epic one straight away.
    await t.db.query("UPDATE horses SET is_house = false, sale_price = NULL, owner_id = $2 WHERE id = $1", [
      a.body.id,
      players[0]!.userId,
    ]);
    // Listed without telling anyone.
    const quiet = await drop({ notify: false });
    expect(quiet.status).toBe(201);
    await flush();
    const msg = messages().find((m) => m.chatId === 9902)!;
    expect(msg.text).toContain(`🔷 Rare horse <b>${b.body.name}</b>`);
    expect(msg.text).toContain("A new horse in the shop");
    expect(msg.text).not.toContain(a.body.name);
    expect(msg.text).not.toContain(quiet.body.name);
    expect((await list())[0]!.items).toEqual([a.body.name, b.body.name]);
  });

  it("announces a special race with its purse and start, linking to its page", async () => {
    t.bot.calls.length = 0;
    const startsAt = new Date(t.clock.now().getTime() + 3 * 3_600_000).toISOString();
    const r = await t.post<{ id: string }>(
      "/admin/races",
      {
        name: "Autumn Gold Cup",
        class: "CLASS_3",
        trackCode: "EUROTURF",
        distance: 1600,
        startsAt,
        purse: 50000,
      },
      admin.token,
    );
    expect(r.status).toBe(201);
    await flush();
    const en = messages().find((m) => m.chatId === 9902)!;
    expect(en.text).toContain("A new special race!");
    expect(en.text).toContain("<b>Autumn Gold Cup</b>");
    expect(en.text).toContain("Class 3 · ");
    expect(en.text).toContain("Purse: <b>50,000 credits</b>");
    expect(en.text).toMatch(/Off in 2 h 5\d min|Off in 3 h/);
    expect(en.buttons?.[0]?.[0]?.web_app.url).toBe(`https://game.example.com/race/?id=${r.body.id}`);
    const uk = messages().find((m) => m.chatId === 9903)!;
    expect(uk.text).toContain("Новий спеціальний забіг!");
    expect(uk.text).toContain("Призовий фонд");
  });

  it("can be stopped from the console before it goes out; players cannot see the list", async () => {
    t.bot.calls.length = 0;
    await drop({});
    const waiting = (await list())[0]!;
    expect(waiting.status).toBe("WAITING");
    const stopped = await t.post<AnnouncementDto[]>(
      `/admin/announcements/${waiting.id}/cancel`,
      {},
      admin.token,
    );
    expect(stopped.status).toBe(200);
    expect(stopped.body[0]!.status).toBe("STOPPED");
    expect(await flush()).toBe(0);
    expect(messages()).toHaveLength(0);
    expect((await t.post(`/admin/announcements/${waiting.id}/cancel`, {}, admin.token)).status).toBe(409);
    expect((await t.get("/admin/announcements", players[1]!.token)).status).toBe(403);
  });

  it("on release, announces the horses already on limited sale (once)", async () => {
    t.bot.calls.length = 0;
    await t.db.query("UPDATE announcements SET done_at = now() WHERE done_at IS NULL");
    // Listed before announcements existed (quietly here), ending in about a day; one ends too soon.
    const a = await drop({ notify: false });
    const b = await drop({ notify: false });
    const soon = await drop({ notify: false, hours: 1 });
    await t.db.query(
      "UPDATE horses SET sale_ends_at = now() + interval '20 hours' WHERE id = ANY($1::uuid[])",
      [[a.body.id, b.body.id]],
    );
    await t.db.query("UPDATE horses SET sale_ends_at = now() + interval '30 minutes' WHERE id = $1", [
      soon.body.id,
    ]);
    const sql = readFileSync(join(__dirname, "../migrations/0056_announcements.up.sql"), "utf8");
    await t.db.query(sql.slice(sql.indexOf("INSERT INTO announcements")));
    const l = await list();
    expect(l[0]).toMatchObject({ kind: "SHOP_HORSES", status: "WAITING" });
    expect(l[0]!.items).toEqual(expect.arrayContaining([a.body.name, b.body.name]));
    expect(l[0]!.items).not.toContain(soon.body.name);
  });
});
