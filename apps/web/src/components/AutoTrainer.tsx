"use client";
import type { AutoTrainerDto } from "@thoroughline/contracts";
import { Bot, Gem } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { errorMessage, fmt, TRAINING_INFO } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { getLocale, t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

const PATH = "/stable/auto-trainer";
/** The phone's time zone: the trainer works to the owner's own clock. */
const phoneZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/**
 * The auto-trainer (gems, by the month): trains every free horse twice a day — a hard morning
 * session on a rested horse, a safe normal one in the afternoon — and never spends the wallet
 * below the credit floor.
 */
export function AutoTrainer() {
  const { data } = useApi<AutoTrainerDto>(PATH, { refreshMs: 60_000 });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Skeleton className="mt-3 h-40" />;
  const date = (iso: string) =>
    new Date(iso).toLocaleString(getLocale() === "uk" ? "uk-UA" : "en", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const act = async (key: string, url: string, body: unknown, done: string) => {
    setBusy(key);
    try {
      await post(url, body);
      haptic.success();
      toast(done);
      invalidate(PATH, "/wallet", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const buy = () => {
    if (!window.confirm(t("auto.confirm", { n: fmt(data.priceGems), days: data.days }))) return;
    void act("buy", PATH, { timezone: phoneZone() }, t("auto.hired"));
  };
  const [am, pm] = data.hours;
  return (
    <Card className="mt-3">
      <p className="flex items-center gap-2 font-semibold">
        <Bot className="size-4 text-gold" aria-hidden />
        {t("auto.title")}
        {data.active && (
          <Badge tone={data.paused ? "warn" : "good"}>{t(data.paused ? "auto.paused" : "auto.on")}</Badge>
        )}
      </p>
      <p className="mt-1 text-sm text-muted">
        {t("auto.pitch", { am: `${am}:00`, pm: `${pm}:00`, min: fmt(data.minCredits) })}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
        <li>{t("auto.rule.morning", { am: `${am}:00` })}</li>
        <li>{t("auto.rule.afternoon", { pm: `${pm}:00` })}</li>
        <li>{t("auto.rule.free")}</li>
        <li>{t("auto.rule.floor", { min: fmt(data.minCredits) })}</li>
      </ul>
      {data.active ? (
        <>
          <p className="mt-3 text-sm">{t("auto.until", { date: date(data.paidUntil!) })}</p>
          <p className="text-xs text-muted">{t("auto.zone", { zone: data.timezone ?? "UTC" })}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              className="text-sm"
              loading={busy === "pause"}
              onClick={() =>
                void act(
                  "pause",
                  `${PATH}/pause`,
                  { paused: !data.paused },
                  t(data.paused ? "auto.resumed" : "auto.pausedToast"),
                )
              }
            >
              {t(data.paused ? "auto.resume" : "auto.pause")}
            </Button>
            <Button variant="secondary" className="text-sm" loading={busy === "buy"} onClick={buy}>
              <Gem className="size-4" aria-hidden />
              {t("auto.extend", { n: fmt(data.priceGems), days: data.days })}
            </Button>
          </div>
        </>
      ) : (
        <Button className="mt-3 w-full" loading={busy === "buy"} onClick={buy}>
          <Gem className="size-4" aria-hidden />
          {t("auto.hire", { n: fmt(data.priceGems), days: data.days })}
        </Button>
      )}
      {data.recent.length > 0 && (
        <div className="mt-3 border-t border-line/40 pt-2">
          <p className="text-xs font-medium text-muted">{t("auto.recent")}</p>
          <ul className="mt-1 space-y-1 text-xs">
            {data.recent.slice(0, 8).map((r) => (
              <li key={`${r.horseId}-${r.localDate}-${r.slot}`} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {r.horseName} · {TRAINING_INFO[r.type]!.label} · {t(`enum.${r.intensity}`)}
                </span>
                <span className="num shrink-0 text-muted">{date(r.startedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
