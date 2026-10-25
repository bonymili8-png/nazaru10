/**
 * Captions for the game's own channel posts. English only, real game events only, HTML for
 * Telegram (names escaped). A deterministic `variant` picks among phrasings so the channel does
 * not repeat itself, while tests stay reproducible.
 */

import type { SocialPlatform } from "@thoroughline/contracts";

export const POST_KINDS = ["RACE_OF_THE_DAY", "TOURNAMENT_CHAMPION", "FIRST_WIN", "WEEKLY_TOP"] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** Each kind of post links through its own campaign, so the funnel shows what brings players. */
export const POST_CAMPAIGNS: Record<PostKind, { code: string; name: string }> = {
  RACE_OF_THE_DAY: { code: "TGCHDAY", name: "Own channel · Race of the day" },
  TOURNAMENT_CHAMPION: { code: "TGCHCHAMP", name: "Own channel · Tournament champion" },
  FIRST_WIN: { code: "TGCHFIRST", name: "Own channel · First win" },
  WEEKLY_TOP: { code: "TGCHWEEK", name: "Own channel · Top of the week" },
};

export const POST_PRIORITY: Record<PostKind, number> = {
  TOURNAMENT_CHAMPION: 30,
  WEEKLY_TOP: 25,
  RACE_OF_THE_DAY: 20,
  FIRST_WIN: 10,
};

export interface RaceOfDayPayload {
  raceId: string;
  raceName: string;
  winner: string;
  winnerHouse: boolean;
  /** Lengths between the winner and the second. */
  margin: number | null;
  /** The winner's place in the pre-race ability order (1 = favourite on paper). */
  expectedRank: number;
  field: number;
  distance: number;
  going: string;
  trackName: string;
}

export interface ChampionPayload {
  tournamentId: string;
  name: string;
  finalRaceId: string;
  winner: string;
  winnerHouse: boolean;
  /** The champion's stable, only when its owner shows it publicly. */
  stable: string | null;
  entrants: number;
  distance: number;
  trackName: string;
}

export interface FirstWinPayload {
  raceId: string;
  raceName: string;
  horse: string;
  stable: string | null;
  field: number;
  distance: number;
}

export interface WeeklyTopPayload {
  week: string;
  rows: { horseId: string; name: string; rating: number; wins: number; starts: number }[];
}

export const esc = (s: unknown) =>
  String(s).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const lower = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** Racing's words for a winning margin. */
export function marginText(lengths: number | null): string {
  if (lengths === null) return "";
  if (lengths < 0.08) return "by a nose";
  if (lengths < 0.2) return "by a short head";
  if (lengths < 0.35) return "by a head";
  if (lengths < 0.6) return "by a neck";
  if (lengths < 0.85) return "by three-quarters of a length";
  if (lengths < 1.25) return "by a length";
  return `by ${Math.round(lengths * 2) / 2} lengths`;
}

const pick = <T>(list: readonly T[], variant: number) => list[Math.abs(variant) % list.length]!;

const FOOTER = "Free horse racing sim in Telegram · no betting.";

