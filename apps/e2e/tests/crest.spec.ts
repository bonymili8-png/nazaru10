import { expect, newOwner, test } from "./fixtures.js";

test("an owner designs a stable crest that appears on the home screen", async ({ page }) => {
  await newOwner(page);
  await page.goto("/profile/");
  await page.getByRole("link", { name: "Stable crest" }).click();
  await expect(page.getByRole("heading", { name: "Stable crest" })).toBeVisible();

  // Paid emblems need gems.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("radiogroup", { name: "Emblem" }).getByRole("radio", { name: /Crown/ }).click();
  await expect(page.getByText(/Not enough gems/i)).toBeVisible();

  await page.getByRole("radiogroup", { name: "Shape" }).getByRole("radio", { name: "Diamond" }).click();
  await page.getByRole("radiogroup", { name: "Emblem" }).getByRole("radio", { name: /Star/ }).click();
  await page.getByRole("button", { name: /^Field colour:/ }).click();
  await page.getByRole("radiogroup", { name: "Field colour" }).getByRole("radio", { name: "Navy" }).click();
  await page.getByRole("button", { name: "Save crest" }).click();
  await expect(page.getByText("Crest saved")).toBeVisible();
  await page.screenshot({ path: "/tmp/claude-0/shots/crest.png", fullPage: true });

  await page.reload();
  await expect(
    page.getByRole("radiogroup", { name: "Shape" }).getByRole("radio", { name: "Diamond" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Stable crest" })).toBeVisible();
  await page.screenshot({ path: "/tmp/claude-0/shots/home-crest.png" });
});
