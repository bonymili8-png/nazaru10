"use client";
import {
  type HorseDetailDto,
  type TrainingSessionDto,
  TRAINING_TYPES,
  type TrainingIntensity,
  type TrainingType,
} from "@thoroughline/contracts";
import { defaultConfig, trainingCost, trainingDurationMinutes } from "@thoroughline/engine";
import { Activity, HeartPulse, Microscope, Stethoscope, Tag, Timer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { coatColor } from "@/components/HorseCard";
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
import { post } from "@/lib/api";
import { ATTRIBUTE_LABELS, countdown, fmt, ordinal, titleCase, TRAINING_INFO } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { haptic } from "@/lib/telegram";

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
  const [tab, setTab] = useState<Tab>("overview");
  if (!id) return <ErrorState error={new Error("No horse selected")} />;
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
            <h1 className="truncate font-display text-2xl font-bold">{h.name}</h1>
            <p className="text-sm text-muted">
              {h.age.toFixed(1)}y {titleCase(h.sex)} · {titleCase(h.coat)} · {h.bloodline}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="gold">{titleCase(h.rarity)}</Badge>
              <Badge>{titleCase(h.stage)}</Badge>
              <Badge tone={h.status === "IDLE" ? "good" : h.status === "INJURED" ? "bad" : "warn"}>
                {titleCase(h.status)}
              </Badge>
            </div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            ["Rating", Math.round(h.abilityRating)],
            ["Mark", h.raceRating],
            ["Record", `${h.record.wins}-${h.record.seconds}-${h.record.thirds}`],
            ["Earned", fmt(h.record.earnings)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg/40 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
              <dd className="num font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {mine && (
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-surface p-1" role="tablist">
          {(["overview", "train", "history"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium capitalize transition-colors ${tab === t ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {(!mine || tab === "overview") && <Overview h={h} />}
      {mine && tab === "train" && <Train h={h} />}
      {(!mine || tab === "history") && <History id={h.id} />}
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
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const c = p.condition;
  const surfaces = Object.entries(p.aptitudes.surface).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <SectionTitle>Condition</SectionTitle>
      <Card>
        <Meter
          label="Fatigue"
          value={c.fatigue}
          tone={c.fatigue > 70 ? "bad" : c.fatigue > 40 ? "warn" : "good"}
        />
        <Meter label="Health" value={c.health} tone={c.health < 60 ? "bad" : "good"} />
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-muted">Form</span>
          <span className={c.form > 0.15 ? "text-good" : c.form < -0.15 ? "text-bad" : "text-ink"}>
            {c.form > 0.15 ? "In form ↑" : c.form < -0.15 ? "Out of form ↓" : "Steady"}
          </span>
        </div>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <HeartPulse className="size-4" aria-hidden />
          {c.hoursToRaceReady > 0
            ? `Race-ready in ~${c.hoursToRaceReady.toFixed(1)}h of rest`
            : "Fresh enough to race"}
        </p>
        {h.status === "INJURED" && (
          <Button
            variant="danger"
            className="mt-3 w-full"
            loading={busy === "vet"}
            onClick={() => act("vet", "The vet patched them up")}
          >
            <Stethoscope className="size-4" aria-hidden />
            Call the vet
          </Button>
        )}
      </Card>

      <SectionTitle>Attributes</SectionTitle>
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
          <span className="text-muted">Potential</span>
          <Stars n={p.potentialStars} />
        </p>
        {!p.diagnostics && (
          <Button
            variant="secondary"
            className="mt-3 w-full text-sm"
            loading={busy === "diagnostics"}
            onClick={() => act("diagnostics", "Diagnostics complete — potential revealed")}
          >
            <Microscope className="size-4" aria-hidden />
            Veterinary diagnostics · 20 gems
          </Button>
        )}
        {p.diagnostics && (
          <p className="mt-2 text-xs text-muted">White markers show each attribute's genetic ceiling.</p>
        )}
      </Card>

      <Sell h={h} />

      <SectionTitle>Profile</SectionTitle>
      <Card className="space-y-2 text-sm">
        <Row k="Best distance" v={`~${fmt(p.aptitudes.optimalDistance)}m`} />
        <Row k="Favourite surface" v={titleCase(surfaces[0]![0])} />
        <Row
          k="Soft/heavy going"
          v={p.aptitudes.wet > 62 ? "Loves it" : p.aptitudes.wet < 38 ? "Dislikes it" : "Handles it"}
        />
        <Row
          k="Temperament"
          v={p.traits.temperament > 60 ? "Calm" : p.traits.temperament < 40 ? "Keen / hot" : "Balanced"}
        />
        <Row
          k="Consistency"
          v={p.traits.consistency > 60 ? "Reliable" : p.traits.consistency < 40 ? "Erratic" : "Average"}
        />
        <Row
          k="Courage"
          v={p.traits.courage > 60 ? "Battler" : p.traits.courage < 40 ? "Fragile" : "Average"}
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

  const start = async () => {
    setBusy(true);
    try {
      await post<TrainingSessionDto>(`/horses/${h.id}/training`, { type, intensity });
      haptic.success();
      toast(`${TRAINING_INFO[type]!.label} started`);
      invalidate(`/horses/${h.id}`, "/wallet", "/home", "/horses");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  if (active) {
    return (
      <Card className="mt-4 text-center">
        <Activity className="mx-auto size-8 text-gold" aria-hidden />
        <p className="mt-2 font-display text-xl">{TRAINING_INFO[active.type]!.label}</p>
        <p className="text-sm text-muted">{titleCase(active.intensity)} intensity</p>
        <p className="num mt-3 text-3xl font-bold text-gold">{countdown(active.completesAt, now)}</p>
        <p className="text-xs text-muted">until back in the barn</p>
      </Card>
    );
  }

  return (
    <>
      <SectionTitle>Session</SectionTitle>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Training type">
        {TRAINING_TYPES.map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className={`min-h-16 cursor-pointer rounded-xl border p-2.5 text-left transition-colors ${type === t ? "border-gold bg-gold/10" : "border-line/60 bg-surface hover:border-line"}`}
          >
            <p className="text-sm font-semibold">{TRAINING_INFO[t]!.label}</p>
            <p className="text-xs text-muted">{TRAINING_INFO[t]!.focus}</p>
          </button>
        ))}
      </div>
      <SectionTitle>Intensity</SectionTitle>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Intensity">
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
          <span className="text-muted">Cost</span>
          <span className="num font-semibold">{fmt(cost)} cr</span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span className="text-muted">Duration</span>
          <span className="num flex items-center gap-1">
            <Timer className="size-3.5" aria-hidden />
            {minutes} min
          </span>
        </div>
        <p className="mt-2 text-xs text-muted">
          {intensity === "HARD"
            ? "Bigger gains, much more fatigue and injury risk."
            : intensity === "LIGHT"
              ? "Gentle: small gains, little fatigue."
              : "Balanced gains and fatigue."}{" "}
          Gains shrink as a horse nears its genetic ceiling and with repeated sessions in a day.
        </p>
        <Button className="mt-3 w-full" onClick={start} loading={busy} disabled={h.status !== "IDLE"}>
          {h.status === "IDLE" ? "Start training" : `Unavailable — ${titleCase(h.status)}`}
        </Button>
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
      <SectionTitle>Race record</SectionTitle>
      {!data && <Skeleton className="h-20" />}
      {data?.length === 0 && <p className="text-sm text-muted">No starts yet.</p>}
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
                {r.distance}m · {new Date(r.starts_at).toLocaleDateString()}
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
        <span className="text-sm text-muted">Listed on the market</span>
        <Link href={`/listing/?id=${p.listingId}`} className="text-sm font-medium text-gold underline">
          View listing
        </Link>
      </Card>
    );
  }
  if (h.status !== "IDLE") return null;

  const submit = async () => {
    if (
      !window.confirm(
        `List ${h.name} ${type === "AUCTION" ? `at auction from ${fmt(value)}` : `for ${fmt(value)}`} credits? A ${feePct}% fee applies on sale.`,
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
      toast(`${h.name} is on the market`);
      invalidate(`/horses/${h.id}`, "/market", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Sell</SectionTitle>
      <Card>
        <p className="text-sm text-muted">
          Guide value <span className="num text-ink">{fmt(p.marketValue)}</span> credits
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Sale type">
          {(["AUCTION", "FIXED"] as const).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`min-h-11 cursor-pointer rounded-xl border text-sm font-medium ${type === t ? "border-gold bg-gold/10 text-gold" : "border-line/60 text-muted"}`}
            >
              {t === "AUCTION" ? "Auction" : "Fixed price"}
            </button>
          ))}
        </div>
        <label htmlFor="price" className="mt-3 block text-sm text-muted">
          {type === "AUCTION" ? "Starting price" : "Price"} (credits)
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
          Allowed {fmt(min)}–{fmt(max)}. You receive{" "}
          {fmt(Math.max(0, value - Math.floor(value * m.saleFeeRate)))} after the {feePct}% fee.
        </p>
        {type === "AUCTION" && (
          <>
            <label htmlFor="hours" className="mt-3 block text-sm text-muted">
              Duration
            </label>
            <select
              id="hours"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
            >
              {m.auctionHours.map((n) => (
                <option key={n} value={n}>
                  {n} hours
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
          List on the market
        </Button>
      </Card>
    </>
  );
}
