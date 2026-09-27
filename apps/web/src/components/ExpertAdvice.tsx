"use client";
import type { ExpertAdviceDto, RunStatsDto } from "@thoroughline/contracts";
import { Gem, GraduationCap } from "lucide-react";
import { useState } from "react";
import { post } from "@/lib/api";
import { ATTRIBUTE_LABELS, errorMessage, fmt, STRATEGY_INFO, titleCase, TRAINING_INFO } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";
import { Badge, Button, Card, SectionTitle, useToast } from "./ui";

const label = (k: string) => (
  <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted first:mt-0">{k}</p>
);

function Record({ title, rows, name }: { title: string; rows: RunStatsDto[]; name: (k: string) => string }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="mt-1 text-xs text-muted">{title}</p>
      <ul className="space-y-0.5 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="num">
            {t("expert.recordRow", { key: name(r.key), runs: r.runs, wins: r.wins, avg: r.avgPosition })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Expert trainer's advice for one horse: a locked offer, then the full plan once bought. */
export function ExpertAdvice({ horseId, horseName }: { horseId: string; horseName: string }) {
  const path = `/horses/${horseId}/advice/expert`;
  const { data } = useApi<ExpertAdviceDto>(path);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!data) return null;

  const title = (
    <SectionTitle>
      <span className="inline-flex items-center gap-2">
        <GraduationCap className="size-5 text-gold" aria-hidden />
        {t("expert.title")}
      </span>
    </SectionTitle>
  );

  if (data.locked || !data.advice) {
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
    return (
      <>
        {title}
        <Card>
          <p className="text-sm text-muted">{t("expert.pitch", { name: horseName })}</p>
          <Button className="mt-3 w-full" loading={busy} onClick={unlock}>
            <Gem className="size-4" aria-hidden />
            {t("expert.unlock", { n: data.priceGems })}
          </Button>
          <p className="mt-2 text-center text-xs text-muted">{t("expert.once")}</p>
        </Card>
      </>
    );
  }

  const a = data.advice;
  const h = a.history;
  return (
    <>
      {title}
      <Card className="text-sm">
        {label(t("expert.tactics"))}
        <ol className="mt-1 space-y-1.5">
          {a.tactics.map((x, i) => (
            <li key={x.strategy} className="flex flex-wrap items-center gap-1.5">
              <span className="num w-4 font-display font-bold text-gold">{i + 1}</span>
              <span className="font-semibold">{STRATEGY_INFO[x.strategy]!.label}</span>
              {x.reasons.map((r) => (
                <Badge key={r}>{t(`expert.r.${r}` as MessageKey)}</Badge>
              ))}
            </li>
          ))}
        </ol>

        {label(t("expert.conditions"))}
        <p className="num">
          {t("expert.distance", {
            min: fmt(a.distance.min),
            max: fmt(a.distance.max),
            best: fmt(a.distance.best),
          })}
        </p>
        <p>{t(`expert.going.${a.going}` as MessageKey)}</p>
        <p className="num">
          {t("expert.surfaces", {
            list: a.surfaces.map((s) => `${titleCase(s.surface)} ${s.affinity}`).join(" · "),
          })}
        </p>

        {label(t("expert.gear"))}
        {a.gear.length === 0 ? (
          <p className="text-muted">{t("expert.noGear")}</p>
        ) : (
          <ul className="space-y-0.5">
            {a.gear.map((g) => (
              <li key={g.item}>
                {t("expert.gearHelps", {
                  item: t(`gear.${g.item}` as MessageKey),
                  attr: ATTRIBUTE_LABELS[g.helps]!.toLowerCase(),
                })}
              </li>
            ))}
          </ul>
        )}

        {label(t("expert.training"))}
        <ol className="space-y-0.5">
          {a.training.map((x, i) => (
            <li key={x.attribute} className="num">
              {i + 1}.{" "}
              {t("expert.trainStep", {
                type: TRAINING_INFO[x.type]!.label,
                attr: ATTRIBUTE_LABELS[x.attribute]!,
              })}
              {x.headroom !== null && (
                <span className="text-muted"> · {t("expert.headroom", { n: x.headroom })}</span>
              )}
            </li>
          ))}
        </ol>
        {!data.diagnosed && <p className="mt-1 text-xs text-muted">{t("expert.diagnoseHint")}</p>}

        {a.traits.length > 0 && (
          <>
            {label(t("expert.character"))}
            <ul className="space-y-0.5">
              {a.traits.map((x) => (
                <li key={x}>{t(`expert.t.${x}` as MessageKey)}</li>
              ))}
            </ul>
          </>
        )}

        {label(t("expert.record"))}
        {h.byStrategy.length === 0 ? (
          <p className="text-muted">{t("expert.noRecord")}</p>
        ) : (
          <div className="space-y-1">
            <Record title={t("expert.byTactics")} rows={h.byStrategy} name={(k) => STRATEGY_INFO[k]!.label} />
            <Record title={t("expert.bySurface")} rows={h.bySurface} name={(k) => titleCase(k)} />
            <Record
              title={t("expert.byTrip")}
              rows={h.byTrip}
              name={(k) => t(`expert.trip.${k}` as MessageKey)}
            />
          </div>
        )}
      </Card>
    </>
  );
}
