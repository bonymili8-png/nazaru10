import { expect, newOwner, sql, test } from "./fixtures.js";

/**
 * A finished tournament's results: the owner's history and the tournament page with its heats,
 * final and table. A real cup takes a day to come round, so the API answers are faked at the
 * network layer (the shapes are the server's).
 */
const ID = "11111111-2222-4333-8444-555555555555";
const HEAT1 = "aaaaaaaa-0000-4000-8000-000000000001";
const HEAT2 = "aaaaaaaa-0000-4000-8000-000000000002";
const FINAL = "aaaaaaaa-0000-4000-8000-000000000003";
const horse = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;

const base = {
  id: ID,
  name: "Ascot Local Cup",
  tier: "LOCAL",
  status: "COMPLETED",
  raceClass: "CLASS_5",
  trackCode: "EUROTURF",
  trackName: "Ascot",
  distance: 1400,
  entryFee: 200,
  purse: 7000,
  qualification: { minSeasonPoints: null, minRating: null },
  opensAt: "2026-10-14T18:00:00.000Z",
  registrationClosesAt: "2026-10-15T17:50:00.000Z",
  heatsAt: "2026-10-15T18:00:00.000Z",
  finalAt: "2026-10-15T18:30:00.000Z",
  entrants: 4,
  maxEntrants: 36,
  heatRaceIds: [HEAT1, HEAT2],
  finalRaceId: FINAL,
  winner: { horseId: horse(3), horseName: "Night Comet", ownerName: "rival", house: false },
  houseFill: false,
  cancelReason: null,
  completedAt: "2026-10-15T18:35:00.000Z",
};
const mine = [
  {
    horseId: horse(1),
    horseName: "Bold Ruler",
    ownerName: "me",
    status: "FINALIST",
    heatRaceId: HEAT1,
    heatPosition: 1,
    finalPosition: 2,
    mine: true,
  },
  {
    horseId: horse(2),
    horseName: "Quiet Storm",
    ownerName: "me",
    status: "ELIMINATED",
    heatRaceId: HEAT2,
    heatPosition: 4,
    finalPosition: null,
    mine: true,
  },
];
const runner = (n: number, name: string, pos: number, o: Partial<Record<string, unknown>> = {}) => ({
  horseId: horse(n),
  horseName: name,
  ownerId: owner(n),
  ownerName: n <= 2 ? "me" : "rival",
  house: false,
  mine: n <= 2,
  gate: pos,
  strategy: "MID_PACK",
  position: pos,
  finishTime: pos === 1 ? 84.31 : null,
  lengthsBehind: pos === 1 ? 0 : pos * 1.2,
  prize: null,
  qualified: false,
  ...o,
});
const round = (raceId: string, stage: string, no: number, runners: unknown[]) => ({
  raceId,
  stage,
  no,
  name: `Ascot Local Cup — ${stage === "FINAL" ? "Final" : `Heat ${no}`}`,
  status: "COMPLETED",
  startsAt: stage === "FINAL" ? base.finalAt : base.heatsAt,
  trackName: "Ascot",
  surface: "TURF",
  distance: 1400,
  going: "GOOD",
  weather: "SUNNY",
  runners,
});
const detail = {
  ...base,
  myEntries: mine,
  entries: mine,
  championHonours: { prestige: 0, reputation: 30 },
  rounds: [
    round(HEAT1, "HEAT", 1, [
      runner(1, "Bold Ruler", 1, { qualified: true }),
      runner(9, "House Lad", 2, { house: true, ownerId: null, ownerName: null, mine: false }),
    ]),
    round(HEAT2, "HEAT", 2, [runner(3, "Night Comet", 1, { qualified: true }), runner(2, "Quiet Storm", 4)]),
    round(FINAL, "FINAL", 0, [
      runner(3, "Night Comet", 1, { prize: 4200 }),
      runner(1, "Bold Ruler", 2, { prize: 1750 }),
    ]),
  ],
  standings: [
    {
      rank: 1,
      tied: false,
      horseId: horse(3),
      horseName: "Night Comet",
      ownerId: owner(3),
      ownerName: "rival",
      mine: false,
      status: "FINALIST",
      champion: true,
      heatNo: 2,
      heatPosition: 1,
      finalPosition: 1,
      prize: 4200,
    },
    {
      rank: 2,
      tied: false,
      horseId: horse(1),
      horseName: "Bold Ruler",
      ownerId: owner(1),
      ownerName: "me",
      mine: true,
      status: "FINALIST",
      champion: false,
      heatNo: 1,
      heatPosition: 1,
      finalPosition: 2,
      prize: 1750,
    },
    {
      rank: 3,
      tied: false,
      horseId: horse(2),
      horseName: "Quiet Storm",
      ownerId: owner(2),
      ownerName: "me",
      mine: true,
      status: "ELIMINATED",
      champion: false,
      heatNo: 2,
      heatPosition: 4,
      finalPosition: null,
      prize: 0,
    },
  ],
};
const cancelled = {
  ...base,
  id: "11111111-2222-4333-8444-666666666666",
  name: "York Local Cup",
  status: "CANCELLED",
  heatsAt: "2026-10-14T18:00:00.000Z",
  heatRaceIds: [],
  finalRaceId: null,
  winner: null,
  cancelReason: "Not enough entrants",
  myEntries: [{ ...mine[0], status: "SCRATCHED", heatRaceId: null, heatPosition: null, finalPosition: null }],
};

