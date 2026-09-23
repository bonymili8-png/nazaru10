"use client";
import { RACE_CLASSES, type RaceSummaryDto } from "@thoroughline/contracts";
import { useState } from "react";
import { RaceCard } from "@/components/RaceCard";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { CLASS_NAMES } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type Status = "upcoming" | "live" | "recent";

export default function RacesPage() {
  const [status, setStatus] = useState<Status>("upcoming");
  const [cls, setCls] = useState<string | null>(null);
  const path = `/races?status=${status}&limit=30${cls ? `&class=${cls}` : ""}`;
  const { data, error, reload } = useApi<RaceSummaryDto[]>(path, { refreshMs: 10_000 });

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Race card</h1>
      <div
        className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-surface p-1"
        role="tablist"
        aria-label="Race status"
      >
        {(["upcoming", "live", "recent"] as Status[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium capitalize transition-colors ${status === s ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Class filter">
        {[null, ...RACE_CLASSES].map((c) => (
          <button
            key={c ?? "all"}
            onClick={() => setCls(c)}
            aria-pressed={cls === c}
            className={`min-h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-sm transition-colors ${cls === c ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {c ? CLASS_NAMES[c] : "All classes"}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {error && <ErrorState error={error} retry={reload} />}
        {!data && !error && [0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
        {data?.length === 0 && (
          <EmptyState
            title="Nothing here yet"
            body={status === "upcoming" ? "New races open every few minutes." : "Check back soon."}
          />
        )}
        {data?.map((r) => (
          <RaceCard key={r.id} race={r} />
        ))}
      </div>
    </div>
  );
}
