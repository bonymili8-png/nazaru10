"use client";
import type { FacilityDto, HorseSummaryDto, StableDto } from "@thoroughline/contracts";
import { Dumbbell, Stethoscope } from "lucide-react";
import { HorseCard } from "@/components/HorseCard";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  SectionTitle,
  Skeleton,
  useToast,
} from "@/components/ui";
import { post } from "@/lib/api";
import { errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { haptic } from "@/lib/telegram";
import { useState } from "react";
import { t } from "@/lib/i18n";

export default function HorsesPage() {
  const horses = useApi<HorseSummaryDto[]>("/horses", { refreshMs: 15_000 });
  const stable = useApi<StableDto>("/stable");
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const upgrade = async () => {
    setBusy(true);
    try {
      await post("/stable/upgrade");
      haptic.success();
      toast(t("horses.upgraded"));
      invalidate("/stable", "/wallet", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between">
        <h1 className="font-display text-3xl font-bold">{t("horses.title")}</h1>
        <div className="flex gap-2">
          <LinkButton href="/staff/" variant="secondary" className="min-h-10 text-sm">
            {t("horses.staff")}
          </LinkButton>
          <LinkButton href="/breeding/" variant="secondary" className="min-h-10 text-sm">
            {t("horses.breeding")}
          </LinkButton>
        </div>
      </div>
      {stable.data && (
        <Card className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{t("horses.stableLevel", { n: stable.data.level })}</p>
            <p className="num font-semibold">
              {t("horses.boxes", { used: stable.data.horseCount, cap: stable.data.capacity })}
            </p>
          </div>
          {stable.data.nextUpgradeCost !== null && (
            <Button variant="secondary" onClick={upgrade} loading={busy} className="text-sm">
              {t("horses.upgrade", { cost: fmt(stable.data.nextUpgradeCost) })}
            </Button>
          )}
        </Card>
      )}
      {stable.data && <Facilities stable={stable.data} />}
      <SectionTitle>{t("horses.string")}</SectionTitle>
      {horses.error && <ErrorState error={horses.error} retry={horses.reload} />}
      {!horses.data && !horses.error && <Skeleton className="h-40" />}
      {horses.data?.length === 0 && (
        <EmptyState
          title={t("horses.emptyTitle")}
          body={t("horses.emptyBody")}
          action={<LinkButton href="/shop/">{t("horses.salesRing")}</LinkButton>}
        />
      )}
      <div className="space-y-2">
        {horses.data?.map((h) => (
          <HorseCard key={h.id} horse={h} href={`/horse/?id=${h.id}`} />
        ))}
      </div>
    </div>
  );
}

const FACILITY_ICON: Record<FacilityDto["type"], typeof Dumbbell> = {
  TRAINING_TRACK: Dumbbell,
  VET_CLINIC: Stethoscope,
};
const facilityInfo = (type: FacilityDto["type"]) => ({
  label: t(`facility.${type}`),
  effect: t(`facility.${type}.effect`),
  icon: FACILITY_ICON[type],
});

function Facilities({ stable }: { stable: StableDto }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const build = async (f: FacilityDto) => {
    setBusy(f.type);
    try {
      await post(`/stable/facilities/${f.type}`);
      haptic.success();
      toast(t("facility.built", { name: facilityInfo(f.type).label, n: f.level + 1 }));
      invalidate("/stable", "/wallet", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <SectionTitle>{t("facility.title")}</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {stable.facilities.map((f) => {
          const info = facilityInfo(f.type);
          const Icon = info.icon;
          const locked = f.requiresStableLevel !== null && stable.level < f.requiresStableLevel;
          return (
            <Card key={f.type} className="flex flex-col">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-gold" aria-hidden />
                <p className="text-sm font-semibold">{info.label}</p>
              </div>
              <p className="num mt-1 text-xs text-muted">
                {t("facility.level", { n: f.level, max: f.maxLevel })}
                {f.level > 0 &&
                  ` · ${f.gainPct ? t("facility.gains", { n: f.gainPct }) : t("facility.injuries", { n: f.injuryReductionPct })}`}
              </p>
              <p className="mt-1 flex-1 text-xs text-muted">{info.effect}</p>
              {f.nextCost === null ? (
                <p className="mt-2 text-xs font-medium text-good">{t("facility.full")}</p>
              ) : locked ? (
                <p className="mt-2 text-xs text-muted">
                  {t("facility.needs", { n: f.requiresStableLevel ?? 0 })}
                </p>
              ) : (
                <Button
                  variant="secondary"
                  className="mt-2 min-h-10 text-xs"
                  loading={busy === f.type}
                  onClick={() => build(f)}
                >
                  {t("facility.build", { cost: fmt(f.nextCost) })}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
