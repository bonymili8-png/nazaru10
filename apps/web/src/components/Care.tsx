"use client";
import type { CareAction, CareRoundDto, HorseDetailDto } from "@thoroughline/contracts";
import { Droplets, Footprints, Hammer, Hand, Sparkles } from "lucide-react";
import { useState } from "react";
import { Card, Meter, Section, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

export const CARE_ICON: Record<CareAction, typeof Sparkles> = {
  GROOM: Sparkles,
  HAND_WALK: Footprints,
  COLD_HOSE: Droplets,
  MASSAGE: Hand,
  FARRIER: Hammer,
};

/** Perform one care action and refresh everything that shows the horse. */
function useCare() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (horseId: string, action: CareAction, name: string) => {
    setBusy(`${horseId}:${action}`);
    try {
      await post(`/horses/${horseId}/care/${action}`);
      haptic.success();
      toast(t(`care.done.${action}` as MessageKey, { name }));
      invalidate(`/horses/${horseId}`, "/horses/care/round", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** Daily care on the horse page: trust, the five jobs, and why a job has to wait. */
export function HorseCare({ h }: { h: HorseDetailDto }) {
  const care = h.private!.care;
  const now = useNow(30_000);
  const { busy, run } = useCare();
  const ready = care.actions.filter((a) => a.ready).length;
  return (
    <Section
      id="care"
      title={t("care.title")}
      summary={
        ready
          ? t("care.summaryReady", { n: ready, bond: Math.round(care.bond) })
          : t("care.summaryDone", { bond: Math.round(care.bond) })
      }
      defaultOpen
    >
      <Card>
        <Meter label={t("care.bond")} value={care.bond} tone="good" />
        <p className="mt-1 text-xs text-muted">{t("care.bondHint")}</p>
        <ul className="mt-3 space-y-2">
          {care.actions.map((a) => {
            const Icon = CARE_ICON[a.action];
            const why = a.ready
              ? t(`care.what.${a.action}` as MessageKey)
              : a.block === "COOLDOWN" && a.availableAt
                ? t("care.again", { t: countdown(a.availableAt, now) })
                : t(`care.block.${a.block}` as MessageKey);
            return (
              <li key={a.action}>
                <button
                  disabled={!a.ready || busy !== null}
                  onClick={() => void run(h.id, a.action, h.name)}
                  aria-busy={busy === `${h.id}:${a.action}`}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-line/60 bg-surface-2 p-3 text-left transition-colors hover:border-gold disabled:cursor-default disabled:opacity-60 disabled:hover:border-line/60"
                >
                  <Icon className={`size-5 shrink-0 ${a.ready ? "text-gold" : "text-muted"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{t(`care.${a.action}` as MessageKey)}</span>
                    <span className="block text-xs text-muted">{why}</span>
                  </span>
                  {a.ready && (a.fatigueRelief > 0 || a.bond > 0) && (
                    <span className="num shrink-0 text-right text-xs text-good">
                      {a.fatigueRelief > 0 && (
                        <span className="block">
                          −{a.fatigueRelief} {t("care.fatigue")}
                        </span>
                      )}
                      {a.bond > 0 && (
                        <span className="block">
                          +{a.bond} {t("care.trust")}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          {t("care.shoes", { n: care.shoeStarts, max: care.shoeLimit })}
          {care.massaged && ` · ${t("care.massaged")}`}
        </p>
      </Card>
    </Section>
  );
}

/** The morning round of the yard: every horse with what it can have right now. */
export function StableRound() {
  const { data } = useApi<CareRoundDto>("/horses/care/round", { refreshMs: 60_000 });
  const { busy, run } = useCare();
  if (!data || data.horses.length === 0) return null;
  const jobs = data.horses.reduce((n, h) => n + h.ready.length, 0);
  return (
    <Section
      id="round"
      title={t("care.round")}
      summary={jobs ? t("care.roundJobs", { n: jobs }) : t("care.roundDone")}
      defaultOpen
    >
      <Card className="space-y-3">
        {data.horses.map((h) => (
          <div key={h.horseId}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold">{h.name}</span>
              <span className="num shrink-0 text-xs text-muted">
                {t("care.trust")} {Math.round(h.bond)}
              </span>
            </div>
            {h.ready.length ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {h.ready.map((a) => {
                  const Icon = CARE_ICON[a];
                  return (
                    <button
                      key={a}
                      disabled={busy !== null}
                      onClick={() => void run(h.horseId, a, h.name)}
                      aria-busy={busy === `${h.horseId}:${a}`}
                      className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-line/60 bg-surface-2 px-3 text-sm transition-colors hover:border-gold disabled:opacity-60"
                    >
                      <Icon className="size-4 text-gold" aria-hidden />
                      {t(`care.${a}` as MessageKey)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">{t("care.allDone")}</p>
            )}
          </div>
        ))}
      </Card>
    </Section>
  );
}
