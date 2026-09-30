"use client";
import type { TournamentDto } from "@thoroughline/contracts";
import { MonitorPlay } from "lucide-react";
import Link from "next/link";
import { TournamentCard } from "@/components/TournamentCard";
import { Card, EmptyState, ErrorState, SectionTitle, Skeleton } from "@/components/ui";
import { useApi, useNow } from "@/lib/hooks";
import { t as tr } from "@/lib/i18n";

export default function TournamentsPage() {
  const { data, error, reload } = useApi<TournamentDto[]>("/tournaments", { refreshMs: 15_000 });
  const now = useNow(30_000);
  const active = data?.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED") ?? [];
  const past = data?.filter((t) => t.status === "COMPLETED") ?? [];
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{tr("tour.title")}</h1>
      <Card className="mt-3 text-sm text-muted">{tr("tour.intro")}</Card>
      <Link href="/show/" className="mt-2 block">
        <Card className="flex items-center gap-3 transition-colors hover:border-gold">
          <MonitorPlay className="size-6 shrink-0 text-gold" aria-hidden />
          <span className="min-w-0">
            <span className="block font-semibold">{tr("showdown.title")}</span>
            <span className="block text-xs text-muted">{tr("showdown.teaser")}</span>
          </span>
        </Card>
      </Link>
      {error && <ErrorState error={error} retry={reload} />}
      {!data && !error && (
        <div className="mt-3 space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}
      {data && (
        <>
          <SectionTitle>{tr("tour.openRunning")}</SectionTitle>
          <div className="space-y-2">
            {active.length === 0 && <EmptyState title={tr("tour.noneOpen")} body={tr("tour.noneOpenBody")} />}
            {active.map((t) => (
              <TournamentCard key={t.id} t={t} now={now} />
            ))}
          </div>
          {past.length > 0 && (
            <>
              <SectionTitle>{tr("tour.champions")}</SectionTitle>
              <div className="space-y-2">
                {past.map((t) => (
                  <TournamentCard key={t.id} t={t} now={now} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
