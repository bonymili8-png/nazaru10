import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAsync } from "@resvg/resvg-js";
import { SILK_COLORS, type Silks } from "@thoroughline/contracts";
import { clip, esc, fontFiles } from "../share/og-image.js";

/**
 * Vertical race videos (9:16 MP4) for Shorts, Reels and the like, drawn from a finished race's
 * recorded frames: the side-on camera that follows the leader (as in the game), the running
 * order under it, the long middle of the race fast-forwarded and the finish in real time, then
 * the result. Every frame is an SVG rasterised with the bundled fonts on libuv's thread pool and
 * piped raw into ffmpeg (H.264 + a silent AAC track, faststart — what every platform accepts).
 */

export const VIDEO_W = 720;
export const VIDEO_H = 1280;

type Frame = [number, number, number, number];

export interface VideoRunner {
  id: string;
  name: string;
  gate: number | null;
  silks: Silks | null;
  position: number | null;
}

export interface RaceVideoInput {
  /** What the post is about, e.g. "RACE OF THE DAY". */
  headline: string;
  raceName: string;
  /** Track · distance · going. */
  meta: string;
  distance: number;
  frames: { interval: number; ids: string[]; data: Frame[][] };
  runners: VideoRunner[];
  /** Under the winner's name at the end, e.g. "WINS BY A NECK". */
  winnerLine: string;
  /** Where to play: the bot's @username. */
  handle: string;
}

const C = {
  bg: "#0c0a09",
  surface: "#1c1917",
  line: "#44403c",
  ink: "#fafaf9",
  muted: "#a8a29e",
  gold: "#e0b43a",
  goldDeep: "#a16207",
};

/** Colours for runners without silks (house horses), as in the game. */
const FALLBACK = [
  "#e0b43a",
  "#60a5fa",
  "#f87171",
  "#4ade80",
  "#c084fc",
  "#fb923c",
  "#2dd4bf",
  "#f472b6",
  "#a3e635",
  "#e5e7eb",
  "#facc15",
  "#38bdf8",
];

/* ───────────────────────────── timeline ───────────────────────────── */

export type Shot = { scene: "race"; t: number; speed: number } | { scene: "result"; k: number };

/** Seconds of video the start of the race may take before the finish (fast-forwarded). */
const RUN_UP = 15;
/** Race seconds before the winner's finish shown in real time, and after it. */
const FINALE_BEFORE = 7;
const FINALE_AFTER = 1.5;
/** Seconds over which the fast-forward slows to real time. */
const RAMP = 1.5;
const HOLD_START = 1;
const HOLD_END = 0.8;
const RESULT = 4.2;

/** When the leader crosses the line (seconds), from the frames. */
export function winnerTime(frames: RaceVideoInput["frames"], distance: number): number {
  const rows = frames.data;
  for (let k = 1; k < rows.length; k++) {
    const b = Math.max(...rows[k]!.map((r) => r[0]));
    if (b >= distance) {
      const a = Math.max(...rows[k - 1]!.map((r) => r[0]));
      const f = b === a ? 1 : Math.min(1, Math.max(0, (distance - a) / (b - a)));
      return (k - 1 + f) * frames.interval;
    }
  }
  return (rows.length - 1) * frames.interval;
}

/**
 * What each video frame shows: a still at the gates, the race with its early part sped up so the
 * run-up takes about 15 s and the last furlong plays in real time, a still on the line, then the
 * result card.
 */
