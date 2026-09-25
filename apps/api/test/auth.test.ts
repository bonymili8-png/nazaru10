import type { AuthResponse, HomeDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInitData } from "../src/modules/auth/telegram-init-data.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("authentication & onboarding", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it("rejects requests without a valid session", async () => {
    expect((await t.get("/me")).status).toBe(401);
    expect((await t.get("/me", "not-a-jwt")).status).toBe(401);
    expect((await t.get("/health")).status).toBe(200);
    expect((await t.get("/ready")).body).toMatchObject({ status: "ready" });
    expect((await t.get("/")).body).toMatchObject({ status: "ok", health: "/health" });
  });

  it("rejects forged init data", async () => {
    const forged = signInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 1, first_name: "X" }) },
      "999:WRONG-TOKEN",
    );
    const res = await t.post<{ error: { code: string } }>("/auth/telegram", { initData: forged });
    expect(res.status).toBe(401);
    expect((await t.post("/auth/telegram", { initData: 5 })).status).toBe(400);
  });

  it("bootstraps a new player exactly once: stable, credits, starter horse, quests", async () => {
    const { token, userId } = await t.login(1001, "Alice");
    const home = await t.get<HomeDto>("/home", token);
    expect(home.status).toBe(200);
    expect(home.body.user.id).toBe(userId);
    expect(home.body.wallet.balances.CREDITS).toBe(5000);
    expect(home.body.stable).toMatchObject({ name: "Alice's Stable", level: 1, capacity: 3, horseCount: 1 });
    expect(home.body.horses).toHaveLength(1);
    expect(home.body.horses[0]!.rarity).toBe("UNCOMMON");
    expect(home.body.quests.find((q) => q.code === "FIRST_HORSE")).toMatchObject({
      completed: true,
      claimed: false,
    });

    const again = await t.login(1001, "Alice");
    expect(again.userId).toBe(userId);
    const home2 = await t.get<HomeDto>("/home", again.token);
    expect(home2.body.wallet.balances.CREDITS).toBe(5000);
    expect(home2.body.horses).toHaveLength(1);
  });

  it("claims quest rewards once", async () => {
    const { token } = await t.login(1002, "Bob");
    expect((await t.post("/quests/FIRST_HORSE/claim", {}, token)).status).toBe(201);
    expect((await t.post("/quests/FIRST_HORSE/claim", {}, token)).status).toBe(409);
    expect((await t.post("/quests/FIRST_WIN/claim", {}, token)).status).toBe(409);
    const home = await t.get<HomeDto>("/home", token);
    expect(home.body.wallet.balances.CREDITS).toBe(5200);
  });

  it("records referrals from the start parameter and ignores self/unknown codes", async () => {
    const ref = await t.login(1003, "Carol");
    const me = await t.get<{ referralCode: string }>("/me", ref.token);
    const invited = await t.login(1004, "Dan", `ref_${me.body.referralCode}`);
    const row = await t.db.one<{ referred_by: string }>("SELECT referred_by FROM users WHERE id = $1", [
      invited.userId,
    ]);
    expect(row!.referred_by).toBe(ref.userId);
    const stranger = await t.login(1005, "Eve", "ref_NOPE");
    const row2 = await t.db.one<{ referred_by: string | null }>(
      "SELECT referred_by FROM users WHERE id = $1",
      [stranger.userId],
    );
    expect(row2!.referred_by).toBeNull();
  });

  it("blocks suspended accounts immediately, even with a valid token", async () => {
    const { token, userId } = await t.login(1006, "Mallory");
    await t.db.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId]);
    expect((await t.get("/me", token)).status).toBe(403);
    const res = await t.post<AuthResponse>("/auth/dev", { telegramId: 1006, firstName: "Mallory" });
    expect(res.status).toBe(403);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
