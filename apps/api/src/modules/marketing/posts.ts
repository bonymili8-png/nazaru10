/**
 * Captions for the game's own channel posts. English only, real game events only, HTML for
 * Telegram (names escaped). A deterministic `variant` picks among phrasings so the channel does
 * not repeat itself, while tests stay reproducible.
 */

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