export function timeline(input: Pick<RaceVideoInput, "frames" | "distance">, fps: number): Shot[] {
  const end = (input.frames.data.length - 1) * input.frames.interval;
  const tw = winnerTime(input.frames, input.distance);
  const bStart = Math.max(0, tw - FINALE_BEFORE);
  const bEnd = Math.min(end, tw + FINALE_AFTER);
  // Fast-forward speed s so that (bStart − RAMP·(s+1)/2)/s + RAMP = RUN_UP.
  const s = Math.max(1, (bStart - RAMP / 2) / (RUN_UP - RAMP / 2));
  const ramp = s > 1 ? RAMP : 0;
  const rampRace = (ramp * (s + 1)) / 2;
  const fastVideo = (bStart - rampRace) / s;
  const shots: Shot[] = [];
  const dt = 1 / fps;
  for (let v = 0; v < HOLD_START; v += dt) shots.push({ scene: "race", t: 0, speed: 1 });
  // Run-up: constant speed, then a linear slow-down to real time.
  for (let v = 0; v < fastVideo + ramp; v += dt) {
    if (v < fastVideo) shots.push({ scene: "race", t: v * s, speed: s });
    else {
      const u = v - fastVideo;
      const speed = s + ((1 - s) * u) / ramp;
      shots.push({ scene: "race", t: s * fastVideo + s * u + ((1 - s) * u * u) / (2 * ramp), speed });
    }
  }
  for (let t = bStart; t <= bEnd; t += dt) shots.push({ scene: "race", t, speed: 1 });
  for (let v = 0; v < HOLD_END; v += dt) shots.push({ scene: "race", t: bEnd, speed: 1 });
  const n = Math.round(RESULT * fps);
  for (let i = 0; i < n; i++) shots.push({ scene: "result", k: i / n });
  return shots;
}

/** Interpolated runner rows at time t. */
function sample(frames: RaceVideoInput["frames"], t: number): Frame[] {
  const rows = frames.data;
  const f = Math.max(0, t / frames.interval);
  const k = Math.min(rows.length - 1, Math.floor(f));
  const a = rows[k]!;
  const b = rows[Math.min(rows.length - 1, k + 1)]!;
  const u = Math.min(1, f - k);
  return a.map((ra, i) => {
    const rb = b[i]!;
    return [ra[0] + (rb[0] - ra[0]) * u, ra[1] + (rb[1] - ra[1]) * u, ra[2], ra[3]] as Frame;
  });
}

/* ───────────────────────────── drawing ───────────────────────────── */

