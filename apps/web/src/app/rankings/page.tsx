"use client";
import type { LeaderboardHorseDto, LeaderboardOwnerDto } from "@thoroughline/contracts";
import { useState } from "react";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { fmt } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type Board = "horses" | "owners";
type By = "rating" | "earnings" | "wins";

export default function RankingsPage() {
  const [board, setBoard] = useState<Board>("horses");
  const [by, setBy] = useState<By>("rating");
  const horses = useApi<LeaderboardHorseDto[]>(board === "horses" ? `/leaderboard/horses?by=${by}` : null);
  const owners = useApi<LeaderboardOwnerDto[]>(board === "owners" ? `/leaderboard/owners?by=${by}` : null);
  const active = board === "horses" ? horses : owners;
  const labels: Record<By, string> = {
    rating: board === "horses" ? "Rating" : "Reputation",
    earnings: "Earnings",
    wins: "Wins",
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Rankings</h1>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1" role="tablist">
        {(["horses", "owners"] as Board[]).map((b) => (
          <button
            key={b}
            role="tab"
            aria-selected={board === b}
            onClick={() => setBoard(b)}
            className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium capitalize ${board === b ? "bg-gold text-bg" : "text-muted"}`}
          >
            {b}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {(["rating", "earnings", "wins"] as By[]).map((b) => (
          <button
            key={b}
            aria-pressed={by === b}
            onClick={() => setBy(b)}
            className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-sm ${by === b ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {labels[b]}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {active.error && <ErrorState error={active.error} retry={active.reload} />}
        {!active.data && !active.error && <Skeleton className="h-64" />}
        {active.data?.length === 0 && (
          <EmptyState title="No ranked entries yet" body="Run a race to get on the board." />
        )}
        {!!active.data?.length && (
          <Card className="divide-y divide-line/40 p-0">
            {board === "horses"
              ? horses.data?.map((r) => (
                  <Row
                    key={r.horseId}
                    rank={r.rank}
                    title={r.name}
                    sub={`${r.ownerName ?? ""} · ${r.wins}/${r.starts} wins`}
                    value={by === "earnings" ? fmt(r.value) : String(r.value)}
                    href={`/horse/?id=${r.horseId}`}
                  />
                ))
              : owners.data?.map((r) => (
                  <Row
                    key={r.userId}
                    rank={r.rank}
                    title={r.name}
                    sub={r.stableName}
                    value={
                      by === "earnings" ? fmt(r.earnings) : by === "wins" ? String(r.wins) : fmt(r.reputation)
                    }
                  />
                ))}
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({
  rank,
  title,
  sub,
  value,
  href,
}: {
  rank: number;
  title: string;
  sub: string;
  value: string;
  href?: string;
}) {
  const body = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`num w-8 font-display text-lg font-bold ${rank <= 3 ? "text-gold" : "text-muted"}`}>
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-muted">{sub}</p>
      </div>
      <span className="num font-semibold">{value}</span>
    </div>
  );
  return href ? (
    <a href={href} className="block hover:bg-surface-2">
      {body}
    </a>
  ) : (
    body
  );
}
