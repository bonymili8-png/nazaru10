"use client";
import type { RaceSummaryDto } from "@thoroughline/contracts";
import { CloudRain, Sun, Wind, Cloud, CloudFog, Thermometer, Snowflake, CloudLightning } from "lucide-react";
import Link from "next/link";
import { CLASS_NAMES, countdown, fmt, titleCase } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { Badge } from "./ui";
import { t } from "@/lib/i18n";

export const WEATHER_ICON = {
  SUNNY: Sun,
  CLOUDY: Cloud,
  RAIN: CloudRain,
  HEAVY_RAIN: CloudLightning,
  WIND: Wind,
  FOG: CloudFog,
  HEAT: Thermometer,
  COLD: Snowflake,
} as const;

export function RaceCard({ race }: { race: RaceSummaryDto }) {
  const now = useNow(1000);
  const W = WEATHER_ICON[race.weather];
  const opens = race.status === "OPEN";
  return (
    <Link
      href={`/race/?id=${race.id}`}
      className="block rounded-[var(--radius-card)] border border-line/60 bg-surface p-3.5 transition-colors hover:border-gold/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone="gold">{CLASS_NAMES[race.class]}</Badge>
            {race.status === "RUNNING" && <Badge tone="bad">{t("race.live")}</Badge>}
            {race.status === "COMPLETED" && <Badge>{t("race.result")}</Badge>}
          </div>
          <p className="mt-1.5 truncate font-semibold">{race.trackName}</p>
          <p className="text-sm text-muted">
            {race.distance}m · {titleCase(race.surface)} ·{" "}
            <W className="inline size-3.5 align-[-2px]" aria-label={titleCase(race.weather)} />{" "}
            {titleCase(race.going)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-semibold text-gold">{fmt(race.purse)}</p>
          <p className="text-[11px] text-muted">{t("race.purseFee", { fee: fmt(race.entryFee) })}</p>
        </div>
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span className="num">{t("race.runners", { n: race.entries, max: race.maxField })}</span>
        <span className="num">
          {opens
            ? t("race.closesIn", { t: countdown(race.locksAt, now) })
            : race.status === "LOCKED"
              ? t("race.offIn", { t: countdown(race.startsAt, now) })
              : new Date(race.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </Link>
  );
}