/** A runner's silk inside a circle (the game's patterns), or a plain colour. */
function silk(s: Silks | null, fallback: string, cx: number, cy: number, r: number, id: string): string {
  if (!s) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fallback}"/>`;
  const a = SILK_COLORS[s.primary];
  const b = SILK_COLORS[s.secondary];
  const x0 = cx - r;
  const y0 = cy - r;
  const d = r * 2;
  let marks = "";
  const rect = (x: number, y: number, w: number, h: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${b}"/>`;
  switch (s.pattern) {
    case "HOOPS":
      marks = [0.18, 0.5, 0.82].map((f) => rect(x0, y0 + d * f - d * 0.08, d, d * 0.16)).join("");
      break;
    case "STRIPES":
      marks = [0.18, 0.5, 0.82].map((f) => rect(x0 + d * f - d * 0.08, y0, d * 0.16, d)).join("");
      break;
    case "SASH":
      marks = `<polygon points="${x0},${y0 + d * 0.2} ${x0 + d * 0.2},${y0} ${x0 + d},${y0 + d * 0.8} ${x0 + d * 0.8},${y0 + d}" fill="${b}"/>`;
      break;
    case "QUARTERED":
      marks = rect(cx, y0, r, r) + rect(x0, cy, r, r);
      break;
    case "CROSS":
      marks = rect(cx - d * 0.1, y0, d * 0.2, d) + rect(x0, cy - d * 0.1, d, d * 0.2);
      break;
    case "DIAMONDS":
      marks = [
        [0.3, 0.3],
        [0.7, 0.3],
        [0.5, 0.55],
        [0.3, 0.8],
        [0.7, 0.8],
      ]
        .map(([fx, fy]) => {
          const x = x0 + d * fx!;
          const y = y0 + d * fy!;
          const q = d * 0.13;
          return `<polygon points="${x},${y - q} ${x + q},${y} ${x},${y + q} ${x - q},${y}" fill="${b}"/>`;
        })
        .join("");
      break;
    case "STAR": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r * 0.72 : r * 0.3;
        return `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
      }).join(" ");
      marks = `<polygon points="${pts}" fill="${b}"/>`;
      break;
    }
    case "CHEVRON":
      marks = [0.3, 0.62]
        .map(
          (f) =>
            `<polyline points="${x0},${y0 + d * f} ${cx},${y0 + d * (f + 0.22)} ${x0 + d},${y0 + d * f}" fill="none" stroke="${b}" stroke-width="${d * 0.11}"/>`,
        )
        .join("");
      break;
    case "CHECK": {
      const cell = d / 4;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++)
          if ((i + j) % 2 === 1) marks += rect(x0 + i * cell, y0 + j * cell, cell, cell);
      break;
    }
  }
  return `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="${a}"/><g clip-path="url(#${id})">${marks}</g>`;
}

/** A runner's silk with its saddle-cloth number on it (camera and running order alike). */
function marker(r: VideoRunner, fill: string, x: number, y: number, rad: number, id: string, size: number) {
  return (
    silk(r.silks, fill, x, y, rad, id) +
    `<circle cx="${x}" cy="${y}" r="${rad}" fill="none" stroke="${C.bg}" stroke-width="${rad / 5}"/>` +
    `<text x="${x}" y="${y + size * 0.36}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${size}" fill="${C.ink}" stroke="${C.bg}" stroke-width="${size / 4}" paint-order="stroke">${r.gate ?? ""}</text>`
  );
}

/** Camera geometry, in the game's 400-wide units (scaled to the video's width). */
const CAM = { W: 400, H: 150, BEHIND: 44, AHEAD: 6, LEFT: 20, RIGHT: 386, TOP: 34, R: 10 };
const CAM_Y = 280;
/** Where the running order starts, under the camera and the distance line. */
const STATUS_Y = CAM_Y + CAM.H * (VIDEO_W / CAM.W) + 70;
const CAM_SCALE = VIDEO_W / CAM.W;
const PX_PER_M = (CAM.RIGHT - CAM.LEFT) / (CAM.BEHIND + CAM.AHEAD);
/** About 2.4 m to a length. */
const METRES_PER_LENGTH = 2.4;

function camera(input: RaceVideoInput, pos: Frame[], color: (i: number) => string): string {
  const { distance } = input;
  const leader = Math.max(...pos.map((p) => p[0]));
  const toX = (x: number) => CAM.RIGHT - (leader + CAM.AHEAD - x) * PX_PER_M;
  // Lanes spread over the band: the field rarely uses more than a few, so the shot is cropped
  // to the widest lane anyone ran in (at least six).
  let widest = 5;
  for (const row of input.frames.data) for (const r of row) widest = Math.max(widest, r[1]);
  const lanes = Math.min(12, Math.ceil(widest));
  const laneY = (lane: number) =>
    CAM.TOP +
    CAM.R +
    4 +
    (Math.max(0, Math.min(lanes, lane)) * (CAM.H - CAM.TOP - 10 - 2 * CAM.R - 8)) / lanes;
  const posts: number[] = [];
  for (let d = Math.ceil((leader - CAM.BEHIND - 5) / 5) * 5; d <= leader + CAM.AHEAD + 5; d += 5)
    posts.push(d);
  const poles = posts.filter((d) => d > 0 && d < distance && (distance - d) % 100 === 0);
  const finishX = toX(distance);
  const ground = CAM.H - CAM.TOP - 10;
  let svg = `<rect x="0" y="${CAM.TOP}" width="${CAM.W}" height="${ground}" fill="#1f3a24"/>`;
  for (const d of posts)
    if (d % 10 === 0)
      svg += `<rect x="${toX(d)}" y="${CAM.TOP}" width="${5 * PX_PER_M}" height="${ground}" fill="#23422a"/>`;
  svg += `<line x1="0" y1="${CAM.TOP}" x2="${CAM.W}" y2="${CAM.TOP}" stroke="#d6d3d1" stroke-width="2.5"/>`;
  for (const d of posts)
    svg += `<line x1="${toX(d)}" y1="${CAM.TOP - 7}" x2="${toX(d)}" y2="${CAM.TOP}" stroke="#a8a29e" stroke-width="1.5"/>`;
  for (const d of poles)
    svg += `<line x1="${toX(d)}" y1="${CAM.TOP - 18}" x2="${toX(d)}" y2="${CAM.TOP}" stroke="${C.ink}" stroke-width="2.5"/><text x="${toX(d)}" y="${CAM.TOP - 21}" text-anchor="middle" font-family="Inter" font-size="10" fill="${C.ink}">${distance - d}m</text>`;
  if (finishX >= CAM.LEFT - 4 && finishX <= CAM.RIGHT + 4)
    svg += `<line x1="${finishX}" y1="${CAM.TOP - 20}" x2="${finishX}" y2="${CAM.H - 10}" stroke="${C.gold}" stroke-width="3"/><text x="${finishX}" y="${CAM.TOP - 23}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="11" fill="${C.gold}">FINISH</text>`;
  svg += `<line x1="0" y1="${CAM.H - 10}" x2="${CAM.W}" y2="${CAM.H - 10}" stroke="#78716c" stroke-width="1.5"/>`;
  const runners = pos
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => leader - p[0] <= CAM.BEHIND)
    .sort((a, b) => a.p[0] - b.p[0]);
  for (const { p, i } of runners) {
    const r = input.runners[i]!;
    const x = toX(p[0]);
    const y = laneY(p[1]);
    svg += marker(r, color(i), x, y, CAM.R, `c${i}`, 11);
  }
  return `<g transform="translate(0 ${CAM_Y}) scale(${CAM_SCALE})">${svg}</g>`;
}

