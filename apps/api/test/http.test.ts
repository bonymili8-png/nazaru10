import { brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("http layer", () => {
  let t: TestApp;
  let token: string;
  beforeAll(async () => {
    t = await createTestApp();
    token = (await t.login(9901, "Http")).token;
    await t.service(RaceRunnerService).scheduleAhead();
  });
  afterAll(() => t.close());

  it("compresses larger JSON responses when the client accepts it", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/races?status=upcoming&limit=50",
      headers: { authorization: `Bearer ${token}`, "accept-encoding": "br, gzip" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    const races = JSON.parse(brotliDecompressSync(res.rawPayload).toString()) as unknown[];
    expect(races.length).toBeGreaterThan(3);
    expect(res.rawPayload.length).toBeLessThan(JSON.stringify(races).length / 3);
  });

  it("sends security headers and never lets responses be cached", async () => {
    const res = await t.app.inject({ method: "GET", url: "/wallet", headers: { authorization: `Bearer ${token}` } });
    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    });
  });
});

describe("database guard rails", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it("caps statement time, and migrations leave pooled connections at the defaults", async () => {
    const [r] = await t.db.query<{ statement_timeout: string }>("SHOW statement_timeout");
    expect(r!.statement_timeout).toBe("15s");
    await expect(t.db.query("SELECT pg_sleep(16)")).rejects.toThrow(/statement timeout/);
  }, 30_000);
});
