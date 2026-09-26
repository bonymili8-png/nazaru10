"use client";
import {
  type HorseSummaryDto,
  STRATEGIES,
  type Strategy,
  type TournamentDetailDto,
  type TournamentEntryDto,
} from "@thoroughline/contracts";
import { trackByCode } from "@thoroughline/engine";
import { Crown } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { qualificationText, STATUS_LABEL, TIER_NAMES } from "@/components/TournamentCard";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LinkButton,
  SectionTitle,
  Skeleton,
  useToast,
} from "@/components/ui";
import { del, post } from "@/lib/api";
import { countdown, errorMessage, fmt, ordinal, STRATEGY_INFO, trackName } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { t as tr } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

export default function TournamentPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <TournamentPage />
    </Suspense>
  );
}

const ENTRY_TONE: Record<TournamentEntryDto["status"], "neutral" | "gold" | "good" | "bad"> = {
  REGISTERED: "good",
  WITHDRAWN: "neutral",
  IN_HEAT: "neutral",
  FINALIST: "gold",
  ELIMINATED: "neutral",
  SCRATCHED: "bad",
};

function TournamentPage() {
  const id = useSearchParams().get("id");
  const {
    data: t,
    error,
    reload,
  } = useApi<TournamentDetailDto>(id ? `/tournaments/${id}` : null, {
    refreshMs: 10_000,
  });
  const now = useNow(1000);
  if (!id) return <ErrorState error={new Error(tr("tour.noneSelected"))} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!t) return <Skeleton className="h-64" />;
  const track = trackByCode(t.trackCode);
  const open = t.status === "REGISTRATION" && new Date(t.registrationClosesAt).getTime() > now;

  return (
    <div>
      <Card className="bg-gradient-to-br from-surface to-surface-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="gold">{TIER_NAMES[t.tier]}</Badge>
          <Badge tone={open ? "good" : t.status === "HEATS" || t.status === "FINAL" ? "bad" : "neutral"}>
            {STATUS_LABEL[t.status]}
          </Badge>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold">{t.name}</h1>
        <p className="text-sm text-muted">
          {trackName(track.archetype)} · {tr("unit.m", { n: t.distance })} ·{" "}
          {qualificationText(t.qualification)}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Info k={tr("common.purse")} v={fmt(t.purse)} />
          <Info k={tr("common.entry")} v={fmt(t.entryFee)} />
          <Info
            k={open ? tr("race.closes") : t.status === "HEATS" ? tr("tour.final") : tr("tour.field")}
            v={
              open
                ? countdown(t.registrationClosesAt, now)
                : t.status === "HEATS"
                  ? countdown(t.finalAt, now)
                  : `${t.entrants}`
            }
          />
        </dl>
        {t.winner && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-gold/10 px-3 py-2">
            <Crown className="size-5 text-gold" aria-hidden />
            <span>
              <span className="font-semibold">{t.winner.horseName}</span>
              <span className="text-sm text-muted"> · {t.winner.ownerName}</span>
            </span>
          </p>
        )}
      </Card>

      {open && <RegisterForm t={t} />}

      {(t.heatRaceIds.length > 0 || t.finalRaceId) && (
        <>
          <SectionTitle>{tr("tour.races")}</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {t.heatRaceIds.map((rid, i) => (
              <LinkButton key={rid} href={`/race/?id=${rid}`}>
                {tr("tour.heatN", { n: i + 1 })}
              </LinkButton>
            ))}
            {t.finalRaceId && (
              <LinkButton href={`/race/?id=${t.finalRaceId}`} variant="primary">
                {tr("tour.final")}
              </LinkButton>
            )}
          </div>
        </>
      )}

      <SectionTitle>{tr("tour.fieldN", { n: t.entries.length })}</SectionTitle>
      <Card className="divide-y divide-line/40 p-0">
        {t.entries.length === 0 && <p className="p-4 text-sm text-muted">{tr("tour.noEntries")}</p>}
        {t.entries.map((e) => (
          <div
            key={e.horseId}
            className={`flex items-center gap-3 px-4 py-2.5 ${e.mine ? "bg-gold/10" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{e.horseName}</p>
              <p className="truncate text-xs text-muted">
                {e.ownerName}
                {e.heatPosition ? tr("tour.heatPos", { p: ordinal(e.heatPosition) }) : ""}
                {e.finalPosition ? tr("tour.finalPos", { p: ordinal(e.finalPosition) }) : ""}
              </p>
            </div>
            <Badge tone={ENTRY_TONE[e.status]}>{tr(`tentry.${e.status}`)}</Badge>
            {e.mine && open && e.status === "REGISTERED" && <Withdraw id={t.id} horseId={e.horseId} />}
          </div>
        ))}
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

function Withdraw({ id, horseId }: { id: string; horseId: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      className="min-h-9 px-2 text-xs"
      loading={busy}
      onClick={async () => {
        if (!window.confirm(tr("race.confirmWithdraw"))) return;
        setBusy(true);
        try {
          await del(`/tournaments/${id}/entries/${horseId}`);
          toast(tr("race.withdrawn"));
          invalidate(`/tournaments`, "/wallet", "/horses", "/home");
        } catch (e) {
          toast(errorMessage(e), "bad");
        } finally {
          setBusy(false);
        }
      }}
    >
      {tr("common.withdraw")}
    </Button>
  );
}

function RegisterForm({ t }: { t: TournamentDetailDto }) {
  const horses = useApi<HorseSummaryDto[]>("/horses");
  const [horseId, setHorseId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("MID_PACK");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const available = (horses.data ?? []).filter((h) => h.status === "IDLE");
  const selected = horseId ?? available[0]?.id ?? null;

  const register = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await post(`/tournaments/${t.id}/entries`, { horseId: selected, strategy });
      haptic.success();
      toast(tr("tour.registered"));
      invalidate("/tournaments", "/wallet", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>{tr("tour.register")}</SectionTitle>
      <Card>
        {available.length === 0 ? (
          <p className="text-sm text-muted">{tr("tour.noFree")}</p>
        ) : (
          <>
            <label className="text-sm text-muted" htmlFor="horse">
              {tr("race.horse")}
            </label>
            <select
              id="horse"
              value={selected ?? ""}
              onChange={(e) => setHorseId(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
            >
              {available.map((h) => (
                <option key={h.id} value={h.id}>
                  {tr("race.horseOption", { name: h.name, r: Math.round(h.abilityRating) })}
                </option>
              ))}
            </select>
            <p className="mt-4 text-sm text-muted" id="tactics">
              {tr("tour.tactics")}
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
            <p className="mt-3 text-xs text-muted">{tr("tour.commit")}</p>
            <Button className="mt-4 w-full" onClick={register} loading={busy}>
              {tr("tour.registerFee", { fee: fmt(t.entryFee) })}
            </Button>
          </>
        )}
      </Card>
    </>
  );
}
