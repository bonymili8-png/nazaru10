import { expect, newOwner, test } from "./fixtures.js";

test("an owner picks a finish effect, previews it; paid ones need gems", async ({ page }) => {
  await newOwner(page);
  await page.goto("/silks/");
  const fx = page.getByRole("radiogroup", { name: "Finish effect" });
  await expect(fx.getByRole("radio", { name: /Confetti/ })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator(".fx[data-effect='CONFETTI']")).toBeAttached();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/claude-0/shots/finish-confetti.png" });

  await fx.getByRole("radio", { name: /None/ }).click();
  await expect(page.getByText("Finish effect set: None")).toBeVisible();
  await expect(fx.getByRole("radio", { name: /None/ })).toHaveAttribute("aria-checked", "true");

  page.once("dialog", (d) => void d.accept());
  await fx.getByRole("radio", { name: /Fireworks/ }).click();
  await expect(page.getByText("Not enough gems.")).toBeVisible();
});