export function caption(kind: PostKind, payload: unknown, variant: number): string {
  switch (kind) {
    case "RACE_OF_THE_DAY": {
      const p = payload as RaceOfDayPayload;
      const upset = p.expectedRank >= 3 && p.field >= 4;
      const close = p.margin !== null && p.margin < 0.35;
      const head = upset
        ? "😮 Upset of the day"
        : close
          ? "📸 Photo finish of the day"
          : "🏁 Race of the day";
      const rated = upset ? `, rated only ${ordinal(p.expectedRank)} of ${p.field} before the off` : "";
      const cta = pick(
        [
          "Watch the replay, then train your own racehorse.",
          "Think you could train one to beat that? Your stable is waiting.",
          "Every start is decided by training, condition and the ride you choose.",
        ],
        variant,
      );
      return [
        `<b>${head}</b>`,
        `<b>${esc(p.winner)}</b>${p.winnerHouse ? " (house yard)" : ""} wins the ${esc(p.raceName)} ${marginText(p.margin)}${rated}.`,
        `${p.distance}m on ${lower(p.going)} ground at ${esc(p.trackName)}, ${p.field} runners.`,
        "",
        cta,
        FOOTER,
      ].join("\n");
    }
    case "TOURNAMENT_CHAMPION": {
      const p = payload as ChampionPayload;
      const who = p.winnerHouse
        ? `<b>${esc(p.winner)}</b> (house yard) beat every entrant`
        : `<b>${esc(p.winner)}</b>${p.stable ? ` of ${esc(p.stable)}` : ""} is champion`;
      return [
        `<b>🏆 ${esc(p.name)}</b>`,
        `${who}: ${p.entrants} entrant${p.entrants === 1 ? "" : "s"}, final over ${p.distance}m at ${esc(p.trackName)}.`,
        "",
        pick(["Cups run every day. Enter yours.", "Next cup opens soon: who takes the title?"], variant),
        FOOTER,
      ].join("\n");
    }
    case "FIRST_WIN": {
      const p = payload as FirstWinPayload;
      return [
        "<b>⭐ First win</b>",
        `<b>${esc(p.horse)}</b>${p.stable ? ` of ${esc(p.stable)}` : ""} breaks its maiden in the ${esc(p.raceName)} (${p.field} runners, ${p.distance}m).`,
        "",
        pick(["Every champion starts somewhere.", "First of many? Train yours and find out."], variant),
        FOOTER,
      ].join("\n");
    }
    case "WEEKLY_TOP": {
      const p = payload as WeeklyTopPayload;
      return [
        "<b>📈 Top of the week</b>",
        ...p.rows.map(
          (r, i) =>
            `${i + 1}. <b>${esc(r.name)}</b> · rating ${r.rating} · ${r.wins} win${r.wins === 1 ? "" : "s"}`,
        ),
        "",
        pick(
          ["Who's next? Train your own and climb the ratings.", "Ratings move with every race. Join in."],
          variant,
        ),
        FOOTER,
      ].join("\n");
    }
  }
}

/* ───────────────────────────── other networks ───────────────────────────── */

/** One campaign per network (the campaigns tab shows what each brings). */
export const SOCIAL_CAMPAIGNS: Record<SocialPlatform, { code: string; name: string; platform: string }> = {
  YOUTUBE: { code: "YTSHORTS", name: "Own account · YouTube Shorts", platform: "YOUTUBE" },
  INSTAGRAM: { code: "IGREELS", name: "Own account · Instagram", platform: "INSTAGRAM" },
  FACEBOOK: { code: "FBPAGE", name: "Own account · Facebook Page", platform: "FACEBOOK" },
  THREADS: { code: "THREADSPOST", name: "Own account · Threads", platform: "THREADS" },
  BLUESKY: { code: "BSKYPOST", name: "Own account · Bluesky", platform: "BLUESKY" },
};

/** Kinds that come with a race (and so a video). */
export const RACE_KINDS: readonly PostKind[] = ["RACE_OF_THE_DAY", "TOURNAMENT_CHAMPION", "FIRST_WIN"];

export function raceIdOf(kind: PostKind, payload: unknown): string | null {
  switch (kind) {
    case "RACE_OF_THE_DAY":
      return (payload as RaceOfDayPayload).raceId;
    case "FIRST_WIN":
      return (payload as FirstWinPayload).raceId;
    case "TOURNAMENT_CHAMPION":
      return (payload as ChampionPayload).finalRaceId;
    case "WEEKLY_TOP":
      return null;
  }
}

