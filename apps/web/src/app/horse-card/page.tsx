"use client";
import type { PublicHorseDto } from "@thoroughline/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { PublicFrame } from "@/components/PublicFrame";
import { Card, ErrorState, SectionTitle, Skeleton } from "@/components/ui";
import { fmt, ordinal, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { getLocale, t } from "@/lib/i18n";
import { countCampaignClick, countVisit, playLink } from "@/lib/share";

/** A horse's public card, opened from a shared link: record, rating, recent runs. */
export default function HorseCardWrapper() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-64" />}>
      <HorseCard />
    </Suspense>
  );
}

function HorseCard() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const ref = params.get("r");
  const campaign = params.get("c");
  const { data: h, error, reload } = useApi<PublicHorseDto>(id ? `/public/horses/${id}` : null);
  useEffect(() => {
    if (id) countVisit("horse", id, ref);
    countCampaignClick(campaign);
  }, [id, ref, campaign]);
  const r = ref ? `&r=${encodeURIComponent(ref)}` : "";
  return (
    <PublicFrame
      play={playLink("horse", id, ref, campaign)}
      cta={h ? t("pub.horseCta", { name: h.name }) : t("pub.genericCta")}
    >
      {!id && <ErrorState error={new Error(t("horse.noneSelected"))} />}
      {error && <ErrorState error={error} retry={reload} />}
      {id && !h && !error && <Skeleton className="mt-4 h-64" />}
      {h && (
        <>
          <h1 className="mt-4 font-display text-3xl font-bold">{h.name}</h1>
          <p className="text-sm text-muted">
            {t("pub.horseLine", { age: h.age, sex: titleCase(h.sex), coat: titleCase(h.coat) })}
            {h.stable && ` · ${h.stable}`}
            {h.retired && ` · ${t("pub.retired")}`}
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            {(
              [
                [t("pub.starts"), h.starts],
                [t("pub.wins"), h.wins],
                [t("pub.places"), h.seconds + h.thirds],
                [t("pub.rating"), h.raceRating],
                [t("pub.earnings"), fmt(h.earnings)],
              ] as const
            ).map(([k, v]) => (
              <Card key={k} className="p-3">
                <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
                <dd className="num font-display text-xl font-bold text-gold">{v}</dd>
              </Card>
            ))}
          </dl>
          {h.recent.length > 0 && (
            <>
              <SectionTitle>{t("pub.recent")}</SectionTitle>
              <Card className="divide-y divide-line/40 p-0">
                {h.recent.map((x) => (
                  <Link
                    key={x.raceId}
                    href={`/replay/?id=${x.raceId}${r}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
                  >
                    <span className="num w-10 font-display text-lg font-bold">
                      {x.position ? ordinal(x.position) : "—"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{x.raceName}</span>
                      <span className="block text-xs text-muted">
                        {t("unit.m", { n: x.distance })} · {t("pub.ofField", { n: x.field })} ·{" "}
                        {new Date(x.startsAt).toLocaleDateString(getLocale() === "uk" ? "uk-UA" : [], {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </span>
                    <span className="text-xs text-gold">{t("pub.watch")}</span>
                  </Link>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </PublicFrame>
  );
}
