"use client";
import type { ShowdownDto, ShowdownRaceDto } from "@thoroughline/contracts";
import { STRATEGIES, type Strategy } from "@thoroughline/engine";
import { Trophy, X } from "lucide-react";
import { useState } from "react";
import { LiveRace } from "@/components/LiveRace";
import { Badge, Card, SectionTitle, useToast } from "@/components/ui";
import { del, post } from "@/lib/api";
import { countdown, errorMessage, STRATEGY_INFO, titleCase } from "@/lib/format";
import { invalidate, useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

/** "No fatigue" / "Normal" badge. */
export function ModeBadge({ mode }: { mode: ShowdownDto["mode"] }) {
  return <Badge tone={mode === "NO_FATIGUE" ? "good" : "warn"}>{t(`showdown.mode.${mode}`)}</Badge>;
}

/** One line about a race: "Race 3 · 1400m Turf · Good". */
export function raceLine(r: ShowdownRaceDto): string {
  return `${t("showdown.raceNo", { n: r.no })} · ${t("unit.m", { n: r.distance })} ${titleCase(r.surface)} · ${r.going}`;
}

/**
 * The race that is called, running or just run: countdown to the off, then the live picture.
 * `livePath` is the public broadcast on the watch page, the signed-in one otherwise.
 */
export function CurrentRace({ s, livePath }: { s: ShowdownDto; livePath: (raceId: string) => string }) {
  const now = useNow(500);
  const r = s.races[0];
  if (!r || !s.current || r.id !== s.current.id) return null;
  if (r.status === "CANCELLED")
    return (
      <Card className="mt-4 text-center text-sm text-muted">
        {raceLine(r)} — {t("showdown.cancelled")}
      </Card>
    );
  return (
    <div className="mt-4">
      <Card className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold">{raceLine(r)}</p>
          <p className="truncate text-xs text-muted">{r.trackName}</p>
        </div>
        {r.status === "CALLED" && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted">{t("showdown.offIn")}</p>
            <p className="num font-display text-2xl font-bold text-gold">{countdown(r.startsAt, now)}</p>
          </div>
        )}
        {r.status === "RUNNING" && <Badge tone="bad">{t("showdown.live")}</Badge>}
      </Card>
      {r.status !== "CALLED" && <LiveRace key={r.id} race={s.current} livePath={livePath(r.id)} />}
    </div>
  );
}

/** A player's tactics for the called race, or sitting it out. */
export function Tactics({ s }: { s: ShowdownDto }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const r = s.races[0];
  if (!s.joined || !r || r.status !== "CALLED") return null;
  const choose = async (strategy: Strategy | null) => {
    setBusy(true);
    try {
      await post(`/showdowns/${s.code}/races/${r.id}/tactics`, { strategy });
      haptic.success();
      invalidate(`/showdowns/${s.code}`);
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  const options: (Strategy | null)[] = [...STRATEGIES, null];
  return (
    <Card className="mt-2">
      <p className="text-sm font-semibold">{t("showdown.tactics")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("showdown.tactics")}>
        {options.map((o) => {
          const on = o === null ? r.myResting : !r.myResting && r.myStrategy === o;
          return (
            <button
              key={o ?? "rest"}
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => void choose(o)}
              className={`min-h-11 cursor-pointer rounded-xl border px-3 text-sm transition-colors disabled:opacity-60 ${on ? "border-gold bg-gold/10" : "border-line/60 bg-surface-2"}`}
            >
              {o === null ? t("showdown.sitOut") : STRATEGY_INFO[o]!.label}
            </button>
          );
        })}
      </div>
      {s.mode === "NORMAL" && <p className="mt-2 text-xs text-muted">{t("showdown.restHint")}</p>}
    </Card>
  );
}

/** The table: points, wins, races, and fatigue in NORMAL mode. The host can remove a player. */
export function Standings({ s, compact = false }: { s: ShowdownDto; compact?: boolean }) {
  const toast = useToast();
  const kick = async (userId: string, name: string) => {
    if (!window.confirm(t("showdown.kickConfirm", { name }))) return;
    try {
      await del(`/showdowns/${s.code}/players/${userId}`);
      invalidate(`/showdowns/${s.code}`);
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
  };
  return (
    <>
      {!compact && <SectionTitle>{t("showdown.standings")}</SectionTitle>}
      <Card className="divide-y divide-line/40 p-0">
        {s.players.length === 0 && <p className="p-4 text-sm text-muted">{t("showdown.noPlayers")}</p>}
        {s.players.slice(0, compact ? 8 : undefined).map((p) => (
          <div key={p.userId} className={`flex items-center gap-3 px-4 py-2 ${p.me ? "bg-gold/10" : ""}`}>
            <span
              className={`num w-6 font-display text-lg font-bold ${p.rank === 1 && p.points > 0 ? "text-gold" : ""}`}
            >
              {p.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {p.displayName}
                {p.isHost && (
                  <span className="ml-1.5 text-xs font-normal text-muted">{t("showdown.hostTag")}</span>
                )}
              </p>
              <p className="truncate text-xs text-muted">
                {p.horseName}
                {!compact &&
                  ` · ~${t("unit.m", { n: p.optimalDistance })} · ${titleCase(p.favouriteSurface)}`}
                {s.mode === "NORMAL" && ` · ${t("showdown.fatigue", { n: p.fatigue })}`}
              </p>
            </div>
            <div className="text-right">
              <p className="num font-display text-lg font-bold">{p.points}</p>
              <p className="num text-[10px] text-muted">
                {p.wins > 0 && (
                  <>
                    <Trophy className="inline size-3 text-gold" aria-hidden /> {p.wins} ·{" "}
                  </>
                )}
                {t("showdown.racesRun", { n: p.races })}
              </p>
            </div>
            {!compact && s.isHost && !p.isHost && s.status === "OPEN" && (
              <button
                onClick={() => void kick(p.userId, p.displayName)}
                aria-label={t("showdown.kick", { name: p.displayName })}
                className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:text-bad"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

/** Past races with the players' finishing order. */
export function PastRaces({ s }: { s: ShowdownDto }) {
  const done = s.races.filter((r) => r.status === "COMPLETED" && r.results);
  if (!done.length) return null;
  return (
    <>
      <SectionTitle>{t("showdown.results")}</SectionTitle>
      <Card className="space-y-3">
        {done.map((r) => (
          <div key={r.id}>
            <p className="text-sm font-semibold">{raceLine(r)}</p>
            <p className="text-xs text-muted">
              {r.results!.map((x, i) => (
                <span key={x.displayName}>
                  {i > 0 && " · "}
                  {x.position}. {x.displayName} (+{x.points})
                </span>
              ))}
            </p>
          </div>
        ))}
      </Card>
    </>
  );
}
