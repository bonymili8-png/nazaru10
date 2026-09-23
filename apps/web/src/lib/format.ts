export const fmt = (n: number) => new Intl.NumberFormat("en").format(Math.round(n));

export function countdown(targetIso: string, now: number): string {
  const s = Math.max(0, Math.round((new Date(targetIso).getTime() - now) / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export const CLASS_NAMES: Record<string, string> = {
  MAIDEN: "Maiden",
  CLASS_5: "Class 5",
  CLASS_4: "Class 4",
  CLASS_3: "Class 3",
  CLASS_2: "Class 2",
  CLASS_1: "Class 1",
};

export const STRATEGY_INFO: Record<string, { label: string; hint: string }> = {
  FRONT_RUNNER: { label: "Front runner", hint: "Go for the lead early. Suits keen, fast starters." },
  PACE_SETTER: { label: "Pace setter", hint: "Sit just behind the leaders and press." },
  MID_PACK: { label: "Mid pack", hint: "Even pace in the middle. Reliable default." },
  CLOSER: { label: "Closer", hint: "Save energy, finish fast. Needs a strong kick." },
  CONSERVATIVE: { label: "Conservative", hint: "Hold back a reserve. Safer, fewer wins." },
  AGGRESSIVE: { label: "Aggressive", hint: "Push hard all race. High risk of tiring." },
};

export const TRAINING_INFO: Record<string, { label: string; focus: string }> = {
  SPEED: { label: "Speed work", focus: "Speed · Acceleration" },
  ACCELERATION: { label: "Acceleration", focus: "Acceleration · Start" },
  STAMINA: { label: "Stamina", focus: "Stamina · Endurance" },
  STRENGTH: { label: "Strength", focus: "Strength" },
  AGILITY: { label: "Agility", focus: "Agility · Cornering" },
  STARTS: { label: "Gate practice", focus: "Start · Focus" },
  FINISHING: { label: "Finishing", focus: "Final kick" },
  MENTAL: { label: "Mental", focus: "Focus" },
  TACTICAL: { label: "Tactical", focus: "Cornering · Focus" },
  RECOVERY: { label: "Recovery", focus: "Reduces fatigue, restores health" },
};

export const ATTRIBUTE_LABELS: Record<string, string> = {
  speed: "Speed",
  acceleration: "Acceleration",
  stamina: "Stamina",
  endurance: "Endurance",
  strength: "Strength",
  agility: "Agility",
  start: "Start",
  cornering: "Cornering",
  finalKick: "Final kick",
  focus: "Focus",
};
