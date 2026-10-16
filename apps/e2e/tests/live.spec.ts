import { expect, newOwner, test } from "./fixtures.js";

/**
 * A live broadcast joined a few seconds after the off plays from the gates (then catches up),
 * so the start is never missed. The race and its frames are faked at the network layer: a real
 * start is minutes away on the schedule.
 */
test("joining a race just after the off shows it from the start", async ({ page }) => {
  await newOwner(page);
  await page.getByRole("link", { name: "Races" }).click();
  const link = page.locator("a[href^='/race/?id=']").first();
  await expect(async () => {
    await page.reload();
    await expect(link).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  const id = new URL((await link.getAttribute("href"))!, page.url()).searchParams.get("id")!;

  const elapsed = 15; // seconds since the off when the viewer arrives
  let ids: string[] = [];
  await page.route(new RegExp(`/races/${id}$`), async (route) => {
    const res = await route.fetch();
    const race = await res.json();
    ids = race.entryList.map((e: { horseId: string }) => e.horseId);
    // A fresh race may have no entries yet: film a field of eight anonymous runners.
    if (ids.length === 0) ids = Array.from({ length: 8 }, (_, i) => `runner-${i}`);
    await route.fulfill({ response: res, json: { ...race, status: "RUNNING" } });
  });
  await page.route(new RegExp(`/races/${id}/live$`), (route) =>
    route.fulfill({
      json: {
        raceId: id,
        status: "RUNNING",
        elapsed,
        duration: null,
        distance: 1600,
        // 1-second frames up to "now": every runner covers 15 m a second.
        frames: {
          interval: 1,
          ids,
          // Spread out: each runner a few metres behind the one before, on its own lane.
          data: Array.from({ length: elapsed + 1 }, (_, s) =>
            ids.map((_, i) => [
              Math.max(0, s * 15 - i * 3 * (s / elapsed) - (i === ids.length - 1 ? s * 4 : 0)),
              i * 0.9,
              0,
              0,
            ]),
          ),
        },
        commentary: [],
        events: [],
        results: null,
      },
    }),
  );

  await link.click();
  const clock = page.getByText(/^\d+\.\ds$/);
  await expect(clock).toBeVisible();
  // Live alone would already show ~11 s (15 s minus the broadcast delay); the start is shown instead.
  expect(Number((await clock.innerText()).replace(/[^\d.]/g, ""))).toBeLessThan(4);
  // …and playback moves on towards the live picture.
  await expect.poll(async () => Number((await clock.innerText()).replace(/[^\d.]/g, ""))).toBeGreaterThan(4);

  // Camera view: follows the leader, with the stragglers counted out of shot.
  await page.getByRole("tab", { name: "Camera" }).click();
  await expect(page.getByRole("img", { name: "Camera following the race leader" })).toBeVisible();
  await page.waitForTimeout(3000);
  await page
    .getByRole("img", { name: "Camera following the race leader" })
    .screenshot({ path: "/tmp/claude-0/shots/camera.png" });
  await expect(page.getByText(/out of shot/)).toBeVisible();
  // Every runner in shot carries its number.
  await expect(
    page.getByRole("img", { name: "Camera following the race leader" }).locator("text", { hasText: /^1$/ }),
  ).toHaveCount(1);
  // The choice is remembered.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Camera" })).toHaveAttribute("aria-selected", "true");
});

test("a finished race lists its runners under the replay, each linked to its horse", async ({ page }) => {
  await newOwner(page);
  await page.getByRole("link", { name: "Races" }).click();
  const link = page.locator("a[href^='/race/?id=']").first();
  await expect(async () => {
    await page.reload();
    await expect(link).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  const id = new URL((await link.getAttribute("href"))!, page.url()).searchParams.get("id")!;
  const horses = [
    ["11111111-1111-4111-8111-111111111111", "Amber Majesty", 2, 1],
    ["22222222-2222-4222-8222-222222222222", "Velvet Crown", 1, 2],
  ] as const;
  const entryList = horses.map(([horseId, horseName, gate, position]) => ({
    horseId,
    horseName,
    ownerName: "Rival",
    ownerId: "33333333-3333-4333-8333-333333333333",
    isHouse: false,
    gate,
    strategy: "CLOSER",
    gear: null,
    jockeyName: "J. Doe",
    abilityRating: 40,
    raceRating: 1000,
    position,
    finishTime: 70 + position,
    lengthsBehind: position === 1 ? 0 : 2,
    prize: 0,
    ratingAfter: 1000,
    mine: false,
    silks: null,
    cloth: null,
    finishEffect: null,
  }));
  await page.route(new RegExp(`/races/${id}$`), async (route) => {
    const res = await route.fetch();
    const race = await res.json();
    await route.fulfill({ response: res, json: { ...race, status: "COMPLETED", entryList } });
  });
  await page.route(new RegExp(`/races/${id}/live$`), (route) =>
    route.fulfill({
      json: {
        raceId: id,
        status: "COMPLETED",
        elapsed: 999,
        duration: 72,
        distance: 1200,
        frames: {
          interval: 1,
          ids: horses.map((h) => h[0]),
          data: [
            [
              [0, 0, 0, 0],
              [0, 1, 0, 0],
            ],
            [
              [1200, 0, 0, 0],
              [1190, 1, 0, 0],
            ],
          ],
        },
        commentary: [],
        events: [],
        results: entryList,
      },
    }),
  );
  await link.click();
  await expect(page.getByRole("heading", { name: "Runners (2)" })).toBeVisible();
  const runners = page
    .getByRole("heading", { name: "Runners (2)" })
    .locator("xpath=../following-sibling::*[1]");
  // By gate: Velvet Crown (gate 1) first, each name a link to the horse.
  await expect(runners.getByRole("link").first()).toHaveText("Velvet Crown");
  await expect(runners.getByRole("link", { name: "Amber Majesty" })).toHaveAttribute(
    "href",
    "/horse/?id=11111111-1111-4111-8111-111111111111",
  );
});