/** The Telegram caption as plain text, without the footer. */
function plainLines(kind: PostKind, payload: unknown, variant: number): string[] {
  return caption(kind, payload, variant)
    .replace(/<\/?b>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .split("\n")
    .filter((l) => l !== FOOTER);
}

const clipText = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** What the video says above the race, and under the winner's name at the end. */
export function videoLines(kind: PostKind, payload: unknown): { headline: string; winnerLine: string } {
  switch (kind) {
    case "RACE_OF_THE_DAY": {
      const p = payload as RaceOfDayPayload;
      const upset = p.expectedRank >= 3 && p.field >= 4;
      const close = p.margin !== null && p.margin < 0.35;
      return {
        headline: upset ? "UPSET OF THE DAY" : close ? "PHOTO FINISH OF THE DAY" : "RACE OF THE DAY",
        winnerLine: `WINS ${marginText(p.margin)}`.trim().toUpperCase(),
      };
    }
    case "TOURNAMENT_CHAMPION":
      return { headline: "CUP FINAL", winnerLine: "IS CHAMPION" };
    case "FIRST_WIN":
      return { headline: "FIRST WIN", winnerLine: "BREAKS ITS MAIDEN" };
    case "WEEKLY_TOP":
      return { headline: "TOP OF THE WEEK", winnerLine: "" };
  }
}

/** YouTube's title (≤ 100 characters). */
export function socialTitle(kind: PostKind, payload: unknown): string {
  let t: string;
  switch (kind) {
    case "RACE_OF_THE_DAY": {
      const p = payload as RaceOfDayPayload;
      const { headline } = videoLines(kind, payload);
      t = `${p.winner} wins ${marginText(p.margin)} | ${headline.charAt(0)}${headline.slice(1).toLowerCase()}`;
      break;
    }
    case "TOURNAMENT_CHAMPION": {
      const p = payload as ChampionPayload;
      t = `${p.winner} wins the ${p.name} 🏆`;
      break;
    }
    case "FIRST_WIN":
      t = `${(payload as FirstWinPayload).horse} wins for the first time ⭐`;
      break;
    case "WEEKLY_TOP":
      t = "Top of the week: the highest-rated racehorses";
      break;
  }
  t = clipText(t.replace(/\s+/g, " "), 88);
  return `${t} #Shorts`;
}

export const SOCIAL_TAGS = [
  "horse racing",
  "horseracing",
  "racing game",
  "thoroughbred",
  "telegram game",
  "simulation",
];

/**
 * A post's text for a network (plain text, English): the same real event as the channel post,
 * the no-betting line, where to play (a tracked link where links work; Instagram points at the
 * bio link and the bot's name) and a few hashtags within each network's limits.
 */
export function socialCaption(
  kind: PostKind,
  payload: unknown,
  variant: number,
  platform: SocialPlatform,
  play: { link: string; bot: string },
): string {
  const lines = plainLines(kind, payload, variant);
  const body = lines.join("\n").trim();
  switch (platform) {
    case "YOUTUBE":
      return `${body}\n\n▶ Play free in Telegram: ${play.link}\n${FOOTER}\n\n#horseracing #racinggame #Shorts`;
    case "INSTAGRAM":
      return `${body}\n\n▶ Play free in Telegram: link in bio, or search @${play.bot} in Telegram.\n${FOOTER}\n\n#horseracing #thoroughbred #racehorse #horseracinglife #racinggame #mobilegame #telegram`;
    case "FACEBOOK":
      return `${body}\n\n▶ Play free in Telegram: ${play.link}\n${FOOTER}\n\n#horseracing #racinggame`;
    case "THREADS": {
      const tail = `\n\n▶ Play free in Telegram: ${play.link}\n${FOOTER} #horseracing`;
      return `${clipText(body, 500 - tail.length)}${tail}`;
    }
    case "BLUESKY": {
      // 300 characters in all, the link line ("▶ Play free in Telegram") added after this.
      const tail = `\n${FOOTER}\n#horseracing #gaming`;
      return `${clipText(lines.slice(0, 2).join("\n"), 300 - 26 - tail.length)}${tail}`;
    }
  }
}
