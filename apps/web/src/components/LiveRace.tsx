"use client";
import { type LiveRaceDto, type RaceDetailDto, SILK_COLORS } from "@thoroughline/contracts";
import { trackByCode } from "@thoroughline/engine";
import { Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmt, ordinal, STRATEGY_INFO } from "@/lib/format";
import { t as tr } from "@/lib/i18n";
import { commentaryText } from "@/lib/i18n/commentary";
import { ovalBounds, ovalPoint } from "@/lib/oval";
import { FinishEffect } from "./FinishEffect";
import { SilkMarks } from "./Silk";
import { Button, Card, SectionTitle } from "./ui";

const SILKS = [
  "#e0b43a",
  "#60a5fa",
  "#f87171",
  "#4ade80",
  "#c084fc",
  "#fb923c",
  "#2dd4bf",
  "#f472b6",
  "#a3e635",
  "#e5e7eb",
  "#facc15",
  "#38bdf8",
];

type Frame = [number, number, number, number];

/**
 * Frames reach the client in real time (polled every POLL_MS), so the live view plays this far
 * behind the broadcast clock: the next frame is always already here and motion stays smooth.
 */
const POLL_MS = 2000;
const liveDelay = (interval: number) => interval + POLL_MS / 1000 + 0.5;
/**
 * A viewer who arrives within this many seconds of the off (or is waiting at the gates) sees the
 * race from the start: playback begins at 0 and runs CATCH_UP× fast until it meets the live
 * picture. Later arrivals join live, so nobody sits through a long catch-up.
 */
const FROM_START_WITHIN = 20;
const CATCH_UP = 1.25;

/** Interpolated runner positions at time t (seconds) from 1-second frames. */
function sample(frames: Frame[][], interval: number, t: number): Frame[] | null {
  if (frames.length === 0) return null;
  const f = Math.max(0, t / interval);
  const k = Math.min(frames.length - 1, Math.floor(f));
  const a = frames[k]!;
  const b = frames[Math.min(frames.length - 1, k + 1)]!;
  const u = Math.min(1, f - k);
  return a.map((ra, i) => {
    const rb = b[i]!;
    return [ra[0] + (rb[0] - ra[0]) * u, ra[1] + (rb[1] - ra[1]) * u, ra[2], ra[3]] as Frame;
  });
}

