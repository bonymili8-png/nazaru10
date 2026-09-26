"use client";
import { type HorseSummaryDto, type RaceDetailDto, STRATEGIES, type Strategy } from "@thoroughline/contracts";
import { trackByCode } from "@thoroughline/engine";
import { Share2, ShieldCheck, Trophy } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LiveRace } from "@/components/LiveRace";
import { Silk } from "@/components/Silk";
import { WEATHER_ICON } from "@/components/RaceCard";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { del, post } from "@/lib/api";
import { CLASS_NAMES, countdown, errorMessage, fmt, STRATEGY_INFO, titleCase } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { appLink, haptic, shareToTelegram } from "@/lib/telegram";

export default function RacePageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <RacePage />
    </Suspense>
  );
}

function RacePage() {
  const id = useSearchParams().get("id");
  const {
    data: race,
    error,
    reload,
  } = useApi<RaceDetailDto>(id ? `/races/${id}` : null, { refreshMs: 5000 });
  const now = useNow(1000);
  if (!id) return <ErrorState error={new Error("No race selected")} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!race) return <Skeleton className="h-64" />;
  const track = trackByCode(race.trackCode);
  const W = WEATHER_ICON[race.weather];
  const mine = race.entryList.filter((e) => e.mine);

  return (
    <div>
      <Card className="bg-gradient-to-br from-surface to-surface-2">
        <div className="flex items-center gap-2">
          <Badge tone="gold">{CLASS_NAMES[race.class]}</Badge>
          <Badge tone={race.status === "RUNNING" ? "bad" : race.status === "OPEN" ? "good" : "neutral"}>
            {race.status === "RUNNING" ? "● Live" : titleCase(race.status)}
          </Badge>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold">{race.name}</h1>
        {race.tournamentId && (
          <a
            href={`/tournament/?id=${race.tournamentId}`}
            className="mt-1 inline-flex items-center gap-1 text-sm text-gold hover:underline"
          >
            <Trophy className="size-4" aria-hidden /> Tournament bracket
          </a>
        )}
        <p className="text-sm text-muted">
          {track.archetype} · {race.distance}m {titleCase(race.surface)} ·{" "}
          <W className="inline size-4 align-[-3px]" aria-hidden /> {titleCase(race.weather)},{" "}
          {titleCase(race.going)}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Info k="Purse" v={fmt(race.purse)} />
          <Info k="Entry" v={fmt(race.entryFee)} />
          <Info
            k={race.status === "OPEN" ? "Closes" : "Off"}
            v={
              race.status === "OPEN"
                ? countdown(race.locksAt, now)
                : race.status === "LOCKED"
                  ? countdown(race.startsAt, now)
                  : new Date(race.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          />
        </dl>
        {!race.tournamentId && race.eligibility.maidenOnly && (
          <p className="mt-2 text-xs text-muted">For horses that have never won.</p>
        )}
        {!race.tournamentId && (race.eligibility.minRating || race.eligibility.maxRating) && (
          <p className="mt-2 text-xs text-muted">
            Rating band {race.eligibility.minRating ?? "any"}–{race.eligibility.maxRating ?? "any"}.
          </p>
        )}
      </Card>

      {race.status === "OPEN" && !race.tournamentId && <EntryForm race={race} />}
      {(race.status === "RUNNING" || race.status === "COMPLETED") && <LiveRace race={race} />}

      {race.status !== "COMPLETED" && (
        <>
          <SectionTitle>Runners ({race.entryList.length})</SectionTitle>
          <Card className="divide-y divide-line/40 p-0">
            {race.entryList.length === 0 && (
              <p className="p-4 text-sm text-muted">
                No runners yet — house horses fill the field when entries close.
              </p>
            )}
            {race.entryList.map((e) => (
              <div
                key={e.horseId}
                className={`flex items-center gap-3 px-4 py-2.5 ${e.mine ? "bg-gold/10" : ""}`}
              >
                <span className="num w-6 text-center text-sm text-muted">{e.gate ?? "–"}</span>
                {e.silks ? (
                  <Silk silks={e.silks} size={24} title={`${e.ownerName ?? "Owner"}'s silks`} />
                ) : (
                  <span className="size-6" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.horseName}</p>
                  <p className="truncate text-xs text-muted">
                    {e.isHouse ? "House" : e.ownerName}
                    {e.jockeyName ? ` · ${e.jockeyName}` : ""}
                    {e.strategy ? ` · ${STRATEGY_INFO[e.strategy]!.label}` : ""}
                  </p>
                </div>
                <span className="num text-sm text-gold">{Math.round(e.abilityRating)}</span>
                {e.mine && race.status === "OPEN" && !race.tournamentId && (
                  <Withdraw raceId={race.id} horseId={e.horseId} />
                )}
              </div>
            ))}
          </Card>
        </>
      )}

      {race.status === "COMPLETED" && mine.length > 0 && (
        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => {
            const best = mine.reduce((a, b) => ((a.position ?? 99) <= (b.position ?? 99) ? a : b));
            const link = appLink(`race_${race.id}`) ?? window.location.href;
            shareToTelegram(
              `${best.horseName} finished ${best.position === 1 ? "FIRST" : `#${best.position}`} in the ${race.name}! 🏇`,
              link,
            );
          }}
        >
          <Share2 className="size-4" aria-hidden />
          Share result
        </Button>
      )}

      <Card className="mt-4 text-xs text-muted">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <ShieldCheck className="size-4 text-good" aria-hidden />
          Provably fair
        </p>
        <p className="mt-1 break-all">
          Commitment: <span className="num">{race.seedHash}</span>
        </p>
        {race.seed && (
          <p className="mt-1 break-all">
            Revealed seed: <span className="num">{race.seed}</span>
          </p>
        )}
        <p className="mt-1">
          The result is simulated from a secret seed committed before the race and revealed afterwards.
        </p>
      </Card>
    </div>
  );
}

const Info = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-xl bg-bg/40 py-2">
    <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
    <dd className="num font-semibold">{v}</dd>
  </div>
);

