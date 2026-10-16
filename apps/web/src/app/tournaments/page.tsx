"use client";
import type { TournamentDto } from "@thoroughline/contracts";
import { MonitorPlay } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TournamentCard } from "@/components/TournamentCard";
import { Button, Card, EmptyState, ErrorState, SectionTitle, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { t as tr } from "@/lib/i18n";

export default function TournamentsPage() {
  const { data, error, reload } = useApi<TournamentDto[]>("/tournaments", { refreshMs: 15_000 });
  const now = useNow(30_000);
  const active = data?.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED") ?? [];
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
          <History mine title={tr("tres.mine")} empty={tr("tres.mineEmpty")} />
          <History title={tr("tres.past")} empty={tr("tres.pastEmpty")} />
        </>
      )}
    </div>
  );
}

type Page = { items: TournamentDto[]; nextBefore: string | null };

/** Finished tournaments, newest first, with "show more" paging (mine = the ones I entered). */
function History({ mine = false, title, empty }: { mine?: boolean; title: string; empty: string }) {
  const first = useApi<Page>(`/tournaments/history?limit=${mine ? 5 : 10}${mine ? "&mine=true" : ""}`);
  const [more, setMore] = useState<TournamentDto[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);
  if (!first.data) return null;
  const items = [...first.data.items, ...more];
  const cursor = next === undefined ? first.data.nextBefore : next;
  const load = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const p = await api<Page>(
        `/tournaments/history?limit=20${mine ? "&mine=true" : ""}&before=${encodeURIComponent(cursor)}`,
      );
      setMore((m) => [...m, ...p.items]);
      setNext(p.nextBefore);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <TournamentCard key={t.id} t={t} now={now} />
          ))}
        </div>
      )}
      {cursor && (
        <Button variant="secondary" className="mt-2 w-full" loading={busy} onClick={() => void load()}>
          {tr("tres.more")}
        </Button>
      )}
    </section>
  );
}
