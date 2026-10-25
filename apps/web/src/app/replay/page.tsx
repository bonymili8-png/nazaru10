"use client";
import type { RaceDetailDto } from "@thoroughline/contracts";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { LiveRace } from "@/components/LiveRace";
import { PublicFrame } from "@/components/PublicFrame";
import { HorseHref, HorseLink } from "@/components/RunnerLinks";
import { Card, ErrorState, SectionTitle, Skeleton } from "@/components/ui";
import { ordinal, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { getLocale, t } from "@/lib/i18n";
import { countVisit, playLink } from "@/lib/share";

/**
 * Public replay of a finished race, opened from a shared link in any browser: the race plays on
 * the camera straight away, then the result. Preview cards for the link come from the API.
 */
export default function ReplayPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-64" />}>
      <ReplayPage />
    </Suspense>
  );
}

function ReplayPage() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const ref = params.get("r");
  const { data: race, error, reload } = useApi<RaceDetailDto>(id ? `/public/races/${id}` : null);
  useEffect(() => {
    if (id) countVisit("race", id, ref);
  }, [id, ref]);
  const horseHref = (h: string) => `/horse-card/?id=${h}${ref ? `&r=${encodeURIComponent(ref)}` : ""}`;
  const winner = race?.entryList.find((e) => e.position === 1);
  return (
    <PublicFrame
      play={playLink("race", id, ref)}
      cta={winner ? t("pub.raceCta", { name: winner.horseName }) : t("pub.genericCta")}
    >
      {!id && <ErrorState error={new Error(t("race.noneSelected"))} />}
      {error && <ErrorState error={error} retry={reload} />}
      {id && !race && !error && <Skeleton className="mt-4 h-64" />}
      {race && (
        <>
          <h1 className="mt-4 font-display text-2xl font-bold leading-tight">{race.name}</h1>
          <p className="text-sm text-muted">
            {race.trackName} · {t("unit.m", { n: race.distance })} {titleCase(race.surface)} ·{" "}
            {titleCase(race.going)} ·{" "}
            {new Date(race.startsAt).toLocaleDateString(getLocale() === "uk" ? "uk-UA" : [], {
              day: "numeric",
              month: "short",
            })}
          </p>
          <HorseHref.Provider value={horseHref}>
            <LiveRace race={race} livePath={`/public/races/${race.id}/live`} autoReplay />
            <SectionTitle>{t("pub.result")}</SectionTitle>
            <Card className="divide-y divide-line/40 p-0">
              {[...race.entryList]
                .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
                .map((e) => (
                  <div key={e.horseId} className="flex items-center gap-3 px-4 py-2">
                    <span className="num w-10 font-display text-lg font-bold">
                      {e.position ? ordinal(e.position) : "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{e.isHouse ? e.horseName : <HorseLink e={e} />}</p>
                      <p className="truncate text-xs text-muted">
                        {e.isHouse ? t("common.house") : (e.ownerName ?? "")}
                      </p>
                    </div>
                    <span className="num text-sm text-muted">
                      {e.position === 1
                        ? t("live.sec", { n: e.finishTime?.toFixed(2) ?? "" })
                        : t("live.lengths", { n: e.lengthsBehind?.toFixed(1) ?? "" })}
                    </span>
                  </div>
                ))}
            </Card>
          </HorseHref.Provider>
        </>
      )}
    </PublicFrame>
  );
}
