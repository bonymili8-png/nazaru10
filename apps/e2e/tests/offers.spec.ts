import { expect, newOwner, openFirstHorse, test } from "./fixtures.js";

test("a buyer makes an offer on a horse that is not for sale; the owner declines it", async ({
  page,
  browser,
}) => {
  await newOwner(page);
  await openFirstHorse(page);
  const horseUrl = page.url();
  // Owners see no offer form on their own horse.
  await expect(page.getByRole("heading", { name: "Make an offer" })).toHaveCount(0);

  const buyer = await browser.newPage();
  await newOwner(buyer);
  await buyer.goto(horseUrl);
  await expect(buyer.getByRole("heading", { name: "Make an offer" })).toBeVisible();
  buyer.once("dialog", (d) => void d.accept());
  await buyer.getByRole("button", { name: /^Offer .* cr$/ }).click();
  await expect(buyer.getByText("Offer sent to the owner")).toBeVisible();
  await buyer.goto("/shop/");
  await buyer.getByRole("tab", { name: "Mine" }).click();
  await expect(buyer.getByRole("heading", { name: "Your offers" })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "Withdraw" })).toBeVisible();

  await page.goto("/shop/");
  await page.getByRole("tab", { name: "Mine" }).click();
  await expect(page.getByRole("heading", { name: "Offers for your horses" })).toBeVisible();
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText(/Offer declined/)).toBeVisible();
  await buyer.close();
});
