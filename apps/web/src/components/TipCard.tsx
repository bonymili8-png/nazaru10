"use client";
import type { RaceDetailDto, RaceTipsDto } from "@thoroughline/contracts";
import { Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, SectionTitle, useToast } from "@/components/ui";
import { put } from "@/lib/api";
import { countdown, errorMessage, ordinal } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

/**
 * Tipster league on a race: pick the first three (tap runners in order), see what each pick is
 * worth, and — once the race is settled — what the tip scored. Points only, never stakes.
 */
export function TipCard({ race }: { race: RaceDetailDto }) {
  const path = `/races/${race.id}/tips`;
  const { data } = useApi<RaceTipsDto>(path, { refreshMs: 15_000 });
  const toast = useToast();
  const now = useNow(1000);
  const [picks, setPicks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const saved = data?.myTip?.picks.join(",") ?? "";
  // Start from the saved tip whenever it changes on the server.
  useEffect(() => setPicks(saved ? saved.split(",") : []), [saved]);
  if (!data || (!data.open && !data.myTip)) return null;

  const value = new Map(data.values.map((v) => [v.horseId, v.value]));
  const names = new Map(race.entryList.map((e) => [e.horseId, e.horseName]));
  const toggle = (id: string) =>
    setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));
  const dirty = picks.join(",") !== saved;
  const save = async () => {
    setBusy(true);
    try {
      await put(path, { picks });
      haptic.success();
      toast(t("tips.saved"));
      invalidate(path, "/tips");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  const tip = data.myTip;
  const scored = tip && tip.points !== null;

  return (
    <>
      <SectionTitle
        action={
          <Link href="/tips/" className="text-sm text-gold underline underline-offset-2">
            {t("tips.league")}
          </Link>
        }
      >
        {t("tips.title")}
      </SectionTitle>
      <Card>
        {data.open && (
          <>
            <p className="text-sm text-muted">{t("tips.howTo")}</p>
            <ul className="mt-3 space-y-1.5" aria-label={t("tips.runners")}>
              {race.entryList.map((e) => {
                const slot = picks.indexOf(e.horseId);
                return (
                  <li key={e.horseId}>
                    <button
                      onClick={() => toggle(e.horseId)}
                      aria-pressed={slot >= 0}
                      className={`flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border px-3 text-left transition-colors ${slot >= 0 ? "border-gold bg-gold/10" : "border-line/60 bg-surface-2"}`}
                    >
                      <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-bg/60 text-xs font-bold text-gold">
                        {slot >= 0 ? ordinal(slot + 1) : "+"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{e.horseName}</span>
                        <span className="block truncate text-xs text-muted">
                          {t("tips.strength", { n: Math.round(e.abilityRating) })}
                          {e.form ? ` · ${t("tips.form", { f: e.form })}` : ""}
                        </span>
                      </span>
                      <span className="num shrink-0 text-right">
                        <span className="block font-semibold text-gold">{value.get(e.horseId) ?? "—"}</span>
                        <span className="block text-[10px] uppercase tracking-wider text-muted">
                          {t("tips.ifWins")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!data.final && <p className="mt-2 text-xs text-muted">{t("tips.notFinal")}</p>}
            <Button
              className="mt-3 w-full"
              loading={busy}
              disabled={!picks.length || !dirty || (!tip && data.dailyLeft <= 0)}
              onClick={() => void save()}
            >
              <Target className="size-4" aria-hidden />
              {tip ? t("tips.update") : t("tips.place")}
            </Button>
            <p className="mt-2 text-center text-xs text-muted">
              {t("tips.closesIn", { t: countdown(data.closesAt, now) })} ·{" "}
              {tip ? t("tips.tipsters", { n: data.tipsters }) : t("tips.left", { n: data.dailyLeft })}
            </p>
          </>
        )}
        {!data.open && tip && (
          <>
            <ol className="space-y-1 text-sm">
              {tip.picks.map((id, i) => (
                <li key={id} className="flex justify-between gap-2">
                  <span className="truncate">
                    <span className="num mr-2 text-muted">{ordinal(i + 1)}</span>
                    {names.get(id) ?? "—"}
                  </span>
                  {scored && (
                    <span className={`num shrink-0 ${tip.slots![i]! > 0 ? "text-good" : "text-muted"}`}>
                      +{tip.slots![i] ?? 0}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-2 border-t border-line/40 pt-2 text-sm">
              {tip.void
                ? t("tips.void")
                : scored
                  ? t("tips.scored", { n: tip.points! }) +
                    (tip.tricast ? ` · ${t("tips.tricast", { n: tip.tricast })}` : "")
                  : t("tips.pending")}
            </p>
          </>
        )}
      </Card>
    </>
  );
}
