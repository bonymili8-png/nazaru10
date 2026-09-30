"use client";
import { RACE_CLASSES, type RaceSummaryDto } from "@thoroughline/contracts";
import { MonitorPlay, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { RaceCard } from "@/components/RaceCard";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { ClassGuide } from "@/components/ClassGuide";
import { CLASS_NAMES } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { t } from "@/lib/i18n";

type Status = "upcoming" | "live" | "recent";

export default function RacesPage() {
  const [status, setStatus] = useState<Status>("upcoming");
  const [cls, setCls] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const path = `/races?status=${status}&limit=30${cls ? `&class=${cls}` : ""}${mine ? "&mine=true" : ""}`;
  const { data, error, reload } = useApi<RaceSummaryDto[]>(path, { refreshMs: 10_000 });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">{t("races.title")}</h1>
        <div className="flex gap-2">
          <Link
            href="/show/"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line/60 bg-surface px-3.5 text-sm font-medium"
          >
            <MonitorPlay className="size-4" aria-hidden />
            {t("races.showdowns")}
          </Link>
          <Link
            href="/tournaments/"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 px-3.5 text-sm font-medium text-gold"
          >
            <Trophy className="size-4" aria-hidden />
            {t("races.tournaments")}
          </Link>
        </div>
      </div>
      <div
        className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-surface p-1"
        role="tablist"
        aria-label={t("races.status")}
      >
        {(["upcoming", "live", "recent"] as Status[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium transition-colors ${status === s ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
          >
            {t(`races.tab.${s}`)}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("races.scope")}>
        {[false, true].map((m) => (
          <button
            key={String(m)}
            role="radio"
            aria-checked={mine === m}
            onClick={() => setMine(m)}
            className={`min-h-10 cursor-pointer rounded-full border text-sm transition-colors ${mine === m ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {m ? t("races.scope.mine") : t("races.scope.all")}
          </button>
        ))}
      </div>
      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1" aria-label={t("races.classFilter")}>
        {[null, ...RACE_CLASSES].map((c) => (
          <button
            key={c ?? "all"}
            onClick={() => setCls(c)}
            aria-pressed={cls === c}
            className={`min-h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-sm transition-colors ${cls === c ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {c ? CLASS_NAMES[c] : t("races.allClasses")}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <ClassGuide />
      </div>
      <div className="mt-3 space-y-2">
        {error && <ErrorState error={error} retry={reload} />}
        {!data && !error && [0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
        {data?.length === 0 && (
          <EmptyState
            title={t("races.emptyTitle")}
            body={
              mine
                ? t("races.emptyMine")
                : status === "upcoming"
                  ? t("races.emptyUpcoming")
                  : t("races.emptyOther")
            }
          />
        )}
        {data?.map((r) => (
          <RaceCard key={r.id} race={r} />
        ))}
      </div>
    </div>
  );
}
