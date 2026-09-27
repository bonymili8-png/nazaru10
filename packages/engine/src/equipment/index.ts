import type { GameConfig, GearItem } from "../config/index.js";
import type { Attributes, TrainableAttribute } from "../horse/types.js";
import { clamp } from "../math.js";

/** Race-day attributes with a gear item applied (unchanged without gear). Values stay in 1–100. */
export function applyGear(attributes: Attributes, gear: GearItem | null, cfg: GameConfig): Attributes {
  if (!gear) return attributes;
  const out = { ...attributes };
  for (const [k, d] of Object.entries(cfg.equipment[gear].mods) as [TrainableAttribute, number][])
    out[k] = clamp(out[k] + d, 1, 100);
  return out;
}

/** Credits to restore an item after `used` races (proportional to wear; 0 when unused). */
export function gearRepairCost(gear: GearItem, used: number, cfg: GameConfig): number {
  const share = Math.min(1, Math.max(0, used) / cfg.gearWear.races);
  return Math.round(cfg.equipment[gear].cost * cfg.gearWear.repairRate * share);
}
