"use client";
import type { RaceReportDto } from "@thoroughline/contracts";
import { ArrowDown, ArrowUp, Crown, Gem, LineChart, Minus } from "lucide-react";
import { useState } from "react";
import { post } from "@/lib/api";
import { errorMessage, ordinal, STRATEGY_INFO } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";
import { Button, Card, Meter, SectionTitle, useToast } from "./ui";

/** Post-race report for one of the viewer's runs: locked until bought (free for members). */
export function RaceReport({
  raceId,
  horseId,
  distance,
}: {
  raceId: string;
  horseId: string;
  distance: number;
}) {
  const path = `/races/${raceId}/report/${horseId}`;
  const { data, error } = useApi<RaceReportDto>(path);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (error || !data) return null;

  const unlock = async () => {
    setBusy(true);
    try {
      await post(`${path}/unlock`);
      haptic.success();
      invalidate(path, "/wallet");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const title = (
    <SectionTitle>
      <span className="inline-flex items-center gap-2">
        <LineChart className="size-5 text-gold" aria-hidden />
        {t("report.title", { name: data.horseName })}
      </span>
    </SectionTitle>
  );

  if (data.locked || !data.report) {
    return (
      <>
        {title}
        <Card>
          <p className="text-sm text-muted">{t("report.lockedText", { name: data.horseName })}</p>
          <Button className="mt-3 w-full" loading={busy} onClick={unlock}>
            <Gem className="size-4" aria-hidden />
            {t("report.unlock", { n: data.priceGems })}
          </Button>
          <p className="mt-2 flex items-center justify-center gap-1 text-xs text-muted">
            <Crown className="size-3 text-gold" aria-hidden />
            {t("report.memberFree")}
          </p>
        </Card>
      </>
    );
  }

  const r = data.report;
  const marks = [0.25, 0.5, 0.75].map((q) => t("report.at", { m: Math.round(distance * q) }));
  const energyTone = (v: number) => (v < 0.05 ? "bad" : v < 0.2 ? "warn" : "good");
  return (
    <>
      {title}
      <Card>
        <p className="text-sm text-muted">
          {t("report.plan", {
            tactic: STRATEGY_INFO[r.strategy]!.label,
            gear: r.gear ? t(`gear.${r.gear}` as MessageKey) : t("race.noGear"),
          })}
        </p>

        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted">
          {t("report.positions")}
        </p>
        <ol className="mt-2 grid grid-cols-4 gap-2 text-center">
          {r.positions.map((p, i) => {
            const prev = i === 0 ? null : r.positions[i - 1]!;
            const Icon = prev === null || prev === p ? Minus : p < prev ? ArrowUp : ArrowDown;
            const tone = prev === null || prev === p ? "text-muted" : p < prev ? "text-good" : "text-bad";
            return (
              <li key={i} className="rounded-xl bg-surface-2 py-2">
                <p className="num font-display text-lg font-bold">{ordinal(p)}</p>
                <p className="flex items-center justify-center gap-0.5 text-[11px] text-muted">
                  <Icon className={`size-3 ${tone}`} aria-hidden />
                  {i < 3 ? marks[i] : t("report.finish")}
                </p>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted">
          {t("report.sectionals")}
        </p>
        <table className="mt-1 w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1 text-left font-medium" />
              <th className="py-1 text-right font-medium">{t("report.mine")}</th>
              <th className="py-1 text-right font-medium">{t("report.best")}</th>
            </tr>
          </thead>
          <tbody>
            {r.sectionals.map((s, i) => {
              const gap = s.mine - s.best;
              return (
                <tr key={i} className="border-t border-line/40">
                  <td className="py-1.5 text-muted">{t("report.quarter", { n: i + 1 })}</td>
                  <td className={`num py-1.5 text-right ${gap < 0.05 ? "text-good" : ""}`}>
                    {s.mine.toFixed(2)}
                    {gap >= 0.05 && <span className="ml-1 text-xs text-muted">+{gap.toFixed(2)}</span>}
                  </td>
                  <td className="num py-1.5 text-right text-muted">{s.best.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted">{t("report.energy")}</p>
        <Meter
          label={t("report.energy75")}
          value={r.energyAt75 * 100}
          tone={energyTone(r.energyAt75)}
          suffix="%"
        />
        <Meter
          label={t("report.energyEnd")}
          value={r.energyAtFinish * 100}
          tone={energyTone(r.energyAtFinish)}
          suffix="%"
        />
        <p className="num mt-1 text-sm text-muted">
          {t("report.topSpeed", { n: (r.topSpeed * 3.6).toFixed(1) })}
        </p>

        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted">{t("report.insights")}</p>
        <ul className="mt-1 space-y-1.5 text-sm">
          {r.insights.length === 0 && <li className="text-muted">{t("report.none")}</li>}
          {r.insights.map((i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
              {t(`report.i.${i}` as MessageKey)}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
