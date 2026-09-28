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
          data: Array.from({ length: elapsed + 1 }, (_, s) => ids.map((_, i) => [s * 15, i, 0, 0])),
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
});
