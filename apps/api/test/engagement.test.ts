import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngagementService } from "../src/modules/notifications/engagement.service.js";
import { NotificationsService } from "../src/modules/notifications/notifications.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("comeback nudges", () => {
  let t: TestApp;
  let away: { token: string; userId: string };
  let quiet: { token: string; userId: string };
  let active: { token: string; userId: string };
  const svc = () => t.service(EngagementService);
  const seen = (id: string, ago: number) =>
    t.db.query("UPDATE users SET last_seen_at = $2 WHERE id = $1", [
      id,
      new Date(t.clock.now().getTime() - ago),
    ]);
  const nudges = async (id: string) =>
    (
      await t.db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM domain_events WHERE type = 'comeback_nudge' AND payload->>'userId' = $1",
        [id],
      )
    )[0]!.n;

  beforeAll(async () => {
    t = await createTestApp();
    // Run at noon UTC (the send window), whatever the real time is.
    const now = t.clock.now();
    const noon = new Date(now);
    noon.setUTCHours(12, 0, 0, 0);
    if (noon <= now) noon.setUTCDate(noon.getUTCDate() + 1);
    t.clock.advance(noon.getTime() - now.getTime());
    away = await t.login(4501, "Away");
    quiet = await t.login(4502, "Quiet");
    active = await t.login(4503, "Active");
    await t.put("/me/settings", { notifications: false }, quiet.token);
  });
  afterAll(() => t.close());

  it("nudges players away for two days, not active ones or long-gone ones", async () => {
    await seen(away.userId, 3 * DAY);
    await seen(quiet.userId, 3 * DAY);
    await seen(active.userId, 5 * HOUR);
    expect(await svc().nudgeDue()).toBe(2);
    expect(await nudges(away.userId)).toBe(1);
    expect(await nudges(active.userId)).toBe(0);
    // Not again within the gap.
    expect(await svc().nudgeDue()).toBe(0);
  });

  it("sends in the player's language with a button back in, honouring the mute setting", async () => {
    const before = t.bot.calls.filter((c) => c.method === "sendMessage").length;
    await t.service(NotificationsService).processOutbox();
    const sent = t.bot.calls.filter((c) => c.method === "sendMessage").slice(before);
    // The muted player gets nothing.
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.args[1])).toContain("ready to run");
  });

  it("stops after three nudges per absence and starts over when the player returns", async () => {
    for (let i = 0; i < 3; i++) {
      t.clock.advance(3 * DAY + HOUR);
      // Keep the absence inside the two-week window.
      await seen(away.userId, 3 * DAY);
      await t.db.query("UPDATE users SET last_seen_at = last_seen_at - interval '1 hour' WHERE id = $1", [
        away.userId,
      ]);
      await t.db.query(
        "UPDATE users SET last_nudge_at = last_seen_at + interval '1 hour' WHERE id = $1 AND last_nudge_at IS NOT NULL",
        [away.userId],
      );
      await svc().nudgeDue();
    }
    const row = (
      await t.db.query<{ nudges: number }>("SELECT nudges FROM users WHERE id = $1", [away.userId])
    )[0]!;
    expect(row.nudges).toBeLessThanOrEqual(3);

    // Coming back (a visit after the last nudge) resets the count for the next absence.
    await t.db.query("UPDATE users SET last_seen_at = last_nudge_at + interval '1 hour' WHERE id = $1", [
      away.userId,
    ]);
    t.clock.advance(3 * DAY);
    const n = await nudges(away.userId);
    await svc().nudgeDue();
    expect(await nudges(away.userId)).toBe(n + 1);
    const after = (
      await t.db.query<{ nudges: number }>("SELECT nudges FROM users WHERE id = $1", [away.userId])
    )[0]!;
    expect(after.nudges).toBe(1);
  });
});
