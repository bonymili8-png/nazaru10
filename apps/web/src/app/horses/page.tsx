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
import { fmt } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { haptic } from "@/lib/telegram";
import { useState } from "react";

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
      toast("Stable upgraded — more boxes available");
      invalidate("/stable", "/wallet", "/home");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between">
        <h1 className="font-display text-3xl font-bold">Your horses</h1>
        <div className="flex gap-2">
          <LinkButton href="/staff/" variant="secondary" className="min-h-10 text-sm">
            Staff
          </LinkButton>
          <LinkButton href="/breeding/" variant="secondary" className="min-h-10 text-sm">
            Breeding
          </LinkButton>
        </div>
      </div>
      {stable.data && (
        <Card className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Stable level {stable.data.level}</p>
            <p className="num font-semibold">
              {stable.data.horseCount} / {stable.data.capacity} boxes used
            </p>
          </div>
          {stable.data.nextUpgradeCost !== null && (
            <Button variant="secondary" onClick={upgrade} loading={busy} className="text-sm">
              Upgrade · {fmt(stable.data.nextUpgradeCost)} cr
            </Button>
          )}
        </Card>
      )}
      {stable.data && <Facilities stable={stable.data} />}
      <SectionTitle>String</SectionTitle>
      {horses.error && <ErrorState error={horses.error} retry={horses.reload} />}
      {!horses.data && !horses.error && <Skeleton className="h-40" />}
      {horses.data?.length === 0 && (
        <EmptyState
          title="No horses yet"
          body="Visit the sales ring to buy your first prospect."
          action={<LinkButton href="/shop/">Sales ring</LinkButton>}
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

const FACILITY_INFO: Record<FacilityDto["type"], { label: string; icon: typeof Dumbbell; effect: string }> = {
  TRAINING_TRACK: { label: "Training track", icon: Dumbbell, effect: "+4% training gains per level" },
  VET_CLINIC: { label: "Vet clinic", icon: Stethoscope, effect: "−10% training injury risk per level" },
};

function Facilities({ stable }: { stable: StableDto }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const build = async (f: FacilityDto) => {
    setBusy(f.type);
    try {
      await post(`/stable/facilities/${f.type}`);
      haptic.success();
      toast(`${FACILITY_INFO[f.type].label} level ${f.level + 1} built`);
      invalidate("/stable", "/wallet", "/home");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <SectionTitle>Facilities</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {stable.facilities.map((f) => {
          const info = FACILITY_INFO[f.type];
          const Icon = info.icon;
          const locked = f.requiresStableLevel !== null && stable.level < f.requiresStableLevel;
          return (
            <Card key={f.type} className="flex flex-col">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-gold" aria-hidden />
                <p className="text-sm font-semibold">{info.label}</p>
              </div>
              <p className="num mt-1 text-xs text-muted">
                Level {f.level}/{f.maxLevel}
                {f.level > 0 &&
                  ` · ${f.gainPct ? `+${f.gainPct}% gains` : `−${f.injuryReductionPct}% injuries`}`}
              </p>
              <p className="mt-1 flex-1 text-xs text-muted">{info.effect}</p>
              {f.nextCost === null ? (
                <p className="mt-2 text-xs font-medium text-good">Fully built</p>
              ) : locked ? (
                <p className="mt-2 text-xs text-muted">Needs stable level {f.requiresStableLevel}</p>
              ) : (
                <Button
                  variant="secondary"
                  className="mt-2 min-h-10 text-xs"
                  loading={busy === f.type}
                  onClick={() => build(f)}
                >
                  Build · {fmt(f.nextCost)} cr
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
