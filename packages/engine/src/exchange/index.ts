import type { GameConfig } from "../config/index.js";

/** A gem → credit bundle as offered to the owner, with its bonus over the base (smallest) bundle. */
export interface GemExchangeOffer {
  gems: number;
  credits: number;
  /** Extra credits over the base rate, in whole percent (0 for the base bundle). */
  bonusPct: number;
}

/** Credits per gem at the smallest bundle — the rate the volume bonus is measured against. */
export function gemExchangeBaseRate(cfg: GameConfig): number {
  const base = [...cfg.economy.gemExchange.bundles].sort((a, b) => a.gems - b.gems)[0];
  return base ? base.credits / base.gems : 0;
}

/** The bundles on offer, smallest first. */
export function gemExchangeOffers(cfg: GameConfig): GemExchangeOffer[] {
  const rate = gemExchangeBaseRate(cfg);
  return [...cfg.economy.gemExchange.bundles]
    .sort((a, b) => a.gems - b.gems)
    .map((b) => ({
      gems: b.gems,
      credits: b.credits,
      bonusPct: rate > 0 ? Math.max(0, Math.round((b.credits / (b.gems * rate) - 1) * 100)) : 0,
    }));
}

/** Admin override sanity: whole positive amounts, one bundle per gem price, a non-negative cap. */
export function gemExchangeProblems(cfg: GameConfig): string[] {
  const x = cfg.economy.gemExchange;
  const out: string[] = [];
  if (!Number.isSafeInteger(x.dailyCreditLimit) || x.dailyCreditLimit < 0)
    out.push("economy.gemExchange.dailyCreditLimit: expected a whole number ≥ 0");
  const seen = new Set<number>();
  x.bundles.forEach((b, i) => {
    if (!Number.isSafeInteger(b.gems) || b.gems <= 0 || !Number.isSafeInteger(b.credits) || b.credits <= 0)
      out.push(`economy.gemExchange.bundles[${i}]: gems and credits must be whole numbers > 0`);
    if (seen.has(b.gems)) out.push(`economy.gemExchange.bundles[${i}]: another bundle has ${b.gems} gems`);
    seen.add(b.gems);
  });
  return out;
}
