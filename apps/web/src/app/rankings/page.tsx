"use client";
import type {
  HallOfFameDto,
  LeaderboardHorseDto,
  LeaderboardOwnerDto,
  SeasonDto,
  SeasonHorseRowDto,
  SeasonOwnerRowDto,
} from "@thoroughline/contracts";
import { Crown, Trophy } from "lucide-react";
import { useState } from "react";
import { Card, EmptyState, ErrorState, SectionTitle, Skeleton } from "@/components/ui";
import { countdown, fmt, ordinal } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";

type Board = "horses" | "owners";
type By = "rating" | "earnings" | "wins";

type Top = "season" | "alltime" | "fame";

export default function RankingsPage() {
  const [top, setTop] = useState<Top>("season");
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Rankings</h1>
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-surface p-1" role="tablist">
        {(
          [
            ["season", "Season"],
            ["alltime", "All-time"],
            ["fame", "Hall of Fame"],
          ] as [Top, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={top === k}
            onClick={() => setTop(k)}
            className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium ${top === k ? "bg-gold text-bg" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {top === "season" && <SeasonBoard />}
      {top === "alltime" && <AllTime />}
      {top === "fame" && <HallOfFame />}
    </div>
  );
}

function SeasonBoard() {
  const season = useApi<SeasonDto>("/seasons/current", { refreshMs: 30_000 });
  const [kind, setKind] = useState<"owners" | "horses">("owners");
  const s = season.data;
  const owners = useApi<SeasonOwnerRowDto[]>(
    s && kind === "owners" ? `/seasons/${s.season}/leaderboard?kind=owners` : null,
  );
  const horses = useApi<SeasonHorseRowDto[]>(
    s && kind === "horses" ? `/seasons/${s.season}/leaderboard?kind=horses` : null,
  );
  const now = useNow(60_000);
  if (season.error) return <ErrorState error={season.error} retry={season.reload} />;
  if (!s) return <Skeleton className="mt-3 h-40" />;
  const list = kind === "owners" ? owners : horses;
  return (
    <>
      <Card className="mt-3 bg-gradient-to-br from-surface to-surface-2">
        <div className="flex items-center justify-between">
          <p className="font-display text-2xl font-bold">Season {s.season}</p>
          <p className="num text-sm text-muted">ends in {countdown(s.endsAt, now)}</p>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ["Your rank", s.me.rank ? ordinal(s.me.rank) : "—"],
            ["Points", fmt(s.me.points)],
            ["Wins", `${s.me.wins}/${s.me.races}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg/40 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
              <dd className="num font-display text-xl font-bold text-gold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">
          Points for top-6 finishes, weighted by class (Maiden ×1 … Class 1 ×6). Top owners share the season
          prizes.
        </p>
      </Card>
      <div className="mt-3 flex gap-2">
        {(["owners", "horses"] as const).map((k) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-sm capitalize ${kind === k ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {!list.data && <Skeleton className="h-40" />}
        {list.data?.length === 0 && (
          <EmptyState
            title="No points yet this season"
            body="Finish in the top six of any race to get on the board."
          />
        )}
        {!!list.data?.length && (
          <Card className="divide-y divide-line/40 p-0">
            {kind === "owners"
              ? owners.data?.map((r) => (
                  <Row
                    key={r.userId}
                    rank={r.rank}
                    title={r.name}
                    sub={`${r.stableName} · ${r.wins} wins`}
                    value={fmt(r.points)}
                    highlight={r.mine}
                  />
                ))
              : horses.data?.map((r) => (
                  <Row
                    key={r.horseId}
                    rank={r.rank}
                    title={r.name}
                    sub={`${r.ownerName ?? ""} · ${r.wins}/${r.races} wins`}
                    value={fmt(r.points)}
                    href={`/horse/?id=${r.horseId}`}
                  />
                ))}
          </Card>
        )}
      </div>
      <SectionTitle>Season prizes</SectionTitle>
      <Card className="divide-y divide-line/40 p-0 text-sm">
        {s.rewards.map((r) => (
          <div key={r.fromRank} className="flex justify-between px-4 py-2.5">
            <span className="text-muted">
              {r.fromRank === r.toRank ? ordinal(r.fromRank) : `${ordinal(r.fromRank)}–${ordinal(r.toRank)}`}
            </span>
            <span className="num">
              {fmt(r.credits)} cr · {r.gems} gems{r.prestige ? ` · ${r.prestige} prestige` : ""}
            </span>
          </div>
        ))}
      </Card>
    </>
  );
}

function HallOfFame() {
  const { data } = useApi<HallOfFameDto[]>("/hall-of-fame");
  if (!data) return <Skeleton className="mt-3 h-40" />;
  if (data.length === 0)
    return (
      <div className="mt-3">
        <EmptyState title="The Hall of Fame awaits" body="Season champions are enshrined here forever." />
      </div>
    );
  const seasons = [...new Set(data.map((d) => d.season))];
  return (
    <div className="mt-3 space-y-2">
      {seasons.map((n) => {
        const owner = data.find((d) => d.season === n && d.category === "CHAMPION_OWNER");
        const horse = data.find((d) => d.season === n && d.category === "CHAMPION_HORSE");
        return (
          <Card key={n}>
            <p className="text-xs uppercase tracking-[0.25em] text-gold">Season {n}</p>
            {owner && (
              <p className="mt-2 flex items-center gap-2">
                <Crown className="size-4 text-gold" aria-hidden />
                <span className="font-medium">{owner.userName}</span>
                <span className="num text-sm text-muted">{fmt(owner.value)} pts</span>
              </p>
            )}
            {horse && (
              <p className="mt-1 flex items-center gap-2">
                <Trophy className="size-4 text-gold" aria-hidden />
                <a href={`/horse/?id=${horse.horseId}`} className="font-medium hover:text-gold">
                  {horse.horseName}
                </a>
                <span className="num text-sm text-muted">{fmt(horse.value)} pts</span>
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function AllTime() {
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
  highlight,
}: {
  rank: number;
  title: string;
  sub: string;
  value: string;
  href?: string;
  highlight?: boolean;
}) {
  const body = (
    <div className={`flex items-center gap-3 px-4 py-3 ${highlight ? "bg-gold/10" : ""}`}>
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
