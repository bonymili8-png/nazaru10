"use client";
import type { BreedingEventDto, BreedingPreviewDto, HorseSummaryDto, StudDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { Baby, Dna, HeartHandshake } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, SectionTitle, Skeleton, Stars, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, fmt, titleCase } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { haptic } from "@/lib/telegram";

export default function BreedingWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <BreedingPage />
    </Suspense>
  );
}

const MIN_AGE = defaultConfig.breeding.minBreedingAge;
const isMare = (h: HorseSummaryDto) => (h.sex === "MARE" || h.sex === "FILLY") && h.age >= MIN_AGE;
const isSire = (h: HorseSummaryDto) => (h.sex === "STALLION" || h.sex === "COLT") && h.age >= MIN_AGE;

function BreedingPage() {
  const params = useSearchParams();
  const horses = useApi<HorseSummaryDto[]>("/horses");
  const studs = useApi<StudDto[]>("/breeding/studs");
  const events = useApi<BreedingEventDto[]>("/breeding/mine", { refreshMs: 20_000 });
  const [damId, setDamId] = useState<string | null>(params.get("dam"));
  const [sireId, setSireId] = useState<string | null>(params.get("sire"));
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);

  const mares = (horses.data ?? []).filter(isMare);
  const ownSires = (horses.data ?? []).filter(isSire);
  const outsideStuds = (studs.data ?? []).filter((s) => !s.mine);
  const dam = damId ?? mares[0]?.id ?? null;
  const sire = sireId ?? ownSires[0]?.id ?? outsideStuds[0]?.horse.id ?? null;
  const preview = useApi<BreedingPreviewDto>(
    dam && sire ? `/breeding/preview?sireId=${sire}&damId=${dam}` : null,
  );
  const pending = useMemo(() => (events.data ?? []).filter((e) => e.status === "PENDING"), [events.data]);
  const delivered = useMemo(
    () => (events.data ?? []).filter((e) => e.status === "DELIVERED").slice(0, 10),
    [events.data],
  );

  const cover = async () => {
    if (!dam || !sire || !preview.data) return;
    if (
      !window.confirm(
        `Cover for ${fmt(preview.data.cost.total)} credits? The foal arrives in ${preview.data.gestationHours}h.`,
      )
    )
      return;
    setBusy(true);
    try {
      await post("/breeding", { sireId: sire, damId: dam });
      haptic.success();
      toast("Covered — the foal is on its way");
      invalidate("/breeding", "/horses", "/wallet", "/home");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Breeding</h1>
      <p className="mt-1 text-sm text-muted">
        Pair a mare with a stallion from your stable or one standing at stud. Foals inherit their parents'
        genetics — with a little luck.
      </p>

      {pending.length > 0 && (
        <>
          <SectionTitle>In foal</SectionTitle>
          <div className="space-y-2">
            {pending.map((e) => (
              <Card key={e.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {e.dam.name} × {e.sire.name}
                  </p>
                  <p className="text-xs text-muted">
                    {e.inbreeding > 0 ? `Inbreeding ${(e.inbreeding * 100).toFixed(1)}%` : "Outcross"}
                  </p>
                </div>
                <Badge tone="gold">
                  <Baby className="size-3" aria-hidden />
                  {countdown(e.dueAt, now)}
                </Badge>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Plan a mating</SectionTitle>
      {!horses.data ? (
        <Skeleton className="h-40" />
      ) : mares.length === 0 ? (
        <EmptyState
          title="No mares of breeding age"
          body={`Mares and fillies can be bred from age ${MIN_AGE}. Find one on the market.`}
          action={
            <Link href="/shop/" className="text-gold underline">
              Go to market
            </Link>
          }
        />
      ) : (
        <Card>
          <label htmlFor="dam" className="text-sm text-muted">
            Mare
          </label>
          <select
            id="dam"
            value={dam ?? ""}
            onChange={(e) => setDamId(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
          >
            {mares.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} — {titleCase(h.status)}
              </option>
            ))}
          </select>
          <label htmlFor="sire" className="mt-3 block text-sm text-muted">
            Stallion
          </label>
          <select
            id="sire"
            value={sire ?? ""}
            onChange={(e) => setSireId(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
          >
            {ownSires.length > 0 && (
              <optgroup label="Your stallions">
                {ownSires.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} — rating {Math.round(h.abilityRating)}
                  </option>
                ))}
              </optgroup>
            )}
            {outsideStuds.length > 0 && (
              <optgroup label="Standing at stud">
                {outsideStuds.map((s) => (
                  <option key={s.horse.id} value={s.horse.id}>
                    {s.horse.name} — fee {fmt(s.fee)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {preview.data && (
            <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Expected potential</span>
                <Stars n={preview.data.expectedStars} />
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted">Inbreeding</span>
                <span className={preview.data.inbreeding > 0.06 ? "text-warn" : ""}>
                  {(preview.data.inbreeding * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted">Breeding fee</span>
                <span className="num">{fmt(preview.data.cost.breedingFee)}</span>
              </div>
              {preview.data.cost.studFee > 0 && (
                <div className="mt-1 flex justify-between">
                  <span className="text-muted">Stud fee</span>
                  <span className="num">{fmt(preview.data.cost.studFee)}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between font-semibold">
                <span>Total</span>
                <span className="num text-gold">{fmt(preview.data.cost.total)} cr</span>
              </div>
              {preview.data.reasons.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-warn" role="status">
                  {preview.data.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {preview.data.inbreeding > 0.06 && (
                <p className="mt-2 text-xs text-warn">
                  Close relatives: expect lower potential and a higher injury risk.
                </p>
              )}
            </div>
          )}
          <Button className="mt-4 w-full" loading={busy} disabled={!preview.data?.eligible} onClick={cover}>
            <HeartHandshake className="size-4" aria-hidden />
            Cover
          </Button>
        </Card>
      )}

      <SectionTitle>Standing at stud</SectionTitle>
      {!studs.data && <Skeleton className="h-24" />}
      {studs.data?.length === 0 && (
        <p className="text-sm text-muted">
          No stallions are standing at stud yet. Offer yours from its horse page.
        </p>
      )}
      <div className="space-y-2">
        {studs.data?.map((s) => (
          <Card key={s.horse.id} className="flex items-center gap-3">
            <Dna className="size-5 shrink-0 text-gold" aria-hidden />
            <div className="min-w-0 flex-1">
              <Link href={`/horse/?id=${s.horse.id}`} className="block truncate font-medium hover:text-gold">
                {s.horse.name}
              </Link>
              <p className="text-xs text-muted">
                {s.mine ? "Your stallion" : s.ownerName} · {s.horse.record.wins}/{s.horse.record.starts} wins
                · {s.coversThisWeek}/{s.coversPerWeek} covers this week
              </p>
              <Stars n={s.horse.potentialStars} />
            </div>
            <div className="text-right">
              <p className="num font-semibold text-gold">{fmt(s.fee)}</p>
              {!s.mine && (
                <button
                  className="min-h-9 cursor-pointer text-xs text-gold underline"
                  onClick={() => setSireId(s.horse.id)}
                >
                  Select
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {delivered.length > 0 && (
        <>
          <SectionTitle>Recent foals</SectionTitle>
          <Card className="divide-y divide-line/40 p-0">
            {delivered.map((e) => (
              <Link
                key={e.id}
                href={`/horse/?id=${e.foal!.id}`}
                className="flex justify-between px-4 py-2.5 text-sm hover:bg-surface-2"
              >
                <span className="font-medium">{e.foal!.name}</span>
                <span className="text-muted">
                  {e.sire.name} × {e.dam.name}
                </span>
              </Link>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
