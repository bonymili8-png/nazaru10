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
import { countdown, fmt, ordinal, STRATEGY_INFO } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { haptic } from "@/lib/telegram";

export default function TournamentPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <TournamentPage />
    </Suspense>
  );
}

const ENTRY_STATUS: Record<
  TournamentEntryDto["status"],
  { label: string; tone: "neutral" | "gold" | "good" | "bad" }
> = {
  REGISTERED: { label: "Registered", tone: "good" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  IN_HEAT: { label: "In heat", tone: "neutral" },
  FINALIST: { label: "Finalist", tone: "gold" },
  ELIMINATED: { label: "Eliminated", tone: "neutral" },
  SCRATCHED: { label: "Scratched", tone: "bad" },
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
  if (!id) return <ErrorState error={new Error("No tournament selected")} />;
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
          {track.archetype} · {t.distance}m · {qualificationText(t.qualification)}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Info k="Purse" v={fmt(t.purse)} />
          <Info k="Entry" v={fmt(t.entryFee)} />
          <Info
            k={open ? "Closes" : t.status === "HEATS" ? "Final" : "Field"}
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
          <SectionTitle>Races</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {t.heatRaceIds.map((rid, i) => (
              <LinkButton key={rid} href={`/race/?id=${rid}`}>
                Heat {i + 1}
              </LinkButton>
            ))}
            {t.finalRaceId && (
              <LinkButton href={`/race/?id=${t.finalRaceId}`} variant="primary">
                Final
              </LinkButton>
            )}
          </div>
        </>
      )}

      <SectionTitle>Field ({t.entries.length})</SectionTitle>
      <Card className="divide-y divide-line/40 p-0">
        {t.entries.length === 0 && <p className="p-4 text-sm text-muted">No entries yet — be the first.</p>}
        {t.entries.map((e) => (
          <div
            key={e.horseId}
            className={`flex items-center gap-3 px-4 py-2.5 ${e.mine ? "bg-gold/10" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{e.horseName}</p>
              <p className="truncate text-xs text-muted">
                {e.ownerName}
                {e.heatPosition ? ` · heat ${ordinal(e.heatPosition)}` : ""}
                {e.finalPosition ? ` · final ${ordinal(e.finalPosition)}` : ""}
              </p>
            </div>
            <Badge tone={ENTRY_STATUS[e.status].tone}>{ENTRY_STATUS[e.status].label}</Badge>
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
        if (!window.confirm("Withdraw this horse? The entry fee is refunded.")) return;
        setBusy(true);
        try {
          await del(`/tournaments/${id}/entries/${horseId}`);
          toast("Withdrawn — fee refunded");
          invalidate(`/tournaments`, "/wallet", "/horses", "/home");
        } catch (e) {
          toast((e as Error).message, "bad");
        } finally {
          setBusy(false);
        }
      }}
    >
      Withdraw
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
      toast("Registered! The draw is made when registration closes.");
      invalidate("/tournaments", "/wallet", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Register a horse</SectionTitle>
      <Card>
        {available.length === 0 ? (
          <p className="text-sm text-muted">
            No horse is free right now. Horses in training, entered elsewhere or injured can&apos;t register.
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
              Tactics (heats and final)
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
            <p className="mt-3 text-xs text-muted">
              The horse is committed until it is eliminated or the final is run — no training or other races
              meanwhile. Withdraw before the close for a full refund.
            </p>
            <Button className="mt-4 w-full" onClick={register} loading={busy}>
              Register · {fmt(t.entryFee)} cr
            </Button>
          </>
        )}
      </Card>
    </>
  );
}
