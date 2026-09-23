"use client";
import type { TournamentDto } from "@thoroughline/contracts";
import { TournamentCard } from "@/components/TournamentCard";
import { Card, EmptyState, ErrorState, SectionTitle, Skeleton } from "@/components/ui";
import { useApi, useNow } from "@/lib/hooks";

export default function TournamentsPage() {
  const { data, error, reload } = useApi<TournamentDto[]>("/tournaments", { refreshMs: 15_000 });
  const now = useNow(30_000);
  const active = data?.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED") ?? [];
  const past = data?.filter((t) => t.status === "COMPLETED") ?? [];
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Tournaments</h1>
      <Card className="mt-3 text-sm text-muted">
        Register up to two horses per cup. At close the field is seeded into heats by rating; the top two
        owners&apos; horses in each heat reach the final, which carries the purse and the title.
      </Card>
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
          <SectionTitle>Open & running</SectionTitle>
          <div className="space-y-2">
            {active.length === 0 && (
              <EmptyState title="No cups open right now" body="A new Local Cup opens every day." />
            )}
            {active.map((t) => (
              <TournamentCard key={t.id} t={t} now={now} />
            ))}
          </div>
          {past.length > 0 && (
            <>
              <SectionTitle>Recent champions</SectionTitle>
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
