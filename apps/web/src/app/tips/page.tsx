"use client";
import type { TipsDto, TipsterRowDto } from "@thoroughline/contracts";
import { Target, Trophy } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, ErrorState, SectionTitle, Skeleton } from "@/components/ui";
import { CLASS_NAMES, countdown, fmt } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import { getLocale, t } from "@/lib/i18n";

/** Tipster league: races to tip, the weekly table, last week's winners and your tips. */
export default function TipsPage() {
  const { data, error, reload } = useApi<TipsDto>("/tips", { refreshMs: 30_000 });
  const now = useNow(30_000);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(getLocale() === "uk" ? "uk-UA" : "en", {
      day: "numeric",
      month: "short",
    });
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(getLocale() === "uk" ? "uk-UA" : [], {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("tips.league")}</h1>
      <Card className="mt-3 bg-gradient-to-br from-surface to-surface-2">
        <p className="text-xs uppercase tracking-[0.25em] text-gold">
          {t("tips.week", {
            from: day(data.weekStart),
            to: day(new Date(new Date(data.weekEnd).getTime() - 1).toISOString()),
          })}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            [t("tips.yourRank"), data.me.rank ? `#${data.me.rank}` : "—"],
            [t("tips.points"), fmt(data.me.points)],
            [t("tips.winners"), `${data.me.winners}/${data.me.tips}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg/40 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
              <dd className="num font-display text-xl font-bold text-gold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">
          {t("tips.rules", {
            min: data.rules.minValue,
            max: data.rules.maxValue,
            exact: data.rules.placeExact,
            any: data.rules.placeAny,
            tricast: data.rules.tricastBonus,
          })}
        </p>
        <p className="mt-1 text-xs text-muted">{t("tips.noStakes")}</p>
      </Card>

      <SectionTitle>{t("tips.toTip")}</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-muted">
        {t("tips.dailyLeft", { n: data.dailyLeft, of: data.dailyLimit })}
      </p>
      {data.upcoming.length === 0 && <EmptyState title={t("tips.noneOpen")} body={t("tips.noneOpenBody")} />}
      <div className="space-y-2">
        {data.upcoming.map((r) => (
          <Link key={r.raceId} href={`/race/?id=${r.raceId}`} className="block">
            <Card className="flex items-center justify-between gap-3 transition-colors hover:border-gold/40">
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="text-xs text-muted">
                  {CLASS_NAMES[r.class]} · {t("tips.runnersN", { n: r.runners })} · {time(r.startsAt)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {r.tipped ? (
                  <Badge tone="good">{t("tips.tipped")}</Badge>
                ) : (
                  <Target className="ml-auto size-5 text-gold" aria-hidden />
                )}
                <p className="num mt-1 text-xs text-muted">{countdown(r.startsAt, now)}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <SectionTitle>{t("tips.table")}</SectionTitle>
      <Table rows={data.table} empty={t("tips.tableEmpty")} />
      <p className="mt-2 text-xs text-muted">
        {t("tips.prizes", {
          p: data.rewards
            .slice(0, 3)
            .map((r, i) => `#${i + 1}: ${r.gems ? `${r.gems} ${t("tips.gems")} + ` : ""}${r.reputation} ${t("tips.rep")}`)
            .join(" · "),
          rest: data.rewards[3]?.reputation ?? 0,
          n: data.rewards.length,
        })}
      </p>

      {data.lastWeek.length > 0 && (
        <>
          <SectionTitle>{t("tips.lastWeek")}</SectionTitle>
          <Table rows={data.lastWeek} empty="" />
        </>
      )}

      <SectionTitle>{t("tips.mine")}</SectionTitle>
      {data.myTips.length === 0 && <p className="text-sm text-muted">{t("tips.mineEmpty")}</p>}
      <div className="space-y-2">
        {data.myTips.map((tip) => (
          <Link key={tip.raceId} href={`/race/?id=${tip.raceId}`} className="block">
            <Card className="flex items-center justify-between gap-3 py-3 transition-colors hover:border-gold/40">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{tip.raceName}</p>
                <p className="truncate text-xs text-muted">{tip.picks.map((p) => p.horseName).join(" · ")}</p>
              </div>
              <span className="num shrink-0 text-right text-sm">
                {tip.status === "SCORED" ? (
                  <span className={tip.points ? "font-semibold text-good" : "text-muted"}>+{tip.points}</span>
                ) : tip.status === "VOID" ? (
                  <span className="text-muted">{t("tips.voidShort")}</span>
                ) : (
                  <span className="text-muted">{time(tip.startsAt)}</span>
                )}
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Table({ rows, empty }: { rows: TipsterRowDto[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <Card className="divide-y divide-line/40 p-0">
      {rows.map((r) => (
        <Link
          key={r.userId}
          href={`/owner/?id=${r.userId}`}
          className={`flex items-center gap-3 px-4 py-2.5 ${r.me ? "bg-gold/10" : ""}`}
        >
          <span
            className={`num w-7 font-display text-lg font-bold ${r.rank <= 3 ? "text-gold" : "text-muted"}`}
          >
            {r.rank}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{r.name}</span>
            <span className="block text-xs text-muted">
              <Trophy className="inline size-3 text-gold" aria-hidden /> {r.winners} ·{" "}
              {t("tips.tipsN", { n: r.tips })}
            </span>
          </span>
          <span className="num font-display text-lg font-bold">{fmt(r.points)}</span>
        </Link>
      ))}
    </Card>
  );
}