test("an owner finds their tournament results: history, heats, final and the table", async ({ page }) => {
  await page.route(/\/tournaments\/history/, (route) => {
    const url = new URL(route.request().url());
    const items =
      url.searchParams.get("mine") === "true"
        ? [{ ...base, myEntries: mine }, cancelled]
        : [{ ...base, myEntries: mine }];
    return route.fulfill({ json: { items, nextBefore: null } });
  });
  await page.route(new RegExp(`/tournaments/${ID}$`), (route) => route.fulfill({ json: detail }));
  await newOwner(page);
  await page.goto("/tournaments/");

  const history = page.getByRole("region", { name: "My tournaments" });
  await expect(history.getByText("Bold Ruler — 2nd in the final")).toBeVisible();
  await expect(history.getByText("Quiet Storm — out in the heats (4th)")).toBeVisible();
  await expect(history.getByText("Called off: not enough entrants.")).toBeVisible();
  await expect(history.getByText("Bold Ruler — entry fee refunded")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Past tournaments" }).getByText("Ascot Local Cup"),
  ).toBeVisible();

  await history.locator(`a[href='/tournament/?id=${ID}']`).click();
  const table = page.getByRole("table", { name: "Tournament table" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Night Comet");
  await expect(rows.nth(0)).toContainText("Champion");
  await expect(rows.nth(0)).toContainText("+30 reputation");
  await expect(rows.nth(1)).toContainText("2nd of 2 in the final");
  await expect(rows.nth(1)).toContainText("+1,750");
  await expect(rows.nth(2)).toContainText("4th in Heat 2");
  await expect(rows.nth(1).getByRole("link", { name: "Bold Ruler" })).toHaveAttribute(
    "href",
    `/horse/?id=${horse(1)}`,
  );

  // Every round with its field, conditions and a link to the replay.
  const heat1 = page.getByRole("list", { name: /^Heat 1 · / });
  await expect(heat1.getByRole("listitem")).toHaveCount(2);
  await expect(heat1.getByRole("listitem").nth(0)).toContainText("Bold Ruler");
  await expect(heat1.getByLabel("Through to the final")).toHaveCount(1);
  await expect(heat1.getByRole("listitem").nth(1)).toContainText("House");
  await expect(page.getByText("Ascot · 1400m Turf ·", { exact: false }).first()).toBeVisible();
  await expect(page.locator(`a[href='/race/?id=${FINAL}']`)).toHaveText("Replay");
  const final = page.getByRole("list", { name: /^Final · / });
  await expect(final.getByRole("listitem").nth(1)).toContainText("+1,750");
});

test("a tournament admin switches house-filled cups off and on", async ({ page }) => {
  const devId = await newOwner(page);
  await sql("UPDATE users SET role = 'TOURNAMENT_ADMIN' WHERE telegram_id = $1", [devId]);
  await page.goto("/admin/");
  await page.getByRole("tab", { name: "races" }).click();
  await expect(page.getByRole("heading", { name: "Tournaments: house horses" })).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Fill tournaments with house horses" });
  // The e2e database persists: start from ON.
  if ((await toggle.getAttribute("aria-checked")) === "false") {
    page.once("dialog", (d) => void d.accept());
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/A cup runs even with one entrant/)).toBeVisible();

  await page.getByLabel("Reason for the change (optional, kept in the audit log)").fill("E2E entrants only");
  page.once("dialog", (d) => void d.accept());
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/A cup needs two entrants/)).toBeVisible();
  await expect(page.getByText("E2E entrants only").first()).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});
