"use client";
import type { TournamentDto, TournamentStatus, TournamentTier } from "@thoroughline/contracts";
import { Crown, Trophy } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { countdown, fmt } from "@/lib/format";
import { getLocale, type MessageKey, t as tr } from "@/lib/i18n";

const labels = <K extends string>(prefix: string) =>
  new Proxy({} as Record<K, string>, { get: (_, k) => tr(`${prefix}.${String(k)}` as MessageKey) });

export const TIER_NAMES = labels<TournamentTier>("tier");

export const STATUS_LABEL = labels<TournamentStatus>("tstatus");

export const qualificationText = (q: TournamentDto["qualification"]) => {
  if (q.minSeasonPoints === null && q.minRating === null) return tr("tour.openToAll");
  return [
    q.minSeasonPoints !== null ? tr("tour.seasonPts", { n: q.minSeasonPoints }) : null,
    q.minRating !== null ? tr("tour.ratingPlus", { n: q.minRating }) : null,
  ]
    .filter(Boolean)
    .join(tr("tour.or"));
};

export function TournamentCard({ t, now }: { t: TournamentDto; now: number }) {
  const live = t.status === "HEATS" || t.status === "FINAL";
  const when =
    t.status === "REGISTRATION"
      ? tr("tour.closesIn", { t: countdown(t.registrationClosesAt, now) })
      : t.status === "HEATS"
        ? tr("tour.finalIn", { t: countdown(t.finalAt, now) })
        : t.status === "FINAL"
          ? tr("tour.finalUnderWay")
          : new Date(t.heatsAt).toLocaleDateString(getLocale() === "uk" ? "uk-UA" : [], {
              month: "short",
              day: "numeric",
            });
  return (
    <Link
      href={`/tournament/?id=${t.id}`}
      className="block rounded-2xl border border-line/50 bg-surface p-4 transition-colors hover:border-gold/50"
    >
      <div className="flex items-center gap-2">
        <Badge tone="gold">
          <Trophy className="size-3" aria-hidden />
          {TIER_NAMES[t.tier]}
        </Badge>
        <Badge tone={live ? "bad" : t.status === "REGISTRATION" ? "good" : "neutral"}>
          {live ? "● " : ""}
          {STATUS_LABEL[t.status]}
        </Badge>
        {t.myEntries.length > 0 && <Badge tone="gold">{tr("tour.entered", { n: t.myEntries.length })}</Badge>}
      </div>
      <p className="mt-2 font-display text-lg font-bold leading-tight">{t.name}</p>
      <p className="text-xs text-muted">
        {tr("unit.m", { n: t.distance })} · {qualificationText(t.qualification)}
      </p>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">{tr("common.purse")}</p>
          <p className="num font-display text-xl font-bold text-gold">{fmt(t.purse)}</p>
        </div>
        <div className="text-right text-sm">
          {t.winner ? (
            <p className="flex items-center gap-1 font-medium">
              <Crown className="size-4 text-gold" aria-hidden /> {t.winner.horseName}
            </p>
          ) : (
            <p className="num text-muted">
              {t.entrants}/{t.maxEntrants} · {when}
            </p>
          )}
          <p className="num text-xs text-muted">{tr("tour.entryFee", { fee: fmt(t.entryFee) })}</p>
        </div>
      </div>
    </Link>
  );
}
