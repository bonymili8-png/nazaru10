import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { type InitDataError, signInitData, verifyInitData } from "../src/modules/auth/telegram-init-data.js";
import { RateLimitGuard } from "../src/common/rate-limit.js";
import { Reflector } from "@nestjs/core";

const TOKEN = "123456:ABCDEF";
const now = new Date("2026-09-01T12:00:00Z");
const fields = (over: Record<string, string> = {}) => ({
  auth_date: String(Math.floor(now.getTime() / 1000) - 60),
  query_id: "AAE",
  user: JSON.stringify({ id: 42, first_name: "Ann" }),
  ...over,
});

describe("Telegram initData verification", () => {
  it("accepts correctly signed data", () => {
    const v = verifyInitData(signInitData(fields({ start_param: "ref_ABC" }), TOKEN), TOKEN, 3600, now);
    expect(v.user.id).toBe(42);
    expect(v.startParam).toBe("ref_ABC");
  });

  const reason = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as InitDataError).reason;
    }
    return "OK";
  };

  it("rejects tampering, wrong bot, expiry, future dates and garbage", () => {
    const good = signInitData(fields(), TOKEN);
    const tampered = good.replace("Ann", "Bob");
    expect(reason(() => verifyInitData(tampered, TOKEN, 3600, now))).toBe("BAD_SIGNATURE");
    expect(reason(() => verifyInitData(good, "999:OTHER", 3600, now))).toBe("BAD_SIGNATURE");
    expect(reason(() => verifyInitData(good, TOKEN, 30, now))).toBe("EXPIRED");
    const future = signInitData(
      fields({ auth_date: String(Math.floor(now.getTime() / 1000) + 3600) }),
      TOKEN,
    );
    expect(reason(() => verifyInitData(future, TOKEN, 3600, now))).toBe("FUTURE");
    expect(reason(() => verifyInitData("hash=zz", TOKEN, 3600, now))).toBe("MALFORMED");
    const noUser = signInitData({ auth_date: fields().auth_date }, TOKEN);
    expect(reason(() => verifyInitData(noUser, TOKEN, 3600, now))).toBe("NO_USER");
    expect(reason(() => verifyInitData(good, "", 3600, now))).toBe("BAD_SIGNATURE");
  });
});

describe("environment validation", () => {
  const base = {
    DATABASE_URL: "postgres://x:y@localhost:5432/db",
    JWT_SECRET: "a".repeat(40),
    RACE_SEED_SECRET: "b".repeat(40),
  };
  it("rejects short secrets", () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });
  it("refuses dev auth, placeholder secrets and missing bot config in production", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", ALLOW_DEV_AUTH: "true" })).toThrow(
      /ALLOW_DEV_AUTH/,
    );
    expect(() =>
      loadEnv({ ...base, NODE_ENV: "production", JWT_SECRET: "dev-only-secret-change-me-dev-only-secret" }),
    ).toThrow(/placeholder|TELEGRAM/);
    expect(
      loadEnv({
        ...base,
        NODE_ENV: "production",
        TELEGRAM_BOT_TOKEN: "x".repeat(20),
        TELEGRAM_WEBHOOK_SECRET: "y".repeat(20),
      }).NODE_ENV,
    ).toBe("production");
  });
});

describe("rate limiter", () => {
  it("allows the burst capacity then refills over time", () => {
    const g = new RateLimitGuard(new Reflector(), loadEnv());
    const limit = { capacity: 3, perMinute: 60 };
    const t0 = 1_000_000;
    expect([1, 2, 3, 4].map(() => g.take("k", limit, t0))).toEqual([true, true, true, false]);
    expect(g.take("k", limit, t0 + 1000)).toBe(true);
    expect(g.take("other", limit, t0)).toBe(true);
  });
});

describe("client IP trust", () => {
  it("ignores X-Forwarded-For unless proxy hops are configured", async () => {
    await (await import("./db.js")).resetDatabase();
    const { buildApp } = await import("../src/app.js");
    const { createLogger } = await import("../src/common/logger.js");
    const { FakeBotApi } = await import("../src/modules/telegram/bot-api.js");
    const { Db } = await import("../src/common/db.js");
    const env = loadEnv({ ...process.env, TRUST_PROXY_HOPS: "0" });
    const db = new Db(env.DATABASE_URL, 2);
    const app = await buildApp({ env, logger: createLogger("silent"), db, bot: new FakeBotApi() });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/auth/telegram",
        payload: { initData: "x".repeat(20) },
        headers: { "x-forwarded-for": `1.2.3.${i}` },
      });
      statuses.push(r.statusCode);
    }
    await app.close();
    await db.close();
    // Spoofed addresses share one bucket: the auth limit (10/min) kicks in.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
