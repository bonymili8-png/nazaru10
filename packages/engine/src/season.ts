import type { GameConfig, RaceClass } from "./config/index.js";

export interface SeasonWindow {
  season: number;
  startsAt: Date;
  endsAt: Date;
}

const DAY = 86_400_000;

/** Season containing `at` (seasons last one game year and start at `seasons.epoch`). */
export function seasonAt(at: Date, cfg: GameConfig): SeasonWindow {
  const epoch = new Date(cfg.seasons.epoch).getTime();
  const len = cfg.lifecycle.realDaysPerGameYear * DAY;
  const idx = Math.max(0, Math.floor((at.getTime() - epoch) / len));
  return seasonWindow(idx + 1, cfg);
}

export function seasonWindow(season: number, cfg: GameConfig): SeasonWindow {
  const epoch = new Date(cfg.seasons.epoch).getTime();
  const len = cfg.lifecycle.realDaysPerGameYear * DAY;
  return { season, startsAt: new Date(epoch + (season - 1) * len), endsAt: new Date(epoch + season * len) };
}

/** Season points for a finishing position in a race of the given class. */
export function seasonPoints(position: number, cls: RaceClass, cfg: GameConfig): number {
  const base = cfg.seasons.placingPoints[position - 1] ?? 0;
  return Math.round(base * cfg.seasons.classMultiplier[cls]);
}

export function seasonReward(rank: number, cfg: GameConfig) {
  return cfg.seasons.rewards.find((r) => rank >= r.fromRank && rank <= r.toRank) ?? null;
}