function header(input: RaceVideoInput): string {
  return `<text x="40" y="78" font-family="Playfair Display" font-weight="700" font-size="30" letter-spacing="6" fill="${C.gold}">THOROUGHLINE</text>
  <text x="40" y="134" font-family="Inter" font-weight="700" font-size="26" letter-spacing="2" fill="${C.gold}">${esc(clip(input.headline, 34))}</text>
  <text x="40" y="190" font-family="Playfair Display" font-weight="700" font-size="40" fill="${C.ink}">${esc(clip(input.raceName, 28))}</text>
  <text x="40" y="232" font-family="Inter" font-size="24" fill="${C.muted}">${esc(clip(input.meta, 46))}</text>`;
}

function footer(input: RaceVideoInput): string {
  return `<text x="${VIDEO_W / 2}" y="1196" text-anchor="middle" font-family="Inter" font-size="24" fill="${C.muted}">Free horse racing sim in Telegram · no betting</text>
  <text x="${VIDEO_W / 2}" y="1238" text-anchor="middle" font-family="Inter" font-weight="700" font-size="28" fill="${C.gold}">${esc(input.handle)}</text>`;
}

const ROWS_Y = STATUS_Y + 80;
const ROW_H = 50;
const MAX_ROWS = 8;

function raceFrame(
  input: RaceVideoInput,
  shot: Extract<Shot, { scene: "race" }>,
  color: (i: number) => string,
) {
  const pos = sample(input.frames, shot.t);
  const leader = Math.max(...pos.map((p) => p[0]));
  const toGo = Math.max(0, Math.round(input.distance - leader));
  // Running order; once over the line, the official placings (frames are too coarse for photos).
  const order = pos
    .map((p, i) => ({ p, i, done: p[0] >= input.distance }))
    .sort((a, b) =>
      a.done && b.done
        ? (input.runners[a.i]!.position ?? 99) - (input.runners[b.i]!.position ?? 99)
        : b.p[0] - a.p[0],
    );
  const rows = order.slice(0, order.length > MAX_ROWS ? MAX_ROWS - 1 : MAX_ROWS);
  let list = "";
  rows.forEach(({ p, i }, n) => {
    const r = input.runners[i]!;
    const y = ROWS_Y + n * ROW_H;
    const gap = leader - p[0];
    const gapText = n === 0 ? "" : gap < 0.3 ? "level" : `+${(gap / METRES_PER_LENGTH).toFixed(1)} L`;
    list += `<text x="58" y="${y + 9}" text-anchor="end" font-family="Inter" font-weight="700" font-size="26" fill="${n === 0 ? C.gold : C.muted}">${n + 1}</text>`;
    list += marker(r, color(i), 92, y, 18, `l${i}`, 18);
    list += `<text x="126" y="${y + 9}" font-family="Inter" font-weight="700" font-size="28" fill="${C.ink}">${esc(clip(r.name, 22))}</text>`;
    list += `<text x="${VIDEO_W - 40}" y="${y + 9}" text-anchor="end" font-family="Inter" font-size="24" fill="${C.muted}">${gapText}</text>`;
  });
  if (order.length > rows.length)
    list += `<text x="126" y="${ROWS_Y + rows.length * ROW_H + 8}" font-family="Inter" font-size="24" fill="${C.muted}">and ${order.length - rows.length} more</text>`;
  const status =
    toGo > 0
      ? `<text x="40" y="${STATUS_Y}" font-family="Inter" font-weight="700" font-size="34" fill="${C.ink}">${toGo}m <tspan fill="${C.muted}" font-weight="400">to go</tspan></text>`
      : `<text x="40" y="${STATUS_Y}" font-family="Inter" font-weight="700" font-size="34" fill="${C.gold}">FINISH</text>`;
  const speed =
    shot.speed > 1.05
      ? `<text x="${VIDEO_W - 40}" y="${STATUS_Y}" text-anchor="end" font-family="Inter" font-weight="700" font-size="24" fill="${C.muted}">${Math.round(shot.speed)}× SPEED</text>`
      : shot.t > 0
        ? `<text x="${VIDEO_W - 40}" y="${STATUS_Y}" text-anchor="end" font-family="Inter" font-weight="700" font-size="24" fill="${C.gold}">LIVE SPEED</text>`
        : "";
  return `${camera(input, pos, color)}${status}${speed}${list}`;
}

