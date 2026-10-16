"use client";
import type {
  TournamentDetailDto,
  TournamentRoundDto,
  TournamentRunnerDto,
  TournamentStandingDto,
} from "@thoroughline/contracts";
import { Check, Crown, PlayCircle } from "lucide-react";
import Link from "next/link";
import { WEATHER_ICON } from "@/components/RaceCard";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { fmt, ordinal, STRATEGY_INFO, titleCase } from "@/lib/format";
import { getLocale, t } from "@/lib/i18n";

const horseHref = (id: string) => `/horse/?id=${id}`;
const ownerHref = (id: string) => `/owner/?id=${id}`;

const linkCls = "underline-offset-2 hover:text-gold hover:underline";

/** How far a horse got: "Champion", "2nd in the final", "3rd in Heat 1", "Scratched". */
function stageText(s: TournamentStandingDto, finalists: number, house: boolean): string {
  if (s.champion) return t("tres.champion");
  // A house-filled final counts its whole field; otherwise placings are among the finalists.
  if (s.finalPosition !== null)
    return t("tres.inFinal", {
      p: ordinal(house ? s.finalPosition : (s.rank ?? s.finalPosition)),
      n: finalists,
    });
  if (s.status === "FINALIST") return t("tres.finalist");
  if (s.status === "ELIMINATED")
    return s.heatPosition
      ? t("tres.inHeat", { p: ordinal(s.heatPosition), n: s.heatNo ?? 1 })
      : t("tres.outHeat", { n: s.heatNo ?? 1 });
  if (s.status === "IN_HEAT") return t("tres.inHeatN", { n: s.heatNo ?? 1 });
  return t(`tentry.${s.status}`);
}

