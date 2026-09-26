"use client";
import type { LiveRaceDto, RaceDetailDto } from "@thoroughline/contracts";
import { trackByCode } from "@thoroughline/engine";
import { Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmt, ordinal, STRATEGY_INFO } from "@/lib/format";
import { t as tr } from "@/lib/i18n";
import { commentaryText } from "@/lib/i18n/commentary";
import { ovalBounds, ovalPoint } from "@/lib/oval";
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
        setLive(d);
        if (d.status !== "COMPLETED" && d.status !== "CANCELLED") timer = setTimeout(poll, 2000);
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
  const playT = Math.max(0, Math.min(t, (frames.data.length - 1) * frames.interval));
  const pos = sample(frames.data, frames.interval, playT);
  const LANE = 6;
  const b = ovalBounds(track, 14 * LANE);
  const lanePath = (lane: number) => {
    const pts: string[] = [];
    const C = 2 * track.turnLength + 2 * track.straightLength;
    for (let d = 0; d <= C; d += C / 120) {
      const p = ovalPoint(track, C, d, lane, LANE);
      pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    return `M${pts.join("L")}Z`;
  };
  const finish = ovalPoint(track, race.distance, race.distance, 0, LANE);
  const order = pos ? frames.ids.map((id, i) => ({ id, i, x: pos[i]![0] })).sort((p, q) => q.x - p.x) : [];
  const commentary = (replayStart !== null ? [] : live.commentary).slice(-3).reverse();
  const done = live.status === "COMPLETED" && playT >= (frames.data.length - 1) * frames.interval;

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
      <Card className="p-2">
        <svg
          viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
          className="w-full"
          role="img"
          aria-label={tr("live.trackLabel", { name: (order[0] && names[order[0].id]?.horseName) ?? "" })}
        >
          <path d={lanePath(5.5)} fill="none" stroke="#1f3a24" strokeWidth={13 * LANE} />
          <path d={lanePath(-1)} fill="none" stroke="#78716c" strokeWidth={2} />
          <path d={lanePath(12)} fill="none" stroke="#78716c" strokeWidth={2} />
          <line
            x1={finish.x}
            y1={finish.y - LANE}
            x2={finish.x}
            y2={finish.y + 12 * LANE}
            stroke="#e0b43a"
            strokeWidth={5}
          />
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
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={e?.mine ? 17 : 14}
                  fill="none"
                  stroke={e?.mine ? "#fafaf9" : "#0c0a09"}
                  strokeWidth={e?.mine ? 5 : 2.5}
                />
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
