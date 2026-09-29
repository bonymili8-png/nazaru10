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
  // The choice is remembered.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Camera" })).toHaveAttribute("aria-selected", "true");
});
