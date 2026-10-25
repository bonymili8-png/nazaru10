import { expect, newOwner, test } from "./fixtures.js";

/**
 * Public share pages (no sign-in) and the in-app share prompt. Finished races take minutes to
 * come round on the schedule, so race data is faked at the network layer (server shapes).
 */
const RACE = "11111111-2222-4333-8444-555555555555";
const HORSE = "bbbbbbbb-0000-4000-8000-000000000001";
const ids = Array.from({ length: 6 }, (_, i) => (i === 0 ? HORSE : `runner-${i}`));
const entry = (i: number, o: Record<string, unknown> = {}) => ({
  horseId: ids[i],
  horseName: i === 0 ? "Bold Ruler" : `Rival ${i}`,
  ownerName: i === 0 ? "Golden Gate Stud" : null,
  ownerId: null,
  isHouse: i > 2,
  gate: i + 1,
  strategy: "MID_PACK",
  gear: null,
  jockeyName: "J. Doe",
  abilityRating: 40,
  raceRating: 1000,
  position: i + 1,
  finishTime: 80 + i,
  lengthsBehind: i,
  prize: 0,
  ratingAfter: 1000,
  mine: false,
  silks: null,
  cloth: null,
  finishEffect: null,
  form: null,
  ...o,
});
const race = (o: Record<string, unknown> = {}) => ({
  id: RACE,
  name: "Royal Meadow Downs Class 5",
  class: "CLASS_5",
  trackCode: "EUROTURF",
  trackName: "Royal Meadow Downs",
  surface: "TURF",
  distance: 1200,
  weather: "SUNNY",
  going: "GOOD",
  entryFee: 100,
  purse: 2000,
  status: "COMPLETED",
  locksAt: "2026-10-20T17:58:00.000Z",
  startsAt: "2026-10-20T18:00:00.000Z",
  entries: 6,
  maxField: 12,
  seedHash: "x".repeat(32),
  tournamentId: null,
  eligibility: { minRating: null, maxRating: null, maidenOnly: false },
  seed: null,
  entryList: ids.map((_, i) => entry(i)),
  ...o,
});
const live = {
  raceId: RACE,
  status: "COMPLETED",
  elapsed: 999,
  duration: 80,
  distance: 1200,
  frames: {
    interval: 1,
    ids,
    data: Array.from({ length: 81 }, (_, s) => ids.map((_, i) => [Math.min(1200, s * 15 - i * 3), i, 0, 0])),
  },
  commentary: [],
  events: [],
  results: ids.map((_, i) => entry(i)),
};

test("a shared replay plays for anyone, without signing in, and counts the visit", async ({ page }) => {
  const visits: unknown[] = [];
  await page.route(new RegExp(`/public/races/${RACE}$`), (r) => r.fulfill({ json: race() }));
  await page.route(new RegExp(`/public/races/${RACE}/live$`), (r) => r.fulfill({ json: live }));
  await page.route(/\/public\/share-visits$/, (r) => {
    visits.push(r.request().postDataJSON());
    return r.fulfill({ status: 204, body: "" });
  });
  // A fresh browser: no Telegram, no developer sign-in.
  await page.goto(`/replay/?id=${RACE}&r=ABC123`);
  await expect(page.getByRole("heading", { name: "Royal Meadow Downs Class 5" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Camera" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/^\d+\.\ds$/)).toBeVisible();
  await expect(page.getByText("Think you could train a horse to beat Bold Ruler?")).toBeVisible();
  await expect(page.getByRole("link", { name: "Play free in Telegram" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter as developer" })).toHaveCount(0);
  await expect.poll(() => visits).toEqual([{ kind: "race", id: RACE, ref: "ABC123" }]);
  // Horse names lead to their public cards, keeping the sharer's code.
  await expect(page.getByRole("link", { name: "Bold Ruler" }).first()).toHaveAttribute(
    "href",
    `/horse-card/?id=${HORSE}&r=ABC123`,
  );
});

test("a shared horse card shows its record and recent runs", async ({ page }) => {
  await page.route(new RegExp(`/public/horses/${HORSE}$`), (r) =>
    r.fulfill({
      json: {
        id: HORSE,
        name: "Bold Ruler",
        sex: "COLT",
        age: 4,
        coat: "BAY",
        retired: false,
        raceRating: 1184,
        starts: 12,
        wins: 4,
        seconds: 3,
        thirds: 2,
        earnings: 15400,
        stable: "Golden Gate Stud",
        recent: [
          {
            raceId: RACE,
            raceName: "Royal Meadow Downs Class 5",
            distance: 1200,
            startsAt: "2026-10-20T18:00:00.000Z",
            position: 1,
            field: 8,
          },
        ],
      },
    }),
  );
  await page.route(/\/public\/share-visits$/, (r) => r.fulfill({ status: 204, body: "" }));
  await page.goto(`/horse-card/?id=${HORSE}&r=ABC123`);
  await expect(page.getByRole("heading", { name: "Bold Ruler" })).toBeVisible();
  await expect(page.getByText("Golden Gate Stud", { exact: false })).toBeVisible();
  await expect(page.getByText("Can your horse beat Bold Ruler?")).toBeVisible();
  await expect(page.getByText("1184")).toBeVisible();
  await expect(page.locator(`a[href='/replay/?id=${RACE}&r=ABC123']`)).toBeVisible();
});

test("after a win the race page offers to share the replay link, and the choice is remembered", async ({
  page,
}) => {
  await newOwner(page);
  const me = await page.evaluate(async () => {
    const r = await fetch("http://localhost:3410/me", {
      headers: { authorization: `Bearer ${sessionStorage.getItem("tl.token")}` },
    });
    return (await r.json()) as { referralCode: string };
  });
  await page.route(new RegExp(`/races/${RACE}$`), (r) =>
    r.fulfill({ json: race({ entryList: ids.map((_, i) => entry(i, i === 0 ? { mine: true } : {})) }) }),
  );
  await page.route(new RegExp(`/races/${RACE}/live$`), (r) => r.fulfill({ json: live }));
  await page.evaluate(() => {
    localStorage.removeItem("tl.sharePrompts");
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((u: string) => {
      (window as unknown as { opened: string[] }).opened.push(u);
      return null;
    }) as typeof window.open;
  });
  await page.goto(`/race/?id=${RACE}`);
  await expect(page.getByText("Bold Ruler won!")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((u: string) => {
      (window as unknown as { opened: string[] }).opened.push(u);
      return null;
    }) as typeof window.open;
  });
  await page.getByRole("button", { name: "Share the replay" }).click();
  const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  expect(opened).toHaveLength(1);
  const share = new URL(opened[0]!);
  expect(share.origin + share.pathname).toBe("https://t.me/share/url");
  expect(share.searchParams.get("url")).toBe(
    `http://localhost:3401/replay/?id=${RACE}&r=${encodeURIComponent(me.referralCode)}`,
  );
  // "Not now" hides the prompt for this race; a plain share button stays.
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("Bold Ruler won!")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Share result" })).toBeVisible();
  await expect(page.getByText("Bold Ruler won!")).toHaveCount(0);
});
