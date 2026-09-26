import { Rng } from "../rng.js";
import type { RaceEvent } from "./simulate.js";

export interface CommentaryLine {
  t: number;
  /** English text (also the fallback for clients without a translation). */
  text: string;
  /** Template id, `<EVENT_TYPE>.<index>`, so clients can render the same line in their language. */
  key: string;
  /** Template values: horse names, and `v` as a raw number (a position or a margin in lengths). */
  vars: { h: string; o1: string; o2: string; v?: number };
}

/** Number of template variants per event type (clients keep translations index-aligned). */
export const COMMENTARY_VARIANTS = (type: RaceEvent["type"], lang: CommentaryLang = "en"): number =>
  TEMPLATES[lang][type].length;

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

/** Ukrainian templates, index-aligned with the English ones above (enforced by tests). */
const UK: Record<RaceEvent["type"], readonly string[]> = {
  GOOD_BREAK: [
    "{h} блискавично вилітає зі стартових боксів!",
    "Блискавичний старт у {h}!",
    "{h} стартує найшвидше.",
  ],
  SLOW_START: [
    "{h} повільно стартує — це може дорого коштувати.",
    "Проблеми на старті в {h} — старт пропущено.",
  ],
  LEAD_CHANGE: [
    "{h} виходить уперед!",
    "Зміна лідера — тепер попереду {h}!",
    "{h} ривком захоплює лідерство.",
  ],
  HALFWAY: [
    "Половина дистанції: лідирує {h}, за ним {o1} і {o2}.",
    "На половині дистанції — {h}, далі {o1}, потім {o2}.",
  ],
  FINAL_TURN: [
    "Останній поворот — {h} досі попереду, {o1} напоготові.",
    "Проходять фінальний поворот, веде {h}.",
  ],
  HOME_STRAIGHT: [
    "Фінішна пряма: лідирує {h}, {o1} і {o2} переслідують!",
    "Фінішна пряма! Попереду {h}, {o1} наближається.",
  ],
  MOVE_UP: [
    "{h} стрімко просувається — вже {v}!",
    "По зовнішній іде {h}, тепер {v}!",
    "{h} летить — уже {v}!",
  ],
  BLOCKED: ["{h} затиснутий і шукає простір.", "Для {h} поки що немає проходу!"],
  KICK: ["{h} робить фінішний ривок!", "{h} подовжує крок і йде ва-банк!"],
  TIRING: ["{h} починає відчувати темп.", "У {h} закінчуються сили."],
  PHOTO_FINISH: ["Неймовірно близько між {h} і {o1} — фотофініш!"],
  FINISH: [
    "Перемога {h}! {o1} другий, відставання — {v} корпусу.",
    "{h} першим перетинає фініш! {o1} другий ({v} к.).",
  ],
};

export type CommentaryLang = "en" | "uk";
const TEMPLATES: Record<CommentaryLang, typeof T> = { en: T, uk: UK };

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
    const templates = T[e.type];
    // Same draw as rng.pick(templates), keeping lines identical for already-seeded races.
    const index = Math.floor(rng.next() * templates.length);
    const tpl = templates[index]!;
    const vars = {
      h: name(e.horseId),
      o1: name(e.others?.[e.type === "FINISH" || e.type === "PHOTO_FINISH" ? 0 : 1]),
      o2: name(e.others?.[2]),
      ...(e.value !== undefined ? { v: e.value } : {}),
    };
    const value =
      e.type === "MOVE_UP" && e.value !== undefined
        ? ordinal(e.value)
        : e.value !== undefined
          ? String(e.value)
          : "";
    const text = tpl
      .replaceAll("{h}", vars.h)
      .replaceAll("{o1}", vars.o1)
      .replaceAll("{o2}", vars.o2)
      .replaceAll("{v}", value);
    return { t: e.t, text, key: `${e.type}.${index}`, vars };
  });
}

/**
 * Re-render a stored line in another language from its template key and values.
 * Returns null when the line predates keys or the template is unknown (callers show `text`).
 */
export function renderCommentary(
  line: Pick<CommentaryLine, "key" | "vars"> | { key?: string; vars?: CommentaryLine["vars"] },
  lang: CommentaryLang,
): string | null {
  if (!line.key || !line.vars) return null;
  const [type, index] = line.key.split(".") as [RaceEvent["type"], string];
  const tpl = TEMPLATES[lang][type]?.[Number(index)];
  if (!tpl) return null;
  const { h, o1, o2, v } = line.vars;
  const value =
    v === undefined
      ? ""
      : type === "MOVE_UP"
        ? lang === "uk"
          ? `${v}-й`
          : ordinal(v)
        : lang === "uk"
          ? v.toLocaleString("uk-UA", { maximumFractionDigits: 2 })
          : String(v);
  return tpl.replaceAll("{h}", h).replaceAll("{o1}", o1).replaceAll("{o2}", o2).replaceAll("{v}", value);
}
