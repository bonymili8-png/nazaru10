import { Rng } from "../rng.js";
import type { RaceEvent } from "./simulate.js";

export interface CommentaryLine {
  t: number;
  text: string;
}

const T: Record<RaceEvent["type"], readonly string[]> = {
  GOOD_BREAK: ["{h} breaks sharply from the gates!", "A lightning start from {h}!", "{h} is quickest away."],
  SLOW_START: [
    "{h} is slowly away — that could be costly.",
    "Trouble at the start for {h}, who misses the break.",
  ],
  LEAD_CHANGE: [
    "{h} takes over at the front!",
    "Change of leader — it's {h} now!",
    "{h} surges into the lead.",
  ],
  HALFWAY: ["Halfway: {h} leads from {o1} and {o2}.", "At the halfway mark it's {h}, then {o1}, then {o2}."],
  FINAL_TURN: [
    "Into the final turn — {h} still in front, {o1} poised.",
    "They sweep round the home turn with {h} in charge.",
  ],
  HOME_STRAIGHT: [
    "Into the straight: {h} leads, {o1} and {o2} give chase!",
    "Final straight! {h} in front, {o1} closing.",
  ],
  MOVE_UP: [
    "{h} is making rapid progress — up to {v}!",
    "Here comes {h} on the outside, now {v}!",
    "{h} is flying, moving into {v}!",
  ],
  BLOCKED: ["{h} is boxed in and looking for room.", "No way through for {h} at the moment!"],
  KICK: ["{h} kicks for home!", "{h} lengthens stride and goes for it!"],
  TIRING: ["{h} is starting to feel the pace.", "{h} is running on empty now."],
  PHOTO_FINISH: ["It's desperately close between {h} and {o1} — photo finish!"],
  FINISH: [
    "{h} wins it! {o1} second, beaten {v} lengths.",
    "{h} crosses the line first! {o1} runs on for second ({v} L).",
  ],
};

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * Build commentary purely from simulation events (never invents facts).
 * Template choice is deterministic for a given seed.
 */
export function buildCommentary(
  events: readonly RaceEvent[],
  names: Record<string, string>,
  seed: string,
): CommentaryLine[] {
  const rng = new Rng(`commentary:${seed}`);
  const name = (id?: string) => (id ? (names[id] ?? "Unknown") : "");
  return events.map((e) => {
    const tpl = rng.pick(T[e.type]);
    const value =
      e.type === "MOVE_UP" && e.value !== undefined
        ? ordinal(e.value)
        : e.value !== undefined
          ? String(e.value)
          : "";
    const text = tpl
      .replaceAll("{h}", name(e.horseId))
      .replaceAll("{o1}", name(e.others?.[e.type === "FINISH" || e.type === "PHOTO_FINISH" ? 0 : 1]))
      .replaceAll("{o2}", name(e.others?.[2]))
      .replaceAll("{v}", value);
    return { t: e.t, text };
  });
}