const ORDINAL = ["1st", "2nd", "3rd"];

function resultFrame(input: RaceVideoInput, k: number, color: (i: number) => string) {
  const fade = Math.min(1, k * 8);
  const placed = input.runners
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.position !== null)
    .sort((a, b) => a.r.position! - b.r.position!);
  const [winner, ...rest] = placed;
  if (!winner) return "";
  const places = rest
    .slice(0, 2)
    .map(
      ({ r }, n) =>
        `<text x="${VIDEO_W / 2}" y="${700 + n * 56}" text-anchor="middle" font-family="Inter" font-size="32" fill="${C.ink}"><tspan fill="${C.muted}">${ORDINAL[n + 1]}</tspan>  ${esc(clip(r.name, 22))}</text>`,
    )
    .join("");
  return `<g opacity="${fade}">
  <text x="${VIDEO_W / 2}" y="330" text-anchor="middle" font-family="Inter" font-weight="700" font-size="26" letter-spacing="4" fill="${C.gold}">RESULT</text>
  ${silk(winner.r.silks, color(winner.i), VIDEO_W / 2, 430, 62, "win")}
  <circle cx="${VIDEO_W / 2}" cy="430" r="62" fill="none" stroke="${C.gold}" stroke-width="5"/>
  <text x="${VIDEO_W / 2}" y="574" text-anchor="middle" font-family="Playfair Display" font-weight="700" font-size="60" fill="${C.ink}">${esc(clip(winner.r.name, 18))}</text>
  <text x="${VIDEO_W / 2}" y="622" text-anchor="middle" font-family="Inter" font-weight="700" font-size="30" fill="${C.gold}">${esc(clip(input.winnerLine, 34))}</text>
  ${places}
  <rect x="80" y="880" width="${VIDEO_W - 160}" height="84" rx="42" fill="${C.gold}"/>
  <text x="${VIDEO_W / 2}" y="934" text-anchor="middle" font-family="Inter" font-weight="700" font-size="32" fill="${C.bg}">PLAY FREE IN TELEGRAM</text>
  <text x="${VIDEO_W / 2}" y="1020" text-anchor="middle" font-family="Inter" font-size="28" fill="${C.ink}">Train, enter and race your own horses</text>
</g>`;
}

