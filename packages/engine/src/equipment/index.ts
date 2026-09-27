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
