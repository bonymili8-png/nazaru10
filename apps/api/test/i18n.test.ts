import type { StableDto, UserDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { langOf, ukPlural } from "../src/common/i18n.js";
import { signInitData } from "../src/modules/auth/telegram-init-data.js";
import { NotificationsService } from "../src/modules/notifications/notifications.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("language", () => {
  let t: TestApp;
  let user: { token: string; userId: string };
  const TG_ID = 7301;
  const hook = (update: unknown) =>
    t.post("/telegram/webhook", update, undefined, {
      "x-telegram-bot-api-secret-token": t.env.TELEGRAM_WEBHOOK_SECRET,
    });
  const lastMessage = () => String(t.bot.calls.filter((c) => c.method === "sendMessage").at(-1)!.args[1]);

  beforeAll(async () => {
    t = await createTestApp();
    user = await t.login(TG_ID, "Oksana");
  });
  afterAll(() => t.close());

  it("resolves the language: explicit choice, then Telegram, then English", () => {
    expect(langOf("uk")).toBe("uk");
    expect(langOf("uk-UA")).toBe("uk");
    expect(langOf("de")).toBe("en");
    expect(langOf(null)).toBe("en");
    expect(langOf("uk", "en")).toBe("en");
    expect(langOf("en", "uk")).toBe("uk");
    expect([1, 3, 5, 11, 21, 22, 25].map((n) => ukPlural(n, "a", "b", "c")).join("")).toBe("abccabc");
  });

  it("stores the language and notification preference", async () => {
    const me = (await t.get<UserDto>("/me", user.token)).body;
    expect(me.settings).toEqual({ locale: null, notifications: true });

    const set = await t.put<UserDto>("/me/settings", { locale: "uk" }, user.token);
    expect(set.status).toBe(200);
    expect(set.body.settings).toEqual({ locale: "uk", notifications: true });

    const off = await t.put<UserDto>("/me/settings", { notifications: false }, user.token);
    expect(off.body.settings).toEqual({ locale: "uk", notifications: false });

    // null goes back to following the Telegram language.
    const reset = await t.put<UserDto>("/me/settings", { locale: null, notifications: true }, user.token);
    expect(reset.body.settings).toEqual({ locale: null, notifications: true });

    for (const bad of [{}, { locale: "fr" }, { locale: "uk", theme: "dark" }])
      expect((await t.put("/me/settings", bad, user.token)).status).toBe(400);
  });

  it("answers bot commands in the player's language", async () => {
    await hook({
      update_id: 1,
      message: { chat: { id: 1 }, from: { id: 991, language_code: "uk" }, text: "/help" },
    });
    expect(lastMessage()).toContain("Команди");
    await hook({
      update_id: 2,
      message: { chat: { id: 1 }, from: { id: 992, language_code: "en" }, text: "/help" },
    });
    expect(lastMessage()).toContain("Commands");

    // An in-app choice beats the Telegram client language.
    await t.put("/me/settings", { locale: "uk" }, user.token);
    await hook({
      update_id: 3,
      message: { chat: { id: TG_ID }, from: { id: TG_ID, language_code: "en" }, text: "/terms" },
    });
    expect(lastMessage()).toContain("Умови покупок");
    expect(lastMessage()).toContain("не мають грошової вартості");
  });

  it("registers the command menu for Ukrainian clients too", () => {
    const calls = t.bot.calls.filter((c) => c.method === "setMyCommands");
    expect(calls.map((c) => c.args[1])).toEqual([undefined, "uk"]);
    const uk = calls[1]!.args[0] as { description: string }[];
    expect(uk[0]!.description).toBe("Відкрити стайню");
  });

  it("sends notifications in the player's language", async () => {
    await t.db.query(
      `INSERT INTO domain_events (type, aggregate_type, aggregate_id, payload) VALUES ('race_result', 'race', 'r1', $1)`,
      [
        JSON.stringify({
          userId: user.userId,
          horseName: "Буревій",
          raceName: "Kyiv Mile",
          position: 2,
          field: 8,
          prize: 1250,
          injury: "MINOR",
        }),
      ],
    );
    expect(await t.service(NotificationsService).processOutbox()).toBe(1);
    const text = lastMessage();
    expect(text).toContain("<b>Буревій</b>: 2-є місце з 8");
    expect(text).toMatch(/виграш 1\s250 кредитів/);
    expect(text).toContain("легку травму");

    const svc = t.service(NotificationsService);
    const en = svc.render({
      id: 0,
      type: "market_outbid",
      payload: { userId: "u", horseName: "X", amount: 1 },
    });
    expect(en!.text).toContain("You were outbid");
    const uk = svc.render(
      { id: 0, type: "market_outbid", payload: { userId: "u", horseName: "X", amount: 3 } },
      "uk",
    );
    expect(uk!.text).toContain("3 кредити");
  });

  it("names a Ukrainian player's first stable in Ukrainian", async () => {
    const { token } = await loginWithLanguage(t, 7302, "Тарас", "uk");
    expect((await t.get<StableDto>("/stable", token)).body.name).toBe("Стайня Тарас");
  });
});

/** Like TestApp.login, but with a Telegram client language. */
async function loginWithLanguage(t: TestApp, id: number, firstName: string, languageCode: string) {
  const initData = signInitData(
    {
      auth_date: String(Math.floor(t.clock.now().getTime() / 1000)),
      query_id: `q${id}`,
      user: JSON.stringify({ id, first_name: firstName, language_code: languageCode }),
    },
    t.env.TELEGRAM_BOT_TOKEN,
  );
  const res = await t.post<{ token: string }>("/auth/telegram", { initData });
  expect(res.status).toBe(200);
  return res.body;
}