export function LiveRace({ race }: { race: RaceDetailDto }) {
  const [live, setLive] = useState<LiveRaceDto | null>(null);
  const [replayStart, setReplayStart] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const offsetRef = useRef(0);
  /** Wall-clock ms when playback from the start began (null: follow the live picture). */
  const fromStartRef = useRef<number | null>(null);
  const decidedRef = useRef(false);
  const track = useMemo(() => trackByCode(race.trackCode), [race.trackCode]);
  const startMs = new Date(race.startsAt).getTime();

  // Poll the server while the race is being broadcast; frames arrive in real time.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api<LiveRaceDto>(`/races/${race.id}/live`);
        if (stop) return;
        offsetRef.current = d.elapsed - (Date.now() - startMs) / 1000;
        // First frames of a running race: decide once whether to show it from the gates.
        if (!decidedRef.current && d.frames && d.status === "RUNNING") {
          decidedRef.current = true;
          if (d.elapsed <= FROM_START_WITHIN) fromStartRef.current = Date.now();
        }
        if (d.status === "COMPLETED" && !d.frames) decidedRef.current = true;
        setLive(d);
        if (d.status !== "COMPLETED" && d.status !== "CANCELLED") timer = setTimeout(poll, POLL_MS);
      } catch {
        if (!stop) timer = setTimeout(poll, 4000);
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [race.id, startMs]);

  // Animation clock.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = Date.now();
      setT(replayStart !== null ? (now - replayStart) / 1000 : (now - startMs) / 1000 + offsetRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replayStart, startMs]);

  const names = useMemo(
    () => Object.fromEntries(race.entryList.map((e) => [e.horseId, e])),
    [race.entryList],
  );
  if (!live?.frames) {
    return <Card className="mt-4 text-center text-sm text-muted">{tr("live.gates")}</Card>;
  }

  const frames = live.frames;
  const available = (frames.data.length - 1) * frames.interval;
  const liveT = t - liveDelay(frames.interval);
  const catchUpT =
    replayStart === null && fromStartRef.current !== null
      ? ((Date.now() - fromStartRef.current) / 1000) * CATCH_UP
      : Infinity;
  const playT = Math.max(0, Math.min(replayStart !== null ? t : Math.min(liveT, catchUpT), available));
  const pos = sample(frames.data, frames.interval, playT);
  const LANE = 6;
  const b = ovalBounds(track, 26 * LANE);
  const lanePath = (lane: number) => {
    const pts: string[] = [];
    const C = 2 * track.turnLength + 2 * track.straightLength;
    for (let d = 0; d <= C; d += C / 120) {
      const p = ovalPoint(track, C, d, lane, LANE);
      pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    return `M${pts.join("L")}Z`;
  };
  /** A line across the track at a race distance, and where its label goes (outside the rail). */
  const marker = (progress: number) => ({
    a: ovalPoint(track, race.distance, progress, -1.5, LANE),
    b: ovalPoint(track, race.distance, progress, 12.5, LANE),
    label: ovalPoint(track, race.distance, progress, 19, LANE),
  });
  const lap = 2 * track.turnLength + 2 * track.straightLength;
  const startOnFinish = Math.min(race.distance % lap, lap - (race.distance % lap)) < 60;
  const start = marker(0);
  const finish = marker(race.distance);
  const order = pos ? frames.ids.map((id, i) => ({ id, i, x: pos[i]![0] })).sort((p, q) => q.x - p.x) : [];
  // Commentary follows the (slightly delayed) picture, never ahead of it.
  const commentary = (replayStart !== null ? [] : live.commentary.filter((c) => c.t <= playT))
    .slice(-3)
    .reverse();
  const done = live.status === "COMPLETED" && playT >= available;
  // The winner's owner-chosen celebration plays once the picture reaches the finish.
  const winnerEffect = live.results?.find((r) => r.position === 1)?.finishEffect ?? null;

  return (
    <>
      <SectionTitle
        action={
          live.status === "COMPLETED" && (
            <Button variant="ghost" className="min-h-9 text-sm" onClick={() => setReplayStart(Date.now())}>
              <Play className="size-4" aria-hidden />
              {tr("live.replay")}
            </Button>
          )
        }
      >
        {live.status === "RUNNING" ? tr("live.live") : tr("live.replay")}
      </SectionTitle>
      <Card className="relative p-2">
        {done && winnerEffect && <FinishEffect key={replayStart ?? "live"} effect={winnerEffect} />}
        <svg
          viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
          className="w-full"
          role="img"
          aria-label={tr("live.trackLabel", { name: (order[0] && names[order[0].id]?.horseName) ?? "" })}
        >
          <path d={lanePath(5.5)} fill="none" stroke="#1f3a24" strokeWidth={13 * LANE} />
          <path d={lanePath(-1)} fill="none" stroke="#78716c" strokeWidth={2} />
          <path d={lanePath(12)} fill="none" stroke="#78716c" strokeWidth={2} />
          {!startOnFinish && (
            <g>
              <line
                x1={start.a.x}
                y1={start.a.y}
                x2={start.b.x}
                y2={start.b.y}
                stroke="#fafaf9"
                strokeWidth={4}
                strokeDasharray="7 5"
              />
              <text
                x={start.label.x}
                y={start.label.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={22}
                fontWeight={600}
                fill="#fafaf9"
              >
                {tr("live.start")}
              </text>
            </g>
          )}
          <line
            x1={finish.a.x}
            y1={finish.a.y}
            x2={finish.b.x}
            y2={finish.b.y}
            stroke="#e0b43a"
            strokeWidth={5}
          />
          <text
            x={finish.label.x}
            y={finish.label.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={22}
            fontWeight={600}
            fill="#e0b43a"
          >
            {startOnFinish ? tr("live.startFinish") : tr("live.finish")}
          </text>
          {pos?.map((r, i) => {
            const p = ovalPoint(track, race.distance, r[0], r[1], LANE);
            const e = names[frames.ids[i]!];
            return (
              <g key={frames.ids[i]}>
                {e?.silks ? (
                  <SilkMarks silks={e.silks} cx={p.x} cy={p.y} r={e.mine ? 17 : 14} clipId={`lr-${i}`} />
                ) : (
                  <circle cx={p.x} cy={p.y} r={14} fill={SILKS[i % SILKS.length]} />
                )}
                {/* Ring in the horse's saddle-cloth colour; the viewer's runners get an extra white halo. */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={e?.mine ? 17 : 14}
                  fill="none"
                  stroke={e?.cloth ? SILK_COLORS[e.cloth.color] : e?.mine ? "#fafaf9" : "#0c0a09"}
                  strokeWidth={e?.cloth ? 4.5 : e?.mine ? 5 : 2.5}
                />
                {e?.mine && e.cloth && (
                  <circle cx={p.x} cy={p.y} r={21} fill="none" stroke="#fafaf9" strokeWidth={2.5} />
                )}
                {!e?.silks && (
                  <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize={15} fontWeight={700} fill="#0c0a09">
                    {e?.gate ?? i + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="flex items-center justify-between px-2 pb-1 text-xs text-muted">
          <span className="num">{tr("live.sec", { n: playT.toFixed(1) })}</span>
          <span className="num">
            {tr("unit.m", { n: Math.round(order[0] ? Math.min(race.distance, pos![order[0].i]![0]) : 0) })} /{" "}
            {tr("unit.m", { n: race.distance })}
          </span>
        </div>
      </Card>

      {!done && (
        <Card className="mt-2 p-3">
          <ol className="flex gap-2 overflow-x-auto text-xs" aria-label={tr("live.order")}>
            {order.slice(0, 6).map((o, k) => (
              <li
                key={o.id}
                className={`shrink-0 rounded-lg px-2 py-1 ${names[o.id]?.mine ? "bg-gold/20 text-gold" : "bg-surface-2"}`}
              >
                <span className="num font-bold">{k + 1}</span> {names[o.id]?.horseName}
              </li>
            ))}
          </ol>
          <ul className="mt-2 space-y-1 text-sm" aria-live="polite">
            {commentary.map((c) => (
              <li
                key={`${c.t}${c.text}`}
                className="text-ink first:font-medium [&:not(:first-child)]:text-muted"
              >
                {commentaryText(c)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {done && live.results && (
        <>
          <SectionTitle>{tr("race.result")}</SectionTitle>
          <Card className="divide-y divide-line/40 p-0">
            {live.results.map((r) => (
              <div
                key={r.horseId}
                className={`flex items-center gap-3 px-4 py-2.5 ${r.mine ? "bg-gold/10" : ""}`}
              >
                <span
                  className={`num w-10 font-display text-lg font-bold ${r.position === 1 ? "text-gold" : ""}`}
                >
                  {r.position ? ordinal(r.position) : "—"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.horseName}</p>
                  <p className="truncate text-xs text-muted">
                    {r.isHouse ? tr("common.house") : r.ownerName} · {r.jockeyName} ·{" "}
                    {r.strategy ? STRATEGY_INFO[r.strategy]!.label : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num text-sm">
                    {r.position === 1
                      ? tr("live.sec", { n: r.finishTime?.toFixed(2) ?? "" })
                      : tr("live.lengths", { n: r.lengthsBehind?.toFixed(1) ?? "" })}
                  </p>
                  {!!r.prize && !r.isHouse && <p className="num text-xs text-good">+{fmt(r.prize)}</p>}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
