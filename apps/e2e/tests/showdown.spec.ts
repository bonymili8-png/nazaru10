import { expect, newOwner, sql, test } from "./fixtures.js";

test("a host runs a showdown with a guest while anyone watches the public broadcast", async ({
  page,
  browser,
}) => {
  // The host creates a showdown from the races page.
  await newOwner(page);
  await page.getByRole("link", { name: "Races" }).click();
  await page.getByRole("link", { name: "Showdown" }).click();
  await page.getByLabel("Showdown name (Latin letters)").fill("Friday Derby");
  await page.getByLabel("Your name on air (e.g. @handle)").fill("@host_one");
  await page.getByRole("radio", { name: /^No fatigue/ }).click();
  await page.getByRole("button", { name: "Create and get the code" }).click();
  await expect(page.getByRole("heading", { name: "Friday Derby" })).toBeVisible();
  const code = new URL(page.url()).searchParams.get("code")!;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await expect(page.getByText("Hosted by @host_one")).toBeVisible();

  // A guest joins by code with a name of their own.
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await newOwner(guest);
  await guest.goto(`/show/?code=${code}`);
  await guest.getByLabel("Your name on air (e.g. @handle)").fill("guest.rider");
  await guest.getByRole("button", { name: "Join", exact: true }).click();
  await expect(guest.getByText("You're in — your horse is ready")).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Your horse" })).toBeVisible();

  // The host calls a race; the guest picks tactics while it is called.
  await expect(page.getByText("guest.rider", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Call the next race/ }).click();
  await expect(page.getByText("Off in")).toBeVisible();
  await guest.getByRole("radio", { name: "Front runner" }).click();
  await expect(guest.getByRole("radio", { name: "Front runner" })).toHaveAttribute("aria-checked", "true");

  // The off (moved forward in the database instead of waiting): the race goes live.
  await sql(
    "UPDATE showdown_races SET starts_at = now() - interval '3 seconds' WHERE showdown_id = (SELECT id FROM showdowns WHERE code = $1)",
    [code],
  );
  await expect(page.getByText("LIVE").first()).toBeVisible();

  // The public broadcast needs no sign-in (a fresh browser, no Telegram).
  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await viewer.goto(`/watch/?code=${code}`);
  await expect(viewer.getByRole("heading", { name: "Friday Derby" })).toBeVisible();
  await expect(viewer.getByText("LIVE").first()).toBeVisible();
  await expect(viewer.getByText(/Race 1 ·/)).toBeVisible();

  // The result is public at the end of the broadcast: points for both players.
  await sql(
    "UPDATE showdown_races SET results_at = now() WHERE status = 'RUN' AND showdown_id = (SELECT id FROM showdowns WHERE code = $1)",
    [code],
  );
  await expect(viewer.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(viewer.getByText(/\(\+10\)/)).toBeVisible();
  await expect(viewer.getByText(/\(\+8\)/)).toBeVisible();
  await guestCtx.close();
  await viewerCtx.close();
});