/** The tournament table: rank, horse, owner, how far it got, prize. */
export function Standings({ t: tour }: { t: TournamentDetailDto }) {
  const finalists = tour.houseFill
    ? (tour.rounds.find((r) => r.stage === "FINAL")?.runners.length ?? 0)
    : tour.standings.filter((s) => s.finalPosition !== null).length;
  return (
    <>
      <SectionTitle>{t("tres.table")}</SectionTitle>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm" aria-label={t("tres.table")}>
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="py-2 pl-3 pr-1 font-medium">#</th>
              <th className="px-2 py-2 font-medium">{t("tres.horse")}</th>
              <th className="px-2 py-2 font-medium">{t("tres.result")}</th>
              <th className="py-2 pl-2 pr-3 text-right font-medium">{t("tres.prize")}</th>
            </tr>
          </thead>
          <tbody>
            {tour.standings.map((s) => (
              <tr key={s.horseId} className={`border-t border-line/40 ${s.mine ? "bg-gold/10" : ""}`}>
                <td className="num py-2 pl-3 pr-1 align-top font-display font-bold">
                  {s.champion ? (
                    <Crown className="size-4 text-gold" aria-label={t("tres.champion")} />
                  ) : s.rank === null ? (
                    "—"
                  ) : (
                    `${s.tied ? "=" : ""}${s.rank}`
                  )}
                </td>
                <td className="max-w-[10rem] px-2 py-2 align-top">
                  <Link href={horseHref(s.horseId)} className={`block truncate font-medium ${linkCls}`}>
                    {s.horseName}
                  </Link>
                  <Link
                    href={ownerHref(s.ownerId)}
                    className={`block truncate text-xs text-muted ${linkCls}`}
                  >
                    {s.ownerName ?? t("common.owner")}
                  </Link>
                </td>
                <td className="px-2 py-2 align-top text-xs">{stageText(s, finalists, tour.houseFill)}</td>
                <td className="num py-2 pl-2 pr-3 text-right align-top text-xs">
                  {s.prize > 0 ? <span className="text-good">+{fmt(s.prize)}</span> : "—"}
                  {s.champion && tour.championHonours.reputation > 0 && (
                    <span className="block text-muted">
                      {t("tres.rep", { n: tour.championHonours.reputation })}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/** "Heat 1 · 18:00" or "Final · 18:30". */
const roundTitle = (r: TournamentRoundDto) =>
  `${r.stage === "FINAL" ? t("tour.final") : t("tour.heatN", { n: r.no })} · ${new Date(
    r.startsAt,
  ).toLocaleString(getLocale() === "uk" ? "uk-UA" : [], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;

function RunnerRow({ x, stage }: { x: TournamentRunnerDto; stage: TournamentRoundDto["stage"] }) {
  return (
    <li className={`flex items-center gap-3 px-3 py-2 ${x.mine ? "bg-gold/10" : ""}`}>
      <span className="num w-8 shrink-0 font-display font-bold">
        {x.position ? ordinal(x.position) : "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {x.house ? (
            x.horseName
          ) : (
            <Link href={horseHref(x.horseId)} className={linkCls}>
              {x.horseName}
            </Link>
          )}
          {stage === "HEAT" && x.qualified && (
            <span className="ml-1.5 inline-flex align-[-2px] text-good" title={t("tres.qualified")}>
              <Check className="size-4" aria-label={t("tres.qualified")} />
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {x.house || !x.ownerId ? (
            t("common.house")
          ) : (
            <Link href={ownerHref(x.ownerId)} className={linkCls}>
              {x.ownerName ?? t("common.owner")}
            </Link>
          )}
          {x.gate !== null && ` · ${t("tres.gate", { n: x.gate })}`}
          {STRATEGY_INFO[x.strategy] && ` · ${STRATEGY_INFO[x.strategy]!.label}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="num text-sm">
          {x.position === 1 && x.finishTime !== null
            ? t("live.sec", { n: x.finishTime.toFixed(2) })
            : x.lengthsBehind !== null
              ? t("live.lengths", { n: x.lengthsBehind.toFixed(1) })
              : ""}
        </p>
        {!!x.prize && !x.house && <p className="num text-xs text-good">+{fmt(x.prize)}</p>}
      </div>
    </li>
  );
}

/** Each heat and the final: conditions, link to the race (live or replay) and the whole field. */
export function Rounds({ t: tour }: { t: TournamentDetailDto }) {
  if (!tour.rounds.length) return null;
  return (
    <>
      <SectionTitle>{t("tour.races")}</SectionTitle>
      <div className="space-y-3">
        {tour.rounds.map((r) => {
          const W = WEATHER_ICON[r.weather as keyof typeof WEATHER_ICON];
          const done = r.status === "COMPLETED";
          return (
            <Card key={r.raceId} className="p-0" as="section">
              <div className="flex items-start justify-between gap-2 border-b border-line/40 px-3 py-2.5">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold">{roundTitle(r)}</h3>
                  <p className="text-xs text-muted">
                    {r.trackName} · {t("unit.m", { n: r.distance })} {titleCase(r.surface)} ·{" "}
                    {W && <W className="inline size-3.5 align-[-2px]" aria-hidden />} {titleCase(r.weather)},{" "}
                    {titleCase(r.going)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={done ? "neutral" : r.status === "CANCELLED" ? "bad" : "good"}>
                    {t(`rstatus.${r.status}`)}
                  </Badge>
                  <Link
                    href={`/race/?id=${r.raceId}`}
                    className="inline-flex min-h-8 items-center gap-1 text-xs text-gold underline underline-offset-2"
                  >
                    <PlayCircle className="size-3.5" aria-hidden />
                    {done ? t("live.replay") : t("tres.openRace")}
                  </Link>
                </div>
              </div>
              {r.runners.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted">{t("tour.noEntries")}</p>
              ) : (
                <ol className="divide-y divide-line/30" aria-label={roundTitle(r)}>
                  {r.runners.map((x) => (
                    <RunnerRow key={x.horseId} x={x} stage={r.stage} />
                  ))}
                </ol>
              )}
              {r.stage === "HEAT" && done && (
                <p className="border-t border-line/40 px-3 py-1.5 text-[11px] text-muted">
                  <Check className="inline size-3 align-[-1px] text-good" aria-hidden />{" "}
                  {t("tres.qualifiedNote")}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