function Withdraw({ raceId, horseId }: { raceId: string; horseId: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      className="min-h-9 px-2 text-xs"
      loading={busy}
      onClick={async () => {
        if (!window.confirm("Withdraw this horse? The entry fee is refunded.")) return;
        setBusy(true);
        try {
          await del(`/races/${raceId}/entries/${horseId}`);
          toast("Withdrawn — fee refunded");
          invalidate(`/races/${raceId}`, "/wallet", "/horses", "/home");
        } catch (e) {
          toast(errorMessage(e), "bad");
        } finally {
          setBusy(false);
        }
      }}
    >
      Withdraw
    </Button>
  );
}

function EntryForm({ race }: { race: RaceDetailDto }) {
  const horses = useApi<HorseSummaryDto[]>("/horses");
  const [horseId, setHorseId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("MID_PACK");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const available = (horses.data ?? []).filter(
    (h) => h.status === "IDLE" && (!race.eligibility.maidenOnly || h.record.wins === 0),
  );
  const selected = horseId ?? available[0]?.id ?? null;

  const enter = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await post(`/races/${race.id}/entries`, { horseId: selected, strategy });
      haptic.success();
      toast("Entered! Good luck.");
      invalidate(`/races/${race.id}`, "/wallet", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Enter a horse</SectionTitle>
      <Card>
        {available.length === 0 ? (
          <p className="text-sm text-muted">
            No eligible horse is free right now. Horses in training, entered elsewhere or injured can't run.
          </p>
        ) : (
          <>
            <label className="text-sm text-muted" htmlFor="horse">
              Horse
            </label>
            <select
              id="horse"
              value={selected ?? ""}
              onChange={(e) => setHorseId(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
            >
              {available.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} — rating {Math.round(h.abilityRating)}
                </option>
              ))}
            </select>
            <p className="mt-4 text-sm text-muted" id="tactics">
              Tactics
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="tactics">
              {STRATEGIES.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={strategy === s}
                  onClick={() => setStrategy(s)}
                  className={`cursor-pointer rounded-xl border p-2.5 text-left transition-colors ${strategy === s ? "border-gold bg-gold/10" : "border-line/60 bg-surface-2"}`}
                >
                  <p className="text-sm font-semibold">{STRATEGY_INFO[s]!.label}</p>
                  <p className="text-xs leading-snug text-muted">{STRATEGY_INFO[s]!.hint}</p>
                </button>
              ))}
            </div>
            <Button className="mt-4 w-full" onClick={enter} loading={busy}>
              Enter · {fmt(race.entryFee)} cr
            </Button>
          </>
        )}
      </Card>
    </>
  );
}
