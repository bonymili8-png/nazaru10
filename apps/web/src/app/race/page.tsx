"use client";
import {
  type GearItem,
  type HorseSummaryDto,
  type RaceDetailDto,
  type StableDto,
  STRATEGIES,
  type UserDto,
  type Strategy,
} from "@thoroughline/contracts";
import { canRaceAtAge, defaultConfig, trackByCode } from "@thoroughline/engine";
import { Share2, ShieldCheck, Trophy } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LiveRace } from "@/components/LiveRace";
import { RaceReport } from "@/components/RaceReport";
import { Silk } from "@/components/Silk";
import { WEATHER_ICON } from "@/components/RaceCard";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { del, post } from "@/lib/api";
import {
  bandText,
  CLASS_NAMES,
  countdown,
  errorMessage,
  fmt,
  gearMods,
  STRATEGY_INFO,
  titleCase,
  trackName,
} from "@/lib/format";
import { getLocale, type MessageKey, t } from "@/lib/i18n";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { haptic, sharedLink, shareToTelegram } from "@/lib/telegram";

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
  const me = useApi<UserDto>("/me");
  const now = useNow(1000);
  if (!id) return <ErrorState error={new Error(t("race.noneSelected"))} />;
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
            {race.status === "RUNNING" ? t("race.live") : titleCase(race.status)}
          </Badge>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold">{race.name}</h1>
        {race.tournamentId && (
          <a
            href={`/tournament/?id=${race.tournamentId}`}
            className="mt-1 inline-flex items-center gap-1 text-sm text-gold hover:underline"
          >
            <Trophy className="size-4" aria-hidden /> {t("race.bracket")}
          </a>
        )}
        <p className="text-sm text-muted">
          {trackName(track.archetype)} · {t("unit.m", { n: race.distance })} {titleCase(race.surface)} ·{" "}
          <W className="inline size-4 align-[-3px]" aria-hidden /> {titleCase(race.weather)},{" "}
          {titleCase(race.going)}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Info k={t("common.purse")} v={fmt(race.purse)} />
          <Info k={t("common.entry")} v={fmt(race.entryFee)} />
          <Info
            k={race.status === "OPEN" ? t("race.closes") : t("race.off")}
            v={
              race.status === "OPEN"
                ? countdown(race.locksAt, now)
                : race.status === "LOCKED"
                  ? countdown(race.startsAt, now)
                  : new Date(race.startsAt).toLocaleTimeString(getLocale() === "uk" ? "uk-UA" : [], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
            }
          />
        </dl>
        {!race.tournamentId && race.eligibility.maidenOnly && (
          <p className="mt-2 text-xs text-muted">{t("race.maidenOnly")}</p>
        )}
        {!race.tournamentId && (race.eligibility.minRating || race.eligibility.maxRating) && (
          <p className="mt-2 text-xs text-muted">
            {t("race.band", { band: bandText(race.eligibility.minRating, race.eligibility.maxRating) })}
          </p>
        )}
      </Card>

      {(race.status === "RUNNING" || race.status === "COMPLETED") && <LiveRace race={race} />}
      {race.status === "COMPLETED" &&
        race.entryList
          .filter((e) => e.mine && e.position !== null)
          .map((e) => (
            <RaceReport key={e.horseId} raceId={race.id} horseId={e.horseId} distance={race.distance} />
          ))}

      {race.status !== "COMPLETED" && (
        <>
          <SectionTitle>{t("race.runnersTitle", { n: race.entryList.length })}</SectionTitle>
          <Card className="divide-y divide-line/40 p-0">
            {race.entryList.length === 0 && <p className="p-4 text-sm text-muted">{t("race.noRunners")}</p>}
            {race.entryList.map((e) => (
              <div
                key={e.horseId}
                className={`flex items-center gap-3 px-4 py-2.5 ${e.mine ? "bg-gold/10" : ""}`}
              >
                <span className="num w-6 text-center text-sm text-muted">{e.gate ?? "–"}</span>
                {e.silks ? (
                  <Silk
                    silks={e.silks}
                    size={24}
                    title={t("race.ownersSilks", { name: e.ownerName ?? t("common.owner") })}
                  />
                ) : (
                  <span className="size-6" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.horseName}</p>
                  <p className="truncate text-xs text-muted">
                    {e.isHouse ? t("common.house") : e.ownerName}
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

      {race.status === "OPEN" && !race.tournamentId && <EntryForm race={race} />}

      {race.status === "COMPLETED" && mine.length > 0 && (
        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => {
            const best = mine.reduce((a, b) => ((a.position ?? 99) <= (b.position ?? 99) ? a : b));
            const link = sharedLink("race", race.id, me.data?.referralCode);
            shareToTelegram(
              t(best.position === 1 ? "race.shareFirst" : "race.sharePlace", {
                horse: best.horseName,
                n: best.position ?? "",
                race: race.name,
              }),
              link,
            );
          }}
        >
          <Share2 className="size-4" aria-hidden />
          {t("race.share")}
        </Button>
      )}

      <Card className="mt-4 text-xs text-muted">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <ShieldCheck className="size-4 text-good" aria-hidden />
          {t("race.fair")}
        </p>
        <p className="mt-1 break-all">
          {t("race.commitment")} <span className="num">{race.seedHash}</span>
        </p>
        {race.seed && (
          <p className="mt-1 break-all">
            {t("race.seed")} <span className="num">{race.seed}</span>
          </p>
        )}
        <p className="mt-1">{t("race.fairText")}</p>
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
        if (!window.confirm(t("race.confirmWithdraw"))) return;
        setBusy(true);
        try {
          await del(`/races/${raceId}/entries/${horseId}`);
          toast(t("race.withdrawn"));
          invalidate(`/races/${raceId}`, "/wallet", "/horses", "/home");
        } catch (e) {
          toast(errorMessage(e), "bad");
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("common.withdraw")}
    </Button>
  );
}

function EntryForm({ race }: { race: RaceDetailDto }) {
  const horses = useApi<HorseSummaryDto[]>("/horses");
  const [horseId, setHorseId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("MID_PACK");
  const [gear, setGear] = useState<GearItem | null>(null);
  const stable = useApi<StableDto>("/stable");
  const ownedGear = (stable.data?.gear ?? []).filter((g) => g.owned);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const checked = (horses.data ?? [])
    .filter((h) => h.status !== "RETIRED")
    .map((h) => ({ horse: h, why: ineligibility(h, race) }));
  const available = checked.filter((c) => c.why === null).map((c) => c.horse);
  const unfit = checked.filter((c) => c.why !== null);
  const selected = horseId ?? available[0]?.id ?? null;

  const enter = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await post(`/races/${race.id}/entries`, { horseId: selected, strategy, gear });
      haptic.success();
      toast(t("race.entered"));
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
      <SectionTitle>{t("race.enterHorse")}</SectionTitle>
      <Card>
        {horses.data && checked.length === 0 ? (
          <p className="text-sm text-muted">{t("race.noHorses")}</p>
        ) : available.length === 0 ? (
          <>
            <p className="text-sm text-muted">{horses.data ? t("race.noneFit") : t("race.noEligible")}</p>
            <UnfitList unfit={unfit} />
            {unfit.length > 0 && (
              <Link href="/races/" className="mt-3 inline-block text-sm font-semibold text-gold">
                {t("race.findOther")} →
              </Link>
            )}
          </>
        ) : (
          <>
            <label className="text-sm text-muted" htmlFor="horse">
              {t("race.horse")}
            </label>
            <select
              id="horse"
              value={selected ?? ""}
              onChange={(e) => setHorseId(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
            >
              {available.map((h) => (
                <option key={h.id} value={h.id}>
                  {t("race.horseOption", { name: h.name, s: Math.round(h.abilityRating), r: h.raceRating })}
                </option>
              ))}
            </select>
            <p className="mt-4 text-sm text-muted" id="tactics">
              {t("race.tactics")}
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
            <p className="mt-4 text-sm text-muted" id="gear">
              {t("race.gear")}
            </p>
            {ownedGear.length === 0 ? (
              <Link href="/horses/" className="mt-1 inline-block text-sm text-gold underline">
                {t("race.gearShop")}
              </Link>
            ) : (
              <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="gear">
                {[null, ...ownedGear.map((g) => g.item)].map((item) => {
                  const g = ownedGear.find((x) => x.item === item);
                  return (
                    <button
                      key={item ?? "none"}
                      role="radio"
                      aria-checked={gear === item}
                      onClick={() => setGear(item)}
                      className={`cursor-pointer rounded-xl border p-2.5 text-left transition-colors ${gear === item ? "border-gold bg-gold/10" : "border-line/60 bg-surface-2"}`}
                    >
                      <p className="text-sm font-semibold">
                        {item ? t(`gear.${item}` as MessageKey) : t("race.noGear")}
                      </p>
                      {g && <p className="num text-xs leading-snug text-muted">{gearMods(g.mods)}</p>}
                    </button>
                  );
                })}
              </div>
            )}
            <Button className="mt-4 w-full" onClick={enter} loading={busy}>
              {t("race.enterFee", { fee: fmt(race.entryFee) })}
            </Button>
            {unfit.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">{t("race.someUnfit")}</summary>
                <UnfitList unfit={unfit} />
              </details>
            )}
          </>
        )}
      </Card>
    </>
  );
}

/** Why a horse can't enter this race (mirrors the server's checks), or null when it can. */
function ineligibility(h: HorseSummaryDto, race: RaceDetailDto): string | null {
  if (h.status !== "IDLE") return t("race.whyBusy", { status: t(`hstatus.${h.status}` as MessageKey) });
  if (!canRaceAtAge(h.age, defaultConfig))
    return h.age < defaultConfig.lifecycle.minRacingAge ? t("race.whyYoung") : t("race.whyOld");
  const { maidenOnly, minRating, maxRating } = race.eligibility;
  if (maidenOnly && h.record.wins > 0) return t("race.whyNotMaiden", { n: h.record.wins });
  const r = Math.round(h.raceRating);
  if (minRating !== null && h.raceRating < minRating) return t("race.whyLow", { r, min: minRating });
  if (maxRating !== null && h.raceRating > maxRating) return t("race.whyHigh", { r, max: maxRating });
  return null;
}

function UnfitList({ unfit }: { unfit: { horse: HorseSummaryDto; why: string | null }[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {unfit.map(({ horse, why }) => (
        <li key={horse.id} className="text-sm">
          <span className="font-semibold">{horse.name}</span>
          <span className="text-muted"> — {why}</span>
        </li>
      ))}
    </ul>
  );
}
