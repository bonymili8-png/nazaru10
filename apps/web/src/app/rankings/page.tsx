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
import { t } from "@/lib/i18n";

type Board = "horses" | "owners";
type By = "rating" | "earnings" | "wins";

type Top = "season" | "alltime" | "fame";

export default function RankingsPage() {
  const [top, setTop] = useState<Top>("season");
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("rank.title")}</h1>
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-surface p-1" role="tablist">
        {(
          [
            ["season", t("rank.season")],
            ["alltime", t("rank.alltime")],
            ["fame", t("rank.fame")],
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
          <p className="font-display text-2xl font-bold">{t("rank.seasonN", { n: s.season })}</p>
          <p className="num text-sm text-muted">{t("rank.endsIn", { t: countdown(s.endsAt, now) })}</p>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            [t("rank.yourRank"), s.me.rank ? ordinal(s.me.rank) : "—"],
            [t("rank.points"), fmt(s.me.points)],
            [t("rank.wins"), `${s.me.wins}/${s.me.races}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg/40 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
              <dd className="num font-display text-xl font-bold text-gold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">{t("rank.pointsHint")}</p>
      </Card>
      <div className="mt-3 flex gap-2">
        {(["owners", "horses"] as const).map((k) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-sm ${kind === k ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {k === "owners" ? t("rank.owners") : t("rank.horsesTab")}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {!list.data && <Skeleton className="h-40" />}
        {list.data?.length === 0 && <EmptyState title={t("rank.noPoints")} body={t("rank.noPointsBody")} />}
        {!!list.data?.length && (
          <Card className="divide-y divide-line/40 p-0">
            {kind === "owners"
              ? owners.data?.map((r) => (
                  <Row
                    key={r.userId}
                    rank={r.rank}
                    title={r.name}
                    sub={`${r.stableName} · ${t("common.wins", { n: r.wins })}`}
                    value={fmt(r.points)}
                    highlight={r.mine}
                  />
                ))
              : horses.data?.map((r) => (
                  <Row
                    key={r.horseId}
                    rank={r.rank}
                    title={r.name}
                    sub={`${r.ownerName ?? ""} · ${t("common.winsOf", { w: r.wins, n: r.races })}`}
                    value={fmt(r.points)}
                    href={`/horse/?id=${r.horseId}`}
                  />
                ))}
          </Card>
        )}
      </div>
      <SectionTitle>{t("rank.prizes")}</SectionTitle>
      <Card className="divide-y divide-line/40 p-0 text-sm">
        {s.rewards.map((r) => (
          <div key={r.fromRank} className="flex justify-between px-4 py-2.5">
            <span className="text-muted">
              {r.fromRank === r.toRank ? ordinal(r.fromRank) : `${ordinal(r.fromRank)}–${ordinal(r.toRank)}`}
            </span>
            <span className="num">
              {fmt(r.credits)} {t("common.cr")} · {r.gems} {t("common.gems")}
              {r.prestige ? ` · ${t("rank.prestige", { n: r.prestige })}` : ""}
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
        <EmptyState title={t("rank.fameEmpty")} body={t("rank.fameBody")} />
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
            <p className="text-xs uppercase tracking-[0.25em] text-gold">{t("rank.seasonN", { n })}</p>
            {owner && (
              <p className="mt-2 flex items-center gap-2">
                <Crown className="size-4 text-gold" aria-hidden />
                <span className="font-medium">{owner.userName}</span>
                <span className="num text-sm text-muted">{t("rank.pts", { n: fmt(owner.value) })}</span>
              </p>
            )}
            {horse && (
              <p className="mt-1 flex items-center gap-2">
                <Trophy className="size-4 text-gold" aria-hidden />
                <a href={`/horse/?id=${horse.horseId}`} className="font-medium hover:text-gold">
                  {horse.horseName}
                </a>
                <span className="num text-sm text-muted">{t("rank.pts", { n: fmt(horse.value) })}</span>
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
    rating: board === "horses" ? t("common.rating") : t("rank.reputation"),
    earnings: t("rank.earnings"),
    wins: t("rank.wins"),
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
            className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium ${board === b ? "bg-gold text-bg" : "text-muted"}`}
          >
            {b === "owners" ? t("rank.owners") : t("rank.horsesTab")}
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
          <EmptyState title={t("rank.noEntries")} body={t("rank.noEntriesBody")} />
        )}
        {!!active.data?.length && (
          <Card className="divide-y divide-line/40 p-0">
            {board === "horses"
              ? horses.data?.map((r) => (
                  <Row
                    key={r.horseId}
                    rank={r.rank}
                    title={r.name}
                    sub={`${r.ownerName ?? ""} · ${t("common.winsOf", { w: r.wins, n: r.starts })}`}
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
