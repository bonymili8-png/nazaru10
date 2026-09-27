"use client";
import {
  type CosmeticsDto,
  type FeedPlan,
  type HorseAdviceDto,
  NAME_LIMITS,
  type StableDto,
  type HorseDetailDto,
  type SaddleCloth as Cloth,
  SILK_COLORS,
  type SilkColor,
  type PedigreeNodeDto,
  type StaffDto,
  type TrainingSessionDto,
  TRAINING_TYPES,
  type TrainingIntensity,
  type TrainingType,
  type UserDto,
} from "@thoroughline/contracts";
import {
  bestTrainerFor,
  canRaceAtAge,
  defaultConfig,
  eligibleClasses,
  trainingCost,
  trainingDurationMinutes,
} from "@thoroughline/engine";
import {
  Activity,
  Dna,
  Gem,
  HeartHandshake,
  HeartPulse,
  Lock,
  Microscope,
  Pencil,
  Share2,
  Star,
  Stethoscope,
  Tag,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ClassGuide } from "@/components/ClassGuide";
import { ColorPicker } from "@/components/ColorPicker";
import { RaceCard } from "@/components/RaceCard";
import { RenameForm } from "@/components/RenameForm";
import { coatColor } from "@/components/HorseCard";
import { SaddleCloth } from "@/components/SaddleCloth";
import { Syndicate } from "@/components/Syndicate";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Meter,
  SectionTitle,
  Skeleton,
  Stars,
  useToast,
} from "@/components/ui";
import { del, post, put } from "@/lib/api";
import {
  ATTRIBUTE_LABELS,
  CLASS_NAMES,
  countdown,
  errorMessage,
  fmt,
  ordinal,
  titleCase,
  TRAINING_INFO,
} from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { getLocale, type MessageKey, t } from "@/lib/i18n";
import { memberLocked } from "@/lib/member";
import { haptic, sharedLink, shareToTelegram } from "@/lib/telegram";

export default function HorsePageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <HorsePage />
    </Suspense>
  );
}

type Tab = "overview" | "train" | "history";

