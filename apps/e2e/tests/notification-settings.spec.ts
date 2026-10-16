import { expect, newOwner, test } from "./fixtures.js";

test("an owner picks which bot messages they get", async ({ page }) => {
  await newOwner(page);
  await page.goto("/profile/");
  const master = page.getByRole("switch", { name: "Bot notifications" });
  const start = page.getByRole("switch", { name: "Race start alerts" });
  const report = page.getByRole("switch", { name: "Morning stable report" });
  await expect(master).toHaveAttribute("aria-checked", "true");
  await expect(start).toHaveAttribute("aria-checked", "true");
  await expect(report).toHaveAttribute("aria-checked", "true");

  await start.click();
  await expect(start).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Race start alerts" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByRole("switch", { name: "Morning stable report" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // With bot messages off, the optional kinds are hidden.
  await page.getByRole("switch", { name: "Bot notifications" }).click();
  await expect(page.getByRole("switch", { name: "Bot notifications" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByRole("switch", { name: "Race start alerts" })).toHaveCount(0);
});
