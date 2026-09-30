"use client";
import type { GallopDto, GallopsDto, HorseDetailDto } from "@thoroughline/contracts";
import { RACE_CLASSES, type RaceClass, SURFACES, type Surface } from "@thoroughline/engine";
import { Timer } from "lucide-react";
import { useState } from "react";
import { Button, Card, Section, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, titleCase } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { getLocale, type MessageKey, t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

/** 72.4 → "1:12.4". */
export const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** The margin against the lead horse in words. */
export function marginText(m: number): string {
  if (Math.abs(m) < 0.25) return t("gallop.level");
  return m > 0 ? t("gallop.ahead", { n: m.toFixed(1) }) : t("gallop.behind", { n: (-m).toFixed(1) });
}

function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  name: (v: T) => string;
}) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs uppercase tracking-wider text-muted">{label}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            role="radio"
            aria-checked={value === o}
            onClick={() => onChange(o)}
            className={`min-h-10 cursor-pointer rounded-full border px-3 text-sm transition-colors ${value === o ? "border-gold bg-gold/10 text-ink" : "border-line/60 bg-surface-2 text-muted hover:text-ink"}`}
          >
            {name(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Morning work on the clock against the yard's lead horse for a class. The owner picks the trip,
 * the surface and the yardstick, and reads the result; the game draws no conclusion from it.
 */
export function Gallop({ h }: { h: HorseDetailDto }) {
  const { data } = useApi<GallopsDto>(`/horses/${h.id}/gallops`);
  const toast = useToast();
  const now = useNow(30_000);
  const [distance, setDistance] = useState(1200);
  const [surface, setSurface] = useState<Surface>("TURF");
  const [lead, setLead] = useState<RaceClass>("MAIDEN");
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  const send = async () => {
    setBusy(true);
    try {
      const g = await post<GallopDto>(`/horses/${h.id}/gallops`, { distance, surface, leadClass: lead });
      haptic.success();
      toast(`${clock(g.time)} · ${marginText(g.margin)}`);
      invalidate(`/horses/${h.id}/gallops`, `/horses/${h.id}`, "/horses");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  const status = data.ready
    ? t("gallop.ready")
    : data.block === "COOLDOWN" && data.availableAt
      ? t("gallop.again", { t: countdown(data.availableAt, now) })
      : t(`gallop.block.${data.block}` as MessageKey);
  const date = (iso: string) =>
    new Date(iso).toLocaleString(getLocale() === "uk" ? "uk-UA" : "en", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Section id="gallop" title={t("gallop.title")} summary={status}>
      <Card>
        <p className="text-sm text-muted">{t("gallop.hint")}</p>
        <Choice
          label={t("gallop.distance")}
          options={data.distances}
          value={distance}
          onChange={setDistance}
          name={(d) => t("unit.m", { n: d })}
        />
        <Choice
          label={t("gallop.surface")}
          options={SURFACES}
          value={surface}
          onChange={setSurface}
          name={titleCase}
        />
        <Choice
          label={t("gallop.lead")}
          options={RACE_CLASSES}
          value={lead}
          onChange={setLead}
          name={(c) => t(`class.${c}` as MessageKey)}
        />
        <Button className="mt-4 w-full" loading={busy} disabled={!data.ready} onClick={() => void send()}>
          <Timer className="size-4" aria-hidden />
          {t("gallop.send", { n: data.fatigueCost })}
        </Button>
        {!data.ready && <p className="mt-2 text-center text-xs text-muted">{status}</p>}
        {data.history.length > 0 && (
          <ul
            className="mt-4 space-y-2 border-t border-line/40 pt-3 text-sm"
            aria-label={t("gallop.history")}
          >
            {data.history.map((g) => (
              <li key={g.id}>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">
                    {date(g.at)} · {t("unit.m", { n: g.distance })} {titleCase(g.surface)}
                  </span>
                  <span className="num font-semibold">{clock(g.time)}</span>
                </div>
                <p
                  className={`text-xs ${g.margin >= 0.25 ? "text-good" : g.margin <= -0.25 ? "text-bad" : "text-ink"}`}
                >
                  {t("gallop.vsLead", { cls: t(`class.${g.leadClass}` as MessageKey), t: clock(g.leadTime) })}{" "}
                  · {marginText(g.margin)} · {t("gallop.fatigueThen", { n: g.fatigue })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  );
}
