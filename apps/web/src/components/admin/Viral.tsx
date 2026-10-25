"use client";
import type { ViralStatsDto } from "@thoroughline/contracts";
import { useState } from "react";
import { Card, SectionTitle, Skeleton } from "@/components/ui";
import { fmt } from "@/lib/format";
import { useApi } from "@/lib/hooks";

/**
 * The viral loop (players tab): visits to shared replays and horse cards, friends who joined
 * through an invite and ran a race, and the K-factor (invited players who raced, per active one).
 */
export function Viral() {
  const [days, setDays] = useState(7);
  const { data } = useApi<ViralStatsDto>(`/admin/viral?days=${days}`, { refreshMs: 60_000 });
  return (
    <>
      <SectionTitle
        action={
          <div className="flex gap-1">
            {[7, 30].map((d) => (
              <button
                key={d}
                aria-pressed={days === d}
                onClick={() => setDays(d)}
                className={`min-h-8 cursor-pointer rounded-full border px-3 text-xs ${days === d ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
              >
                {d} days
              </button>
            ))}
          </div>
        }
      >
        Viral loop
      </SectionTitle>
      {!data ? (
        <Skeleton className="h-28" />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              [
                "Share-page visits",
                fmt(data.shareVisits),
                `${fmt(data.sharedByPlayers)} from ${data.sharers} sharers`,
              ],
              ["Invited players", fmt(data.referredSignups), `${fmt(data.referredFirstRace)} ran a race`],
              ["K-factor", data.kFactor.toFixed(2), "invited players who raced, per active player"],
              ["Active players", fmt(data.activePlayers), `signed in, last ${data.days} days`],
            ] as const
          ).map(([label, value, sub]) => (
            <Card key={label}>
              <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
              <p className="num mt-1 font-display text-2xl font-bold text-gold">{value}</p>
              <p className="text-xs text-muted">{sub}</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