/** One frame of the video as SVG. */
export function videoFrameSvg(input: RaceVideoInput, shot: Shot): string {
  const color = (i: number) => FALLBACK[i % FALLBACK.length]!;
  const body = shot.scene === "race" ? raceFrame(input, shot, color) : resultFrame(input, shot.k, color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_W}" height="${VIDEO_H}" viewBox="0 0 ${VIDEO_W} ${VIDEO_H}">
  <defs><radialGradient id="glow" cx="80%" cy="8%" r="70%"><stop offset="0" stop-color="${C.goldDeep}" stop-opacity="0.35"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="${C.bg}"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  ${shot.scene === "race" ? header(input) : `<text x="${VIDEO_W / 2}" y="110" text-anchor="middle" font-family="Playfair Display" font-weight="700" font-size="34" letter-spacing="7" fill="${C.gold}">THOROUGHLINE</text><text x="${VIDEO_W / 2}" y="170" text-anchor="middle" font-family="Inter" font-size="26" fill="${C.muted}">${esc(clip(input.raceName, 40))}</text>`}
  ${body}
  ${footer(input)}
</svg>`;
}

/* ───────────────────────────── encoding ───────────────────────────── */

const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";

let available: Promise<boolean> | null = null;

/** Whether ffmpeg can be run here (checked once per process). */
export function ffmpegAvailable(): Promise<boolean> {
  return (available ??= new Promise((resolve) => {
    const p = spawn(ffmpegBin(), ["-hide_banner", "-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  }));
}

async function run(args: string[], input?: (stdin: NodeJS.WritableStream) => Promise<void>): Promise<Buffer> {
  const p = spawn(ffmpegBin(), ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  p.stdout.on("data", (b: Buffer) => out.push(b));
  p.stderr.on("data", (b: Buffer) => err.push(b));
  const exited = new Promise<number>((resolve, reject) => {
    p.on("error", reject);
    p.on("close", (code) => resolve(code ?? 1));
  });
  // A failing ffmpeg closes its input: report its error, not the broken pipe.
  p.stdin.on("error", () => undefined);
  try {
    if (input) await input(p.stdin);
  } finally {
    p.stdin.end();
  }
  const code = await exited;
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${Buffer.concat(err).toString().slice(0, 300)}`);
  return Buffer.concat(out);
}

const render = (svg: string) =>
  renderAsync(svg, {
    fitTo: { mode: "width", value: VIDEO_W },
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: "Inter" },
  });

/** Render the race video (MP4). `fps` is lowered in tests. */
export async function renderRaceVideo(input: RaceVideoInput, fps = 25): Promise<Buffer> {
  const shots = timeline(input, fps);
  const dir = await mkdtemp(join(tmpdir(), "race-video-"));
  const file = join(dir, "race.mp4");
  try {
    await run(
      [
        ...[
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgba",
          "-s",
          `${VIDEO_W}x${VIDEO_H}`,
          "-r",
          String(fps),
          "-i",
          "pipe:0",
        ],
        ...["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-shortest"],
        ...["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(fps)],
        ...["-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-y", file],
      ],
      async (stdin) => {
        // A few frames in flight on the thread pool, written in order.
        const AHEAD = 4;
        const pending: Promise<Buffer>[] = [];
        const start = (i: number) => {
          pending[i] = render(videoFrameSvg(input, shots[i]!)).then((img) => img.pixels);
        };
        for (let i = 0; i < Math.min(AHEAD, shots.length); i++) start(i);
        for (let i = 0; i < shots.length; i++) {
          const px = await pending[i]!;
          delete pending[i];
          if (i + AHEAD < shots.length) start(i + AHEAD);
          if (!stdin.write(px)) await once(stdin, "drain");
        }
      },
    );
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A PNG as JPEG (Instagram takes only JPEG images). */
export function pngToJpeg(png: Buffer): Promise<Buffer> {
  return run(
    ["-f", "png_pipe", "-i", "pipe:0", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
    async (stdin) => {
      if (!stdin.write(png)) await once(stdin, "drain");
    },
  );
}
