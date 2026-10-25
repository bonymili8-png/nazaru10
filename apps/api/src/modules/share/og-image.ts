import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

/** Social preview cards (1200×630 PNG) drawn as SVG in the game's style: dark, gold, serif titles. */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const C = {
  bg: "#0c0a09",
  surface: "#1c1917",
  line: "#44403c",
  ink: "#fafaf9",
  muted: "#a8a29e",
  gold: "#e0b43a",
  goldDeep: "#a16207",
};

/** The bundled OFL fonts (apps/api/assets/fonts), found from the build or the source tree. */
function fontDir(): string {
  const starts = [process.cwd(), typeof __dirname === "undefined" ? process.cwd() : __dirname];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 6; i++) {
      for (const candidate of [join(dir, "assets", "fonts"), join(dir, "apps", "api", "assets", "fonts")])
        if (existsSync(join(candidate, "Inter_400Regular.ttf"))) return candidate;
      dir = resolve(dir, "..");
    }
  }
  throw new Error("OG fonts not found (apps/api/assets/fonts)");
}

let fonts: string[] | null = null;
const fontFiles = () =>
  (fonts ??= ["Inter_400Regular.ttf", "Inter_700Bold.ttf", "PlayfairDisplay_700Bold.ttf"].map((f) =>
    join(fontDir(), f),
  ));

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!,
  );

/** Shorten to `max` characters with an ellipsis (names are short, but race names can run long). */
export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Shared frame: background glow, a track drawn in gold, the brand and the call to action. */
function frame(body: string, cta: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <radialGradient id="glow" cx="78%" cy="30%" r="70%">
      <stop offset="0" stop-color="${C.goldDeep}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${C.bg}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="${C.bg}"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <g fill="none" stroke="${C.gold}" stroke-opacity="0.22">
    <ellipse cx="960" cy="330" rx="330" ry="210" stroke-width="3"/>
    <ellipse cx="960" cy="330" rx="290" ry="172" stroke-width="2"/>
    <ellipse cx="960" cy="330" rx="250" ry="134" stroke-width="1.5"/>
    <line x1="960" y1="100" x2="960" y2="172" stroke-width="4" stroke-opacity="0.5"/>
  </g>
  <text x="64" y="86" font-family="Playfair Display" font-weight="700" font-size="34" letter-spacing="6" fill="${C.gold}">THOROUGHLINE</text>
  ${body}
  <rect x="64" y="520" width="${Math.min(1072, 40 + cta.length * 17)}" height="62" rx="31" fill="${C.gold}"/>
  <text x="96" y="561" font-family="Inter" font-weight="700" font-size="28" fill="${C.bg}">${esc(cta)}</text>
  <text x="1136" y="602" text-anchor="end" font-family="Inter" font-size="20" fill="${C.muted}">Horse racing sim in Telegram · No betting</text>
</svg>`;
}

const ORDINAL = ["1st", "2nd", "3rd"];

export interface RaceCard {
  raceName: string;
  meta: string;
  podium: { name: string; time?: number | null }[];
}

/** A finished race: the winner big, the places under it. */
export function raceCardSvg(r: RaceCard): string {
  const [winner, ...rest] = r.podium;
  const places = rest
    .slice(0, 2)
    .map(
      (p, i) =>
        `<text x="64" y="${388 + i * 50}" font-family="Inter" font-size="32" fill="${C.ink}"><tspan fill="${C.muted}">${ORDINAL[i + 1]}</tspan>  ${esc(clip(p.name, 26))}</text>`,
    )
    .join("");
  const body = `
  <text x="64" y="176" font-family="Inter" font-size="28" fill="${C.muted}">${esc(clip(r.raceName, 52))}</text>
  <text x="64" y="214" font-family="Inter" font-size="24" fill="${C.muted}">${esc(clip(r.meta, 60))}</text>
  <text x="64" y="300" font-family="Playfair Display" font-weight="700" font-size="68" fill="${C.ink}">${esc(clip(winner?.name ?? "", 20))}</text>
  <text x="64" y="340" font-family="Inter" font-weight="700" font-size="28" fill="${C.gold}">WINS${winner?.time ? `  ·  ${winner.time.toFixed(2)}s` : ""}</text>
  ${places}`;
  return frame(body, "Watch the replay · Play free");
}

export interface HorseCard {
  name: string;
  line: string;
  record: string;
  rating: number;
  stable: string | null;
}

/** A horse: name, age/sex/coat, career record and rating. */
export function horseCardSvg(h: HorseCard): string {
  const body = `
  <text x="64" y="250" font-family="Playfair Display" font-weight="700" font-size="76" fill="${C.ink}">${esc(clip(h.name, 18))}</text>
  <text x="64" y="300" font-family="Inter" font-size="30" fill="${C.muted}">${esc(clip(h.line, 48))}</text>
  ${h.stable ? `<text x="64" y="342" font-family="Inter" font-size="26" fill="${C.muted}">${esc(clip(h.stable, 40))}</text>` : ""}
  <text x="64" y="420" font-family="Inter" font-weight="700" font-size="34" fill="${C.ink}">${esc(h.record)}</text>
  <text x="64" y="466" font-family="Inter" font-weight="700" font-size="28" fill="${C.gold}">RATING ${h.rating}</text>`;
  return frame(body, "Can your horse beat this one? Play free");
}

export interface TableCard {
  title: string;
  subtitle: string;
  rows: { name: string; detail: string }[];
}

/** A ranked list (top of the week): up to five rows. */
export function tableCardSvg(t: TableCard): string {
  const rows = t.rows
    .slice(0, 5)
    .map(
      (r, i) => `
  <text x="64" y="${262 + i * 52}" font-family="Playfair Display" font-weight="700" font-size="34" fill="${i === 0 ? C.gold : C.muted}">${i + 1}</text>
  <text x="112" y="${262 + i * 52}" font-family="Inter" font-weight="700" font-size="32" fill="${C.ink}">${esc(clip(r.name, 22))}</text>
  <text x="560" y="${262 + i * 52}" text-anchor="end" font-family="Inter" font-size="24" fill="${C.muted}">${esc(clip(r.detail, 26))}</text>`,
    )
    .join("");
  const body = `
  <text x="64" y="162" font-family="Playfair Display" font-weight="700" font-size="56" fill="${C.ink}">${esc(clip(t.title, 26))}</text>
  <text x="64" y="200" font-family="Inter" font-size="26" fill="${C.muted}">${esc(clip(t.subtitle, 56))}</text>
  ${rows}`;
  return frame(body, "Train your own · Play free");
}

/** Rasterise a card with the bundled fonts only (identical output on every machine). */
export function renderPng(svg: string): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: OG_WIDTH },
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: "Inter" },
  });
  return r.render().asPng();
}
