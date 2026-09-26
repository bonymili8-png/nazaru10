import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { type InitDataError, signInitData, verifyInitData } from "../src/modules/auth/telegram-init-data.js";
import { createLogger } from "../src/common/logger.js";
import { MemoryRateStore, RedisRateStore } from "../src/common/rate-limit.js";

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
    const s = new MemoryRateStore();
    const limit = { capacity: 3, perMinute: 60 };
    const t0 = 1_000_000;
    expect([1, 2, 3, 4].map(() => s.takeAt("k", limit, t0))).toEqual([true, true, true, false]);
    expect(s.takeAt("k", limit, t0 + 1000)).toBe(true);
    expect(s.takeAt("other", limit, t0)).toBe(true);
  });

  const redisUrl = process.env.TEST_REDIS_URL;
  it.skipIf(!redisUrl)("shares one budget across replicas through Redis", async () => {
    const logger = createLogger("silent");
    const prefix = `rl-test-${Date.now()}:`;
    const a = new RedisRateStore(redisUrl!, new MemoryRateStore(), logger, prefix);
    const b = new RedisRateStore(redisUrl!, new MemoryRateStore(), logger, prefix);
    const limit = { capacity: 3, perMinute: 6000 };
    try {
      // Two "replicas" draw from the same bucket.
      const takes = [await a.take("k", limit), await b.take("k", limit), await a.take("k", limit)];
      expect(takes).toEqual([true, true, true]);
      expect(await b.take("k", limit)).toBe(false);
      // 6000/min refills a token every 10 ms.
      await new Promise((r) => setTimeout(r, 30));
      expect(await a.take("k", limit)).toBe(true);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("keeps limiting in memory when Redis is unreachable", async () => {
    const s = new RedisRateStore("redis://127.0.0.1:1", new MemoryRateStore(), createLogger("silent"));
    const limit = { capacity: 2, perMinute: 1 };
    try {
      expect([await s.take("k", limit), await s.take("k", limit), await s.take("k", limit)]).toEqual([
        true,
        true,
        false,
      ]);
    } finally {
      await s.close();
    }
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

describe("CORS", () => {
  it("lets the Mini App origin use every method the client sends (incl. PUT)", async () => {
    await (await import("./db.js")).resetDatabase();
    const { buildApp } = await import("../src/app.js");
    const { createLogger } = await import("../src/common/logger.js");
    const { FakeBotApi } = await import("../src/modules/telegram/bot-api.js");
    const { Db } = await import("../src/common/db.js");
    const env = loadEnv({ ...process.env, CORS_ORIGINS: "https://app.example" });
    const db = new Db(env.DATABASE_URL, 2);
    const app = await buildApp({ env, logger: createLogger("silent"), db, bot: new FakeBotApi() });
    try {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const r = await app.inject({
          method: "OPTIONS",
          url: "/cosmetics/silks",
          headers: {
            origin: "https://app.example",
            "access-control-request-method": method,
            "access-control-request-headers": "authorization,content-type",
          },
        });
        expect(r.statusCode).toBeLessThan(300);
        expect(String(r.headers["access-control-allow-methods"])).toContain(method);
      }
      const foreign = await app.inject({
        method: "OPTIONS",
        url: "/cosmetics/silks",
        headers: { origin: "https://evil.example", "access-control-request-method": "PUT" },
      });
      expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await app.close();
      await db.close();
    }
  });
});
