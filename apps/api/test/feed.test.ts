import type { FeedItemDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FeedService } from "../src/modules/feed/feed.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };

describe("racing news feed", () => {
  let t: TestApp;
  let ann: User;
  let ben: User;
  let cat: User;

  const event = (type: string, actor: string | null, payload: Record<string, unknown>) =>
    t.db.query(
      "INSERT INTO domain_events (type, aggregate_type, aggregate_id, actor_id, payload) VALUES ($1,'test','x',$2,$3)",
      [type, actor, JSON.stringify(payload)],
    );

  beforeAll(async () => {
    t = await createTestApp();
    ann = await t.login(8401, "Ann");
    ben = await t.login(8402, "Ben");
    cat = await t.login(8403, "Cat");
  });
  afterAll(() => t.close());

  it("keeps only public highlights from the event log, once", async () => {
    await event("race_result", ann.userId, {
      userId: ann.userId,
      position: 1,
      horseName: "Blaze",
      horseId: "h1",
      raceName: "Maiden Cup",
      raceId: "r1",
      field: 8,
    });
    await event("race_result", ben.userId, { userId: ben.userId, position: 3, horseName: "Slow" });
    await event("training_completed", ben.userId, { userId: ben.userId, horseName: "Private" });
    await event("market_sale_completed", ann.userId, {
      userId: ann.userId,
      buyerId: ben.userId,
      horseName: "Cheap",
      price: 900,
    });
    await event("market_sale_completed", ann.userId, {
      userId: ann.userId,
      buyerId: ben.userId,
      horseName: "Star",
      horseId: "h2",
      price: 45_000,
    });
    await event("foal_delivered", cat.userId, { userId: cat.userId, foalName: "Plain", mutation: false });
    await event("foal_delivered", cat.userId, {
      userId: cat.userId,
      foalName: "Comet",
      foalId: "f1",
      mutation: true,
    });
    const svc = t.service(FeedService);
    await svc.ingest();
    expect(await svc.ingest()).toBe(0);
    const feed = (await t.get<FeedItemDto[]>("/feed", cat.token)).body;
    const mine = feed.filter((f) => ["Ann", "Ben", "Cat"].includes(f.actorName));
    expect(mine.map((f) => [f.kind, f.actorName])).toEqual([
      ["FOAL", "Cat"],
      ["BIG_SALE", "Ben"],
      ["WIN", "Ann"],
    ]);
    expect(mine.find((f) => f.kind === "WIN")).toMatchObject({
      link: "/race/?id=r1",
      vars: { horseName: "Blaze", raceName: "Maiden Cup" },
    });
  });

  it("filters to the viewer's club", async () => {
    const club = (await t.post<{ id: string }>("/clubs", { name: "Feed Club", tag: "FC" }, ann.token)).body;
    await t.post(`/clubs/${club.id}/join`, {}, cat.token);
    const scoped = (await t.get<FeedItemDto[]>("/feed?scope=club", cat.token)).body;
    expect(new Set(scoped.map((f) => f.actorName))).toEqual(new Set(["Ann", "Cat"]));
    // Founding the club made the news too.
    await t.service(FeedService).ingest();
    const all = (await t.get<FeedItemDto[]>("/feed", ben.token)).body;
    expect(all[0]).toMatchObject({ kind: "CLUB_CREATED", actorName: "Ann", link: `/club/?id=${club.id}` });
    // Without a club the club scope is empty.
    expect((await t.get<FeedItemDto[]>("/feed?scope=club", ben.token)).body).toEqual([]);
  });
});
