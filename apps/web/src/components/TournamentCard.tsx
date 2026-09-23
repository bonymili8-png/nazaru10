"use client";
import type { TournamentDto, TournamentStatus, TournamentTier } from "@thoroughline/contracts";
import { Crown, Trophy } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { countdown, fmt } from "@/lib/format";

export const TIER_NAMES: Record<TournamentTier, string> = {
  LOCAL: "Local",
  REGIONAL: "Regional",
  NATIONAL: "National",
  ELITE: "Elite",
};

export const STATUS_LABEL: Record<TournamentStatus, string> = {
  REGISTRATION: "Registration open",
  HEATS: "Heats",
  FINAL: "Final",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const qualificationText = (q: TournamentDto["qualification"]) => {
  if (q.minSeasonPoints === null && q.minRating === null) return "Open to all";
  return [
    q.minSeasonPoints !== null ? `${q.minSeasonPoints} season pts` : null,
    q.minRating !== null ? `rating ${q.minRating}+` : null,
  ]
    .filter(Boolean)
    .join(" or ");
};

export function TournamentCard({ t, now }: { t: TournamentDto; now: number }) {
  const live = t.status === "HEATS" || t.status === "FINAL";
  const when =
    t.status === "REGISTRATION"
      ? `closes in ${countdown(t.registrationClosesAt, now)}`
      : t.status === "HEATS"
        ? `final in ${countdown(t.finalAt, now)}`
        : t.status === "FINAL"
          ? "final under way"
          : new Date(t.heatsAt).toLocaleDateString([], { month: "short", day: "numeric" });
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
        {t.myEntries.length > 0 && <Badge tone="gold">Entered ×{t.myEntries.length}</Badge>}
      </div>
      <p className="mt-2 font-display text-lg font-bold leading-tight">{t.name}</p>
      <p className="text-xs text-muted">
        {t.distance}m · {qualificationText(t.qualification)}
      </p>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">Purse</p>
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
          <p className="num text-xs text-muted">entry {fmt(t.entryFee)} cr</p>
        </div>
      </div>
    </Link>
  );
}
