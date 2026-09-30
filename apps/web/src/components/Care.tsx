"use client";
import type { CareAction, CareRoundDto, HorseDetailDto, StableLadsDto } from "@thoroughline/contracts";
import { Droplets, Footprints, Gem, Hammer, Hand, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Button, Card, Meter, Section, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { getLocale, type MessageKey, t } from "@/lib/i18n";
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
  const lads = useApi<StableLadsDto>("/stable/lads", { refreshMs: 60_000 });
  const { busy, run } = useCare();
  if (!data || data.horses.length === 0) return null;
  const jobs = data.horses.reduce((n, h) => n + h.ready.length, 0);
  const onDuty = lads.data?.lads ?? 0;
  const summary = [
    onDuty ? t("lads.onDuty", { n: onDuty }) : t("lads.none"),
    jobs ? t("care.roundJobs", { n: jobs }) : t("care.roundDone"),
  ]
    .filter(Boolean)
    .join(" · ");
  // Folded by default: the round is long, and the lads can do it for you.
  return (
    <Section id="round" title={t("care.round")} summary={summary}>
      <LadsPanel />
      <Card className="mt-2 space-y-3">
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

/** The stable-lads card with its own data (the yard round and the staff page both show it). */
export function LadsPanel() {
  const { data, error, reload } = useApi<StableLadsDto>("/stable/lads", { refreshMs: 60_000 });
  if (error)
    return (
      <Card>
        <p className="font-semibold">{t("lads.title")}</p>
        <p className="mt-1 text-sm text-muted">{t("lads.unavailable")}</p>
        <Button variant="ghost" className="mt-2 text-sm" onClick={() => void reload()}>
          {t("lads.retry")}
        </Button>
      </Card>
    );
  if (!data) return <Skeleton className="h-24" />;
  return <Lads d={data} />;
}

/** Stable lads for gems: they do the round as jobs come due (only the round, nothing else). */
function Lads({ d }: { d: StableLadsDto }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const date = (iso: string, time = false) =>
    new Date(iso).toLocaleString(getLocale() === "uk" ? "uk-UA" : "en", {
      day: "numeric",
      month: "short",
      ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  const hire = async (lads: number, gems: number, ask: string) => {
    if (!window.confirm(t("lads.confirm", { what: ask, n: gems }))) return;
    setBusy(lads);
    try {
      await post("/stable/lads", { lads });
      haptic.success();
      toast(t("lads.hired"));
      invalidate("/stable/lads", "/wallet", "/horses/care/round", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const team = (n: number) =>
    t(n >= d.maxLads ? "lads.teamAll" : "lads.teamSome", { n, h: n * d.horsesPerLad });

  return (
    <Card>
      <p className="flex items-center gap-2 font-semibold">
        <Users className="size-4 text-gold" aria-hidden />
        {t("lads.title")}
      </p>
      {d.lads === 0 ? (
        <>
          <p className="mt-1 text-sm text-muted">{t("lads.pitch", { n: d.needed })}</p>
          <div className="mt-3 grid gap-2">
            {Array.from({ length: d.maxLads }, (_, i) => i + 1).map((n) => (
              <Button
                key={n}
                variant={n === d.needed ? "primary" : "secondary"}
                className="text-sm"
                loading={busy === n}
                disabled={busy !== null}
                onClick={() => void hire(n, n * d.gemsPerLadWeek, team(n))}
              >
                <Gem className="size-4" aria-hidden />
                {t("lads.hire", { team: team(n), n: n * d.gemsPerLadWeek })}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm">{t("lads.active", { team: team(d.lads), date: date(d.paidUntil!) })}</p>
          {d.covered < d.horses && (
            <p className="mt-1 text-sm text-warn">{t("lads.partial", { n: d.covered, of: d.horses })}</p>
          )}
          <p className="mt-1 text-xs text-muted">
            {d.lastWorkAt
              ? t("lads.lastWork", { at: date(d.lastWorkAt, true), n: d.lastWorkJobs })
              : t("lads.noWorkYet")}
          </p>
          <div className="mt-3 grid gap-2">
            {d.upgradeGems !== null && (
              <Button
                variant={d.covered < d.horses ? "primary" : "secondary"}
                className="text-sm"
                loading={busy === d.maxLads}
                disabled={busy !== null}
                onClick={() => void hire(d.maxLads, d.upgradeGems!, t("lads.addLad"))}
              >
                <Gem className="size-4" aria-hidden />
                {t("lads.upgrade", { n: d.upgradeGems })}
              </Button>
            )}
            <Button
              variant="ghost"
              className="text-sm"
              loading={busy === d.lads}
              disabled={busy !== null || !d.canExtend}
              onClick={() => void hire(d.lads, d.lads * d.gemsPerLadWeek, t("lads.aWeek"))}
            >
              {d.canExtend ? t("lads.extend", { n: d.lads * d.gemsPerLadWeek }) : t("lads.paidAhead")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
