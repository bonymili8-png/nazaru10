"use client";
import type { PublicStableDto, PublicStableHorseDto } from "@thoroughline/contracts";
import { HandCoins } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Crest } from "@/components/Crest";
import { coatColor } from "@/components/HorseCard";
import { MemberBadge } from "@/components/MemberBadge";
import { MakeOffer } from "@/components/Offers";
import { Badge, Card, EmptyState, ErrorState, SectionTitle, Skeleton } from "@/components/ui";
import { ATTRIBUTE_LABELS, fmt, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";

export default function OwnerPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <OwnerPage />
    </Suspense>
  );
}

/** Any owner's stable: who they are, and every horse with its rating and attributes. */
function OwnerPage() {
  const id = useSearchParams().get("id");
  const { data: s, error, reload } = useApi<PublicStableDto>(id ? `/owners/${id}` : null);
  if (!id) return <ErrorState error={new Error(t("owners.noneSelected"))} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!s) return <Skeleton className="h-64" />;
  return (
    <div>
      <Card className="bg-gradient-to-br from-surface to-surface-2">
        <div className="flex items-center gap-3">
          <Crest crest={s.crest} size={52} />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.25em] text-gold">
              {t("owners.level", { n: s.level })}
            </p>
            <h1 className="flex items-center gap-1.5 truncate font-display text-2xl font-bold">
              {s.stableName}
              {s.member && <MemberBadge />}
            </h1>
            <p className="truncate text-sm text-muted">{t("owners.ownedBy", { name: s.name })}</p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            [t("owners.horsesShort"), String(s.horses.length)],
            [t("home.reputation"), fmt(s.reputation)],
            [t("owners.wins"), `${s.record.wins}/${s.record.starts}`],
            [t("horse.earnedLabel"), fmt(s.record.earnings)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg/40 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
              <dd className="num font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        {s.isMe && <p className="mt-3 text-xs text-muted">{t("owners.thisIsYou")}</p>}
      </Card>
      <SectionTitle>{t("horses.string")}</SectionTitle>
      {s.horses.length === 0 && <EmptyState title={t("owners.noHorses")} body={t("owners.noHorsesBody")} />}
      <div className="space-y-2">
        {s.horses.map((h) => (
          <StableHorse key={h.id} h={h} />
        ))}
      </div>
    </div>
  );
}

/** One horse: name, rating, record and the attributes; an offer form on request. */
function StableHorse({ h }: { h: PublicStableHorseDto }) {
  const [offering, setOffering] = useState(false);
  return (
    <Card>
      <Link href={`/horse/?id=${h.id}`} className="flex items-center gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-gold/60 font-display text-lg font-bold"
          style={{ background: coatColor(h.coat) }}
          aria-hidden
        >
          {h.name.charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold hover:text-gold">{h.name}</span>
          <span className="block truncate text-xs text-muted">
            {t("horse.ageLine", { age: h.age.toFixed(1), sex: titleCase(h.sex) })} ·{" "}
            {t("owners.record", { s: h.record.starts, w: h.record.wins })}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="num block font-display text-lg font-bold text-gold">{h.raceRating}</span>
          <span className="block text-[10px] uppercase tracking-wider text-muted">{t("horse.mark")}</span>
        </span>
      </Link>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="gold">{titleCase(h.rarity)}</Badge>
        <Badge>{t("owners.strength", { n: Math.round(h.abilityRating) })}</Badge>
        {h.status !== "IDLE" && <Badge tone="warn">{t(`hstatus.${h.status}` as MessageKey)}</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-x-2 gap-y-1.5 text-xs" aria-label={t("horse.attributes")}>
        {Object.entries(ATTRIBUTE_LABELS).map(([k, label]) => (
          <div key={k} className="min-w-0">
            <dt className="truncate text-muted">{label}</dt>
            <dd className="num font-semibold">{Math.round(h.attributes[k as keyof typeof h.attributes])}</dd>
          </div>
        ))}
      </dl>
      {h.offerBand && (
        <>
          <button
            onClick={() => setOffering((v) => !v)}
            aria-expanded={offering}
            className="mt-3 flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface-2 text-sm font-medium transition-colors hover:border-gold"
          >
            <HandCoins className="size-4" aria-hidden />
            {t("owners.offer")}
          </button>
          {offering && <MakeOffer h={h} bare onSent={() => setOffering(false)} />}
        </>
      )}
    </Card>
  );
}
