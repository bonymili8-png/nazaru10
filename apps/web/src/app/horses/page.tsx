"use client";
import type { HorseSummaryDto, StableDto } from "@thoroughline/contracts";
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