function HorsePage() {
  const id = useSearchParams().get("id");
  const {
    data: h,
    error,
    reload,
  } = useApi<HorseDetailDto>(id ? `/horses/${id}` : null, { refreshMs: 10_000 });
  const me = useApi<UserDto>("/me");
  const stable = useApi<StableDto>("/stable");
  const [tab, setTab] = useState<Tab>("overview");
  const [renaming, setRenaming] = useState(false);
  if (!id) return <ErrorState error={new Error(t("horse.noneSelected"))} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!h) return <Skeleton className="h-64" />;
  const mine = h.private !== null;

  return (
    <div>
      <Card className="bg-gradient-to-br from-surface to-surface-2">
        <div className="flex items-center gap-4">
          <div
            className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-gold font-display text-2xl font-bold"
            style={{ background: coatColor(h.coat) }}
            aria-hidden
          >
            {h.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h1 className="truncate font-display text-2xl font-bold">{h.name}</h1>
              {mine && (
                <button
                  onClick={() => setRenaming((v) => !v)}
                  aria-label={t("rename.horse")}
                  aria-expanded={renaming}
                  className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:text-gold"
                >
                  <Pencil className="size-5" aria-hidden />
                </button>
              )}
              {!mine && !h.isHouse && <FollowButton h={h} />}
              {!h.isHouse && (
                <button
                  onClick={() =>
                    shareToTelegram(
                      t(mine ? "horse.shareText" : "horse.shareOther", { name: h.name }),
                      sharedLink("horse", h.id, me.data?.referralCode),
                    )
                  }
                  aria-label={t("horse.share")}
                  className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:text-gold"
                >
                  <Share2 className="size-5" aria-hidden />
                </button>
              )}
            </div>
            <p className="text-sm text-muted">
              {t("horse.ageLine", { age: h.age.toFixed(1), sex: titleCase(h.sex) })} · {titleCase(h.coat)} ·{" "}
              {h.bloodline}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="gold">{titleCase(h.rarity)}</Badge>
              <Badge>{titleCase(h.stage)}</Badge>
              <Badge tone={h.status === "IDLE" ? "good" : h.status === "INJURED" ? "bad" : "warn"}>
                {t(`hstatus.${h.status}` as MessageKey)}
              </Badge>
            </div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            [t("common.strength"), Math.round(h.abilityRating)],
            [t("horse.mark"), h.raceRating],
            [t("horse.record"), `${h.record.wins}-${h.record.seconds}-${h.record.thirds}`],
            [t("horse.earnedLabel"), fmt(h.record.earnings)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg/40 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
              <dd className="num font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        {h.status !== "RETIRED" && <RaceClasses horse={h} />}
      </Card>
      {renaming && mine && stable.data && (
        <RenameForm
          title={t("rename.horse")}
          current={h.name}
          maxLength={NAME_LIMITS.horse}
          priceGems={stable.data.renameGems.horse}
          endpoint={`/horses/${h.id}/rename`}
          refresh={[`/horses/${h.id}`, "/horses", "/home"]}
          onClose={() => setRenaming(false)}
        />
      )}

      {mine && (
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-surface p-1" role="tablist">
          {(["overview", "train", "history"] as Tab[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium transition-colors ${tab === k ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
            >
              {t(`horse.tab.${k}`)}
            </button>
          ))}
        </div>
      )}

      {(!mine || tab === "overview") && <Overview h={h} />}
      {mine && tab === "train" && <Train h={h} />}
      {(!mine || tab === "history") && <History id={h.id} />}
      {(!mine || tab === "history") && <Pedigree id={h.id} />}
      {!h.isHouse && (!mine || tab === "overview") && <Syndicate horseId={h.id} horseName={h.name} />}
    </div>
  );
}

function Overview({ h }: { h: HorseDetailDto }) {
  const p = h.private;
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!p) return null;
  const act = async (what: "vet" | "diagnostics", msg: string) => {
    setBusy(what);
    try {
      await post(`/horses/${h.id}/${what}`);
      haptic.success();
      toast(msg);
      invalidate(`/horses/${h.id}`, "/wallet", "/home", "/horses");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const c = p.condition;
  const surfaces = Object.entries(p.aptitudes.surface).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <SectionTitle>{t("horse.condition")}</SectionTitle>
      <Card>
        <Meter
          label={t("horse.fatigue")}
          value={c.fatigue}
          tone={c.fatigue > 70 ? "bad" : c.fatigue > 40 ? "warn" : "good"}
        />
        <Meter label={t("horse.health")} value={c.health} tone={c.health < 60 ? "bad" : "good"} />
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-muted">{t("horse.form")}</span>
          <span className={c.form > 0.15 ? "text-good" : c.form < -0.15 ? "text-bad" : "text-ink"}>
            {c.form > 0.15 ? t("horse.inForm") : c.form < -0.15 ? t("horse.outOfForm") : t("horse.steady")}
          </span>
        </div>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <HeartPulse className="size-4" aria-hidden />
          {c.hoursToRaceReady > 0
            ? t("horse.readyIn", { h: c.hoursToRaceReady.toFixed(1) })
            : t("horse.fresh")}
        </p>
        {h.status === "INJURED" && (
          <Button
            variant="danger"
            className="mt-3 w-full"
            loading={busy === "vet"}
            onClick={() => act("vet", t("horse.vetDone"))}
          >
            <Stethoscope className="size-4" aria-hidden />
            {t("horse.callVet")}
          </Button>
        )}
      </Card>

      <AdviceCard h={h} />
      <FeedCard h={h} />

      <SectionTitle>{t("horse.attributes")}</SectionTitle>
      <Card>
        {Object.entries(ATTRIBUTE_LABELS).map(([k, label]) => (
          <Meter
            key={k}
            label={label}
            value={p.attributes[k as keyof typeof p.attributes]}
            ceiling={p.diagnostics?.ceilings[k as keyof typeof p.attributes]}
          />
        ))}
        <p className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted">{t("horse.potential")}</span>
          <Stars n={p.potentialStars} />
        </p>
        {!p.diagnostics && (
          <Button
            variant="secondary"
            className="mt-3 w-full text-sm"
            loading={busy === "diagnostics"}
            onClick={() => act("diagnostics", t("horse.diagDone"))}
          >
            <Microscope className="size-4" aria-hidden />
            {t("horse.diagnostics")}
          </Button>
        )}
        {p.diagnostics && <p className="mt-2 text-xs text-muted">{t("horse.ceilingHint")}</p>}
      </Card>

      <ClothEditor h={h} />
      <Sell h={h} />
      <Breeding h={h} />

      <SectionTitle>{t("horse.profile")}</SectionTitle>
      <Card className="space-y-2 text-sm">
        <Row k={t("horse.bestDistance")} v={`~${t("unit.m", { n: fmt(p.aptitudes.optimalDistance) })}`} />
        <Row k={t("horse.favSurface")} v={titleCase(surfaces[0]![0])} />
        <Row
          k={t("horse.wetGoing")}
          v={
            p.aptitudes.wet > 62
              ? t("horse.lovesIt")
              : p.aptitudes.wet < 38
                ? t("horse.dislikesIt")
                : t("horse.handlesIt")
          }
        />
        <Row
          k={t("horse.temperament")}
          v={
            p.traits.temperament > 60
              ? t("horse.calm")
              : p.traits.temperament < 40
                ? t("horse.hot")
                : t("horse.balanced")
          }
        />
        <Row
          k={t("horse.consistency")}
          v={
            p.traits.consistency > 60
              ? t("horse.reliable")
              : p.traits.consistency < 40
                ? t("horse.erratic")
                : t("horse.average")
          }
        />
        <Row
          k={t("horse.courage")}
          v={
            p.traits.courage > 60
              ? t("horse.battler")
              : p.traits.courage < 40
                ? t("horse.fragile")
                : t("horse.average")
          }
        />
      </Card>
    </>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between">
    <span className="text-muted">{k}</span>
    <span className="font-medium">{v}</span>
  </div>
);

function Train({ h }: { h: HorseDetailDto }) {
  const [type, setType] = useState<TrainingType>("SPEED");
  const [intensity, setIntensity] = useState<TrainingIntensity>("NORMAL");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const now = useNow(1000);
  const active = h.private?.activeTraining ?? null;
  const cost = trainingCost(type, intensity, defaultConfig);
  const minutes = trainingDurationMinutes(type, intensity, defaultConfig);
  const staff = useApi<StaffDto>("/staff");
  const coach = staff.data
    ? bestTrainerFor(
        staff.data.contracts.map((k) => k.trainer),
        type,
        defaultConfig,
      )
    : null;

  const start = async () => {
    setBusy(true);
    try {
      await post<TrainingSessionDto>(`/horses/${h.id}/training`, { type, intensity });
      haptic.success();
      toast(t("horse.trainingStarted", { name: TRAINING_INFO[type]!.label }));
      invalidate(`/horses/${h.id}`, "/wallet", "/home", "/horses");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  if (active) {
    return (
      <Card className="mt-4 text-center">
        <Activity className="mx-auto size-8 text-gold" aria-hidden />
        <p className="mt-2 font-display text-xl">{TRAINING_INFO[active.type]!.label}</p>
        <p className="text-sm text-muted">{t("horse.intensityOf", { i: titleCase(active.intensity) })}</p>
        <p className="num mt-3 text-3xl font-bold text-gold">{countdown(active.completesAt, now)}</p>
        <p className="text-xs text-muted">{t("horse.untilBack")}</p>
      </Card>
    );
  }

  return (
    <>
      <SectionTitle>{t("horse.session")}</SectionTitle>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("horse.trainingType")}>
        {TRAINING_TYPES.map((tt) => (
          <button
            key={tt}
            role="radio"
            aria-checked={type === tt}
            onClick={() => setType(tt)}
            className={`min-h-16 cursor-pointer rounded-xl border p-2.5 text-left transition-colors ${type === tt ? "border-gold bg-gold/10" : "border-line/60 bg-surface hover:border-line"}`}
          >
            <p className="text-sm font-semibold">{TRAINING_INFO[tt]!.label}</p>
            <p className="text-xs text-muted">{TRAINING_INFO[tt]!.focus}</p>
          </button>
        ))}
      </div>
      <SectionTitle>{t("horse.intensity")}</SectionTitle>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("horse.intensity")}>
        {(["LIGHT", "NORMAL", "HARD"] as TrainingIntensity[]).map((i) => (
          <button
            key={i}
            role="radio"
            aria-checked={intensity === i}
            onClick={() => setIntensity(i)}
            className={`min-h-11 cursor-pointer rounded-xl border text-sm font-medium transition-colors ${intensity === i ? "border-gold bg-gold/10 text-gold" : "border-line/60 bg-surface text-muted"}`}
          >
            {titleCase(i)}
          </button>
        ))}
      </div>
      <Card className="mt-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted">{t("horse.cost")}</span>
          <span className="num font-semibold">
            {fmt(cost)} {t("common.cr")}
          </span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span className="text-muted">{t("horse.duration")}</span>
          <span className="num flex items-center gap-1">
            <Timer className="size-3.5" aria-hidden />
            {t("horse.minutes", { n: minutes })}
          </span>
        </div>
        <div className="mt-1 flex justify-between gap-2 text-sm">
          <span className="text-muted">{t("horse.trainer")}</span>
          {coach ? (
            <span className="truncate text-right">
              {coach.trainer.name}{" "}
              <span className="num text-good">
                {t("horse.gains", { n: Math.round((coach.effect.gainMultiplier - 1) * 1000) / 10 })}
              </span>
            </span>
          ) : (
            <a href="/staff/" className="text-gold hover:underline">
              {t("horse.hireOne")}
            </a>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          {intensity === "HARD"
            ? t("horse.hardHint")
            : intensity === "LIGHT"
              ? t("horse.lightHint")
              : t("horse.normalHint")}{" "}
          {t("horse.gainsShrink")}
        </p>
        <Button className="mt-3 w-full" onClick={start} loading={busy} disabled={h.status !== "IDLE"}>
          {h.status === "IDLE"
            ? t("horse.startTraining")
            : t("horse.unavailable", { status: titleCase(h.status) })}
        </Button>
      </Card>
    </>
  );
}

function Pedigree({ id }: { id: string }) {
  const { data } = useApi<PedigreeNodeDto>(`/breeding/pedigree/${id}`);
  if (!data) return null;
  if (!data.sire && !data.dam) {
    return (
      <>
        <SectionTitle>{t("horse.pedigree")}</SectionTitle>
        <p className="text-sm text-muted">{t("horse.foundationOf", { line: data.bloodline })}</p>
      </>
    );
  }
  const Node = ({ n, label }: { n: PedigreeNodeDto | null; label: string }) => (
    <div className="min-w-0 rounded-lg bg-surface-2 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      {n ? (
        <a href={`/horse/?id=${n.id}`} className="block truncate text-sm font-medium hover:text-gold">
          {n.name}
        </a>
      ) : (
        <p className="text-sm text-muted">{t("horse.foundation")}</p>
      )}
      {n && (
        <p className="truncate text-[11px] text-muted">{t("common.winsOf", { w: n.wins, n: n.starts })}</p>
      )}
    </div>
  );
  return (
    <>
      <SectionTitle>{t("horse.pedigree")}</SectionTitle>
      <Card className="grid grid-cols-2 gap-2 text-left">
        <Node n={data.sire} label={t("horse.sire")} />
        <Node n={data.dam} label={t("horse.dam")} />
        <Node n={data.sire?.sire ?? null} label={t("horse.sireSire")} />
        <Node n={data.dam?.sire ?? null} label={t("horse.damSire")} />
        <Node n={data.sire?.dam ?? null} label={t("horse.sireDam")} />
        <Node n={data.dam?.dam ?? null} label={t("horse.damDam")} />
        <p className="col-span-2 text-xs text-muted">{data.bloodline}</p>
      </Card>
    </>
  );
}

function History({ id }: { id: string }) {
  const { data } = useApi<
    {
      race_id: string;
      name: string;
      distance: number;
      starts_at: string;
      position: number | null;
      prize: number | null;
      field: number;
    }[]
  >(`/horses/${id}/races`);
  return (
    <>
      <SectionTitle>{t("horse.raceRecord")}</SectionTitle>
      {!data && <Skeleton className="h-20" />}
      {data?.length === 0 && <p className="text-sm text-muted">{t("horse.noStarts")}</p>}
      <div className="space-y-2">
        {data?.map((r) => (
          <a
            key={r.race_id}
            href={`/race/?id=${r.race_id}`}
            className="flex items-center justify-between rounded-xl border border-line/60 bg-surface px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.name}</p>
              <p className="text-xs text-muted">
                {t("unit.m", { n: r.distance })} ·{" "}
                {new Date(r.starts_at).toLocaleDateString(getLocale() === "uk" ? "uk-UA" : "en-US")}
              </p>
            </div>
            <div className="text-right">
              <p className={`num font-display text-lg font-bold ${r.position === 1 ? "text-gold" : ""}`}>
                {r.position ? ordinal(r.position) : "—"}
                <span className="text-xs text-muted">/{r.field}</span>
              </p>
              {!!r.prize && <p className="num text-xs text-good">+{fmt(r.prize)}</p>}
            </div>
          </a>
        ))}
      </div>
    </>
  );
}

function Sell({ h }: { h: HorseDetailDto }) {
  const p = h.private!;
  const [type, setType] = useState<"FIXED" | "AUCTION">("AUCTION");
  const [price, setPrice] = useState(String(p.marketValue));
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const value = Number(price || 0);
  const m = defaultConfig.market;
  const min = Math.floor(p.marketValue * m.minPriceFactor);
  const max = Math.ceil(p.marketValue * m.maxPriceFactor);
  const feePct = Math.round(m.saleFeeRate * 100);

  if (p.listingId) {
    return (
      <Card className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">{t("horse.listed")}</span>
        <Link href={`/listing/?id=${p.listingId}`} className="text-sm font-medium text-gold underline">
          {t("horse.viewListing")}
        </Link>
      </Card>
    );
  }
  if (h.status !== "IDLE") return null;

  const submit = async () => {
    if (
      !window.confirm(
        t(type === "AUCTION" ? "horse.confirmAuction" : "horse.confirmFixed", {
          name: h.name,
          price: fmt(value),
          fee: feePct,
        }),
      )
    )
      return;
    setBusy(true);
    try {
      await post("/market/listings", {
        horseId: h.id,
        type,
        price: value,
        durationHours: type === "AUCTION" ? hours : undefined,
      });
      haptic.success();
      toast(t("horse.onMarket", { name: h.name }));
      invalidate(`/horses/${h.id}`, "/market", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>{t("horse.sell")}</SectionTitle>
      <Card>
        <p className="text-sm text-muted">
          {t("horse.guideValue")} <span className="num text-ink">{fmt(p.marketValue)}</span>{" "}
          {t("common.credits")}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("horse.saleType")}>
          {(["AUCTION", "FIXED"] as const).map((st) => (
            <button
              key={st}
              role="radio"
              aria-checked={type === st}
              onClick={() => setType(st)}
              className={`min-h-11 cursor-pointer rounded-xl border text-sm font-medium ${type === st ? "border-gold bg-gold/10 text-gold" : "border-line/60 text-muted"}`}
            >
              {st === "AUCTION" ? t("horse.auction") : t("horse.fixedPrice")}
            </button>
          ))}
        </div>
        <label htmlFor="price" className="mt-3 block text-sm text-muted">
          {type === "AUCTION" ? t("horse.startingPrice") : t("horse.price")}
        </label>
        <input
          id="price"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          className="num mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
          aria-describedby="price-help"
        />
        <p
          id="price-help"
          className={`mt-1 text-xs ${value < min || value > max ? "text-bad" : "text-muted"}`}
        >
          {t("horse.priceHelp", {
            min: fmt(min),
            max: fmt(max),
            net: fmt(Math.max(0, value - Math.floor(value * m.saleFeeRate))),
            fee: feePct,
          })}
        </p>
        {type === "AUCTION" && (
          <>
            <label htmlFor="hours" className="mt-3 block text-sm text-muted">
              {t("horse.duration")}
            </label>
            <select
              id="hours"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
            >
              {m.auctionHours.map((n) => (
                <option key={n} value={n}>
                  {t("horse.hours", { n })}
                </option>
              ))}
            </select>
          </>
        )}
        <Button
          variant="secondary"
          className="mt-4 w-full"
          loading={busy}
          disabled={value < min || value > max}
          onClick={submit}
        >
          <Tag className="size-4" aria-hidden />
          {t("horse.listOnMarket")}
        </Button>
      </Card>
    </>
  );
}

function Breeding({ h }: { h: HorseDetailDto }) {
  const p = h.private!;
  const [fee, setFee] = useState(String(p.studFee ?? 1000));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const adult = h.age >= defaultConfig.breeding.minBreedingAge;
  const sire = h.sex === "STALLION" || h.sex === "COLT";
  const dam = h.sex === "MARE" || h.sex === "FILLY";
  if (!adult || (!sire && !dam)) return null;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      haptic.success();
      toast(ok);
      invalidate(`/horses/${h.id}`, "/breeding");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>{t("horse.breeding")}</SectionTitle>
      <Card>
        {dam && (
          <Link
            href={`/breeding/?dam=${h.id}`}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gold/50 text-[15px] font-medium text-gold"
          >
            <HeartHandshake className="size-4" aria-hidden />
            {t("horse.planMating")}
          </Link>
        )}
        {sire && (
          <>
            <p className="text-sm text-muted">
              {p.studFee !== null ? t("horse.standingAt", { fee: fmt(p.studFee) }) : t("horse.studPitch")}
            </p>
            <label htmlFor="studfee" className="mt-3 block text-sm text-muted">
              {t("horse.studFee")}
            </label>
            <input
              id="studfee"
              inputMode="numeric"
              value={fee}
              onChange={(e) => setFee(e.target.value.replace(/\D/g, ""))}
              className="num mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
            />
            <p className="mt-1 text-xs text-muted">
              {t("horse.studNet", {
                net: fmt(
                  Math.max(
                    0,
                    Number(fee || 0) - Math.floor(Number(fee || 0) * defaultConfig.breeding.studFeeRate),
                  ),
                ),
                n: defaultConfig.breeding.sireCoversPerWeek,
              })}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                className="text-sm"
                loading={busy}
                onClick={() =>
                  run(
                    () => post("/breeding/studs", { horseId: h.id, fee: Number(fee || 0) }),
                    p.studFee !== null ? t("horse.feeUpdated") : t("horse.nowAtStud"),
                  )
                }
              >
                <Dna className="size-4" aria-hidden />
                {p.studFee !== null ? t("horse.updateFee") : t("horse.standAtStud")}
              </Button>
              {p.studFee !== null ? (
                <Button
                  variant="ghost"
                  className="text-sm"
                  loading={busy}
                  onClick={() => run(() => del(`/breeding/studs/${h.id}`), t("horse.withdrawn"))}
                >
                  {t("common.withdraw")}
                </Button>
              ) : (
                <Link
                  href={`/breeding/?sire=${h.id}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl text-sm text-muted hover:text-ink"
                >
                  {t("horse.breedMyMare")}
                </Link>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

const CLOTH_COLORS = Object.keys(SILK_COLORS) as SilkColor[];
const DEFAULT_CLOTH: Cloth = { pattern: "PLAIN", color: "navy", trim: "white" };

function ClothEditor({ h }: { h: HorseDetailDto }) {
  const cosmetics = useApi<CosmeticsDto>("/cosmetics");
  const [draft, setDraft] = useState<Cloth | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const data = cosmetics.data;
  if (!data) return null;
  const saved = h.cloth ?? DEFAULT_CLOTH;
  const cloth = draft ?? saved;
  const changed = JSON.stringify(cloth) !== JSON.stringify(h.cloth);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      haptic.success();
      toast(ok);
      return true;
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const choose = async (p: CosmeticsDto["clothPatterns"][number]) => {
    if (p.owned) return setDraft({ ...cloth, pattern: p.pattern });
    if (!window.confirm(t("cloth.confirmUnlock", { name: titleCase(p.pattern), n: p.priceGems }))) return;
    const ok = await run(
      p.pattern,
      () => post(`/cosmetics/cloth/patterns/${p.pattern}/unlock`),
      t("silks.unlocked", { name: titleCase(p.pattern) }),
    );
    if (ok) {
      setDraft({ ...cloth, pattern: p.pattern });
      invalidate("/cosmetics", "/wallet");
    }
  };
  const swatches = (slot: "color" | "trim", label: string) => (
    <ColorPicker
      label={label}
      value={cloth[slot]}
      colors={CLOTH_COLORS}
      onChange={(c) => setDraft({ ...cloth, [slot]: c })}
      blocked={(c) => c === (slot === "color" ? cloth.trim : cloth.color)}
      lockedLabel={(c) => (memberLocked(c, data.member) ? t("circle.memberColour") : null)}
    />
  );

  return (
    <>
      <SectionTitle>{t("cloth.title")}</SectionTitle>
      <Card>
        <div className="flex items-center gap-4">
          <SaddleCloth cloth={cloth} width={84} label={h.name.charAt(0)} title={t("cloth.title")} />
          <p className="text-sm text-muted">{t("cloth.hint")}</p>
        </div>
        <p className="mt-3 text-xs text-muted">{t("cloth.pattern")}</p>
        <div className="mt-1 grid grid-cols-4 gap-2" role="radiogroup" aria-label={t("cloth.pattern")}>
          {data.clothPatterns.map((p) => (
            <button
              key={p.pattern}
              role="radio"
              aria-checked={cloth.pattern === p.pattern}
              disabled={busy !== null}
              onClick={() => void choose(p)}
              className={`flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border p-1.5 ${cloth.pattern === p.pattern ? "border-gold bg-gold/10" : "border-line/60 bg-surface-2"}`}
            >
              <SaddleCloth cloth={{ ...cloth, pattern: p.pattern }} width={40} />
              <span className="text-[11px] font-medium">{titleCase(p.pattern)}</span>
              {!p.owned && (
                <span className="num flex items-center gap-0.5 text-[11px] text-gold">
                  <Lock className="size-3" aria-hidden />
                  {p.priceGems}
                  <Gem className="size-3" aria-hidden />
                </span>
              )}
            </button>
          ))}
        </div>
        {swatches("color", t("cloth.colour"))}
        {swatches("trim", t("cloth.trim"))}
        <Button
          className="mt-4 w-full"
          variant="secondary"
          disabled={!changed}
          loading={busy === "save"}
          onClick={async () => {
            if (await run("save", () => put(`/cosmetics/horses/${h.id}/cloth`, cloth), t("cloth.saved"))) {
              setDraft(null);
              invalidate(`/horses/${h.id}`, "/horses", "/home");
            }
          }}
        >
          {t("cloth.save")}
        </Button>
      </Card>
    </>
  );
}

/** The race classes this horse's record and race rating open to it now, with the full class guide. */
function RaceClasses({ horse }: { horse: HorseDetailDto }) {
  const classes = canRaceAtAge(horse.age, defaultConfig)
    ? eligibleClasses(horse.raceRating, horse.record.wins, defaultConfig)
    : [];
  return (
    <div className="mt-3">
      <p className="text-sm">
        <span className="text-muted">{classes.length ? t("horse.classesNow") : t("horse.classesNone")}</span>
        {classes.map((c) => (
          <span key={c} className="ml-1.5 inline-block">
            <Badge tone="gold">{CLASS_NAMES[c]}</Badge>
          </span>
        ))}
      </p>
      <div className="mt-2">
        <ClassGuide highlight={classes} />
      </div>
    </div>
  );
}

/** Weekly feed plan: recovery between sessions only (no attribute or race-day edge). */
function FeedCard({ h }: { h: HorseDetailDto }) {
  const toast = useToast();
  const [busy, setBusy] = useState<FeedPlan | null>(null);
  const f = h.private!.feed;
  const until = f.paidUntil
    ? new Date(f.paidUntil).toLocaleDateString(getLocale() === "uk" ? "uk-UA" : "en", {
        day: "numeric",
        month: "short",
      })
    : null;
  const pct = (x: number) => Math.round(Math.abs(x - 1) * 100);
  const choose = async (plan: FeedPlan, done: string) => {
    setBusy(plan);
    try {
      await post(`/horses/${h.id}/feed`, { plan });
      haptic.success();
      toast(done);
      invalidate(`/horses/${h.id}`, "/wallet");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const pick = (o: (typeof f.options)[number]) => {
    const name = t(`nutrition.${o.plan}` as MessageKey);
    if (o.plan === f.plan) return;
    if (o.plan === "STANDARD") return void choose("STANDARD", t("nutrition.stopped"));
    const ask = t("nutrition.confirm", { name: h.name, plan: name.toLowerCase(), n: fmt(o.weeklyCost) });
    if (!window.confirm(f.plan === "STANDARD" ? ask : `${ask} ${t("nutrition.confirmSwitch")}`)) return;
    void choose(o.plan, t("nutrition.started", { plan: name }));
  };
  return (
    <>
      <SectionTitle>{t("nutrition.title")}</SectionTitle>
      <Card>
        <p className="text-sm text-muted">{t("nutrition.hint")}</p>
        <div className="mt-3 space-y-2" role="radiogroup" aria-label={t("nutrition.title")}>
          {f.options.map((o) => (
            <button
              key={o.plan}
              role="radio"
              aria-checked={f.plan === o.plan}
              disabled={busy !== null}
              onClick={() => pick(o)}
              className={`flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${f.plan === o.plan ? "border-gold bg-gold/10" : "border-line/60 bg-surface-2"}`}
            >
              <span>
                <span className="block font-semibold">{t(`nutrition.${o.plan}` as MessageKey)}</span>
                <span className="block text-xs text-muted">
                  {o.plan === "STANDARD"
                    ? t("nutrition.basic")
                    : t("nutrition.effect", { r: pct(o.recovery), h: pct(o.regen), f: pct(o.formDecay) })}
                </span>
              </span>
              <span className="num shrink-0 text-sm text-gold">
                {o.weeklyCost ? t("nutrition.perWeek", { n: fmt(o.weeklyCost) }) : t("nutrition.free")}
              </span>
            </button>
          ))}
        </div>
        {until && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {t(f.renews ? "nutrition.renews" : "nutrition.ends", { date: until })}
            </p>
            <Button
              variant="ghost"
              loading={busy === (f.renews ? "STANDARD" : f.plan)}
              disabled={busy !== null}
              onClick={() =>
                void (f.renews
                  ? choose("STANDARD", t("nutrition.stopped"))
                  : choose(f.plan, t("nutrition.resumed")))
              }
            >
              {f.renews ? t("nutrition.stop") : t("nutrition.resume")}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

/** Trainer's advice: rest, the next session and open races that suit the horse. */
function AdviceCard({ h }: { h: HorseDetailDto }) {
  const { data } = useApi<HorseAdviceDto>(`/horses/${h.id}/advice`, { refreshMs: 60_000 });
  if (!data) return null;
  return (
    <>
      <SectionTitle>{t("advice.title")}</SectionTitle>
      <Card className="space-y-1.5 text-sm">
        <p className="text-muted">{t(`advice.profile.${data.profile}` as MessageKey)}</p>
        <p>{data.restHours > 0 ? t("advice.rest", { h: Math.ceil(data.restHours) }) : t("advice.ready")}</p>
        <p>
          {t("advice.train", {
            type: TRAINING_INFO[data.training.type]!.label,
            attr: ATTRIBUTE_LABELS[data.training.attribute]!.toLowerCase(),
          })}
        </p>
      </Card>
      {data.restHours === 0 && (
        <>
          <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted">{t("advice.races")}</p>
          {data.races.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{t("advice.noRaces")}</p>
          ) : (
            <div className="mt-1 space-y-2">
              {data.races.map((r) => (
                <RaceCard key={r.id} race={r} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Follow another owner's horse: see its next race in "Following" and hear when it wins. */
function FollowButton({ h }: { h: HorseDetailDto }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const toggle = async () => {
    setBusy(true);
    try {
      if (h.followed) await del(`/horses/${h.id}/follow`);
      else {
        await post(`/horses/${h.id}/follow`);
        toast(t("follow.done", { name: h.name }));
      }
      haptic.success();
      invalidate(`/horses/${h.id}`, "/me/follows");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={h.followed}
      aria-label={h.followed ? t("follow.unfollow") : t("follow.follow")}
      title={t("follow.followers", { n: h.followers })}
      className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-full transition-colors disabled:opacity-50 ${h.followed ? "text-gold" : "text-muted hover:text-gold"}`}
    >
      <Star className="size-5" fill={h.followed ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}
