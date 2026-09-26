"use client";
import type { BreedingEventDto, BreedingPreviewDto, HorseSummaryDto, StudDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { Baby, Dna, HeartHandshake } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, SectionTitle, Skeleton, Stars, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, fmt, titleCase } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

/** Eligibility reasons come from the server in English; translate the known shapes. */
const REASONS: [RegExp, MessageKey][] = [
  [/^A horse cannot be bred with itself$/, "breed.r.self"],
  [/^You can only breed your own mare$/, "breed.r.ownMare"],
  [/^This stallion is not standing at stud$/, "breed.r.notAtStud"],
  [/^(?<name>.+) is not a stallion$/, "breed.r.notStallion"],
  [/^(?<name>.+) is not a mare$/, "breed.r.notMare"],
  [/^(?<name>.+) is too young \(minimum age (?<n>\d+)\)$/, "breed.r.young"],
  [/^(?<name>.+) is resting after her last foal$/, "breed.r.resting"],
  [/^(?<name>.+) has no covers left this week$/, "breed.r.noCovers"],
  [/^No free box for the foal$/, "breed.r.noBox"],
  [/^(?<name>.+) is (?<status>in foal|[a-z_]+)$/, "breed.r.busy"],
];
const reasonText = (r: string) => {
  for (const [re, key] of REASONS) {
    const m = re.exec(r);
    if (!m) continue;
    const v = { ...m.groups };
    if (v.status) v.status = v.status === "in foal" ? t("breed.r.inFoal") : titleCase(v.status);
    return t(key, v);
  }
  return r;
};

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
        t("breed.confirm", { cost: fmt(preview.data.cost.total), h: preview.data.gestationHours }),
      )
    )
      return;
    setBusy(true);
    try {
      await post("/breeding", { sireId: sire, damId: dam });
      haptic.success();
      toast(t("breed.covered"));
      invalidate("/breeding", "/horses", "/wallet", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("breed.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("breed.intro")}</p>

      {pending.length > 0 && (
        <>
          <SectionTitle>{t("breed.inFoal")}</SectionTitle>
          <div className="space-y-2">
            {pending.map((e) => (
              <Card key={e.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {e.dam.name} × {e.sire.name}
                  </p>
                  <p className="text-xs text-muted">
                    {e.inbreeding > 0
                      ? t("breed.inbreedingPct", { p: (e.inbreeding * 100).toFixed(1) })
                      : t("breed.outcross")}
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

      <SectionTitle>{t("horse.planMating")}</SectionTitle>
      {!horses.data ? (
        <Skeleton className="h-40" />
      ) : mares.length === 0 ? (
        <EmptyState
          title={t("breed.noMares")}
          body={t("breed.noMaresBody", { n: MIN_AGE })}
          action={
            <Link href="/shop/" className="text-gold underline">
              {t("breed.goMarket")}
            </Link>
          }
        />
      ) : (
        <Card>
          <label htmlFor="dam" className="text-sm text-muted">
            {t("breed.mare")}
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
            {t("breed.stallion")}
          </label>
          <select
            id="sire"
            value={sire ?? ""}
            onChange={(e) => setSireId(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
          >
            {ownSires.length > 0 && (
              <optgroup label={t("breed.yourStallions")}>
                {ownSires.map((h) => (
                  <option key={h.id} value={h.id}>
                    {t("race.horseOption", { name: h.name, r: Math.round(h.abilityRating) })}
                  </option>
                ))}
              </optgroup>
            )}
            {outsideStuds.length > 0 && (
              <optgroup label={t("breed.atStud")}>
                {outsideStuds.map((s) => (
                  <option key={s.horse.id} value={s.horse.id}>
                    {t("breed.feeOption", { name: s.horse.name, fee: fmt(s.fee) })}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {preview.data && (
            <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">{t("breed.expected")}</span>
                <Stars n={preview.data.expectedStars} />
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted">{t("breed.inbreeding")}</span>
                <span className={preview.data.inbreeding > 0.06 ? "text-warn" : ""}>
                  {(preview.data.inbreeding * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted">{t("breed.breedingFee")}</span>
                <span className="num">{fmt(preview.data.cost.breedingFee)}</span>
              </div>
              {preview.data.cost.studFee > 0 && (
                <div className="mt-1 flex justify-between">
                  <span className="text-muted">{t("breed.studFee")}</span>
                  <span className="num">{fmt(preview.data.cost.studFee)}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between font-semibold">
                <span>{t("breed.total")}</span>
                <span className="num text-gold">
                  {fmt(preview.data.cost.total)} {t("common.cr")}
                </span>
              </div>
              {preview.data.reasons.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-warn" role="status">
                  {preview.data.reasons.map((r) => (
                    <li key={r}>{reasonText(r)}</li>
                  ))}
                </ul>
              )}
              {preview.data.inbreeding > 0.06 && (
                <p className="mt-2 text-xs text-warn">{t("breed.relatives")}</p>
              )}
            </div>
          )}
          <Button className="mt-4 w-full" loading={busy} disabled={!preview.data?.eligible} onClick={cover}>
            <HeartHandshake className="size-4" aria-hidden />
            {t("breed.cover")}
          </Button>
        </Card>
      )}

      <SectionTitle>{t("breed.atStud")}</SectionTitle>
      {!studs.data && <Skeleton className="h-24" />}
      {studs.data?.length === 0 && <p className="text-sm text-muted">{t("breed.noStuds")}</p>}
      <div className="space-y-2">
        {studs.data?.map((s) => (
          <Card key={s.horse.id} className="flex items-center gap-3">
            <Dna className="size-5 shrink-0 text-gold" aria-hidden />
            <div className="min-w-0 flex-1">
              <Link href={`/horse/?id=${s.horse.id}`} className="block truncate font-medium hover:text-gold">
                {s.horse.name}
              </Link>
              <p className="text-xs text-muted">
                {s.mine ? t("breed.yourStallion") : s.ownerName} ·{" "}
                {t("common.winsOf", { w: s.horse.record.wins, n: s.horse.record.starts })} ·{" "}
                {t("breed.covers", { n: s.coversThisWeek, max: s.coversPerWeek })}
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
                  {t("breed.select")}
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {delivered.length > 0 && (
        <>
          <SectionTitle>{t("breed.recentFoals")}</SectionTitle>
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
