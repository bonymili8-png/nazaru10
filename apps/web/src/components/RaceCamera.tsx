"use client";
import { type RaceDetailDto, SILK_COLORS } from "@thoroughline/contracts";
import { fmt } from "@/lib/format";
import { t as tr } from "@/lib/i18n";
import { SilkMarks } from "./Silk";

type Frame = [number, number, number, number];
type Entry = RaceDetailDto["entryList"][number];

/** Metres of track in shot: the leader sits near the right edge with the field trailing left. */
const BEHIND = 44;
const AHEAD = 6;
const W = 400;
const H = 190;
const LEFT = 20;
const RIGHT = W - 14;
const PX_PER_M = (RIGHT - LEFT) / (BEHIND + AHEAD);
/** Lanes run from the inside rail (top) outwards; the field rarely drifts past lane 12. */
const TOP = 34;
const LANE_PX = 10.5;
const laneY = (lane: number) => TOP + 8 + Math.max(0, Math.min(12, lane)) * LANE_PX;

/**
 * Side-on "camera" that follows the leader, like a TV tracking shot: every runner within the
 * shot is placed by its real gap (metres) and lane, rail posts and furlong poles stream past,
 * and anyone who has dropped out of shot is counted at the left edge with how far back they are.
 */
export function RaceCamera({
  pos,
  ids,
  names,
  distance,
  fallback,
}: {
  pos: Frame[];
  ids: string[];
  names: Record<string, Entry>;
  distance: number;
  fallback: (i: number) => string;
}) {
  // No runners in the frame yet (first poll): nothing to film. Guards the post loop below.
  if (pos.length === 0) return null;
  const leader = Math.max(...pos.map((p) => p[0]));
  if (!Number.isFinite(leader)) return null;
  const toX = (x: number) => RIGHT - (leader + AHEAD - x) * PX_PER_M;
  const inShot = pos.map((p, i) => ({ p, i })).filter(({ p }) => leader - p[0] <= BEHIND);
  const outOfShot = pos.filter((p) => leader - p[0] > BEHIND);
  const worstGap = outOfShot.length ? Math.round(leader - Math.min(...outOfShot.map((p) => p[0]))) : 0;
  const toGo = Math.max(0, Math.round(distance - leader));

  // Rail posts every 5 m and marker poles every 100 m, in track coordinates so they stream past.
  const posts: number[] = [];
  for (let d = Math.ceil((leader - BEHIND - 5) / 5) * 5; d <= leader + AHEAD + 5; d += 5) posts.push(d);
  const poles = posts.filter((d) => d > 0 && d < distance && (distance - d) % 100 === 0);
  const finishX = toX(distance);
  const finishInShot = finishX >= LEFT - 4 && finishX <= RIGHT + 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={tr("live.cameraLabel")}>
      {/* Turf band with mowing stripes that move with the field. */}
      <rect x={0} y={TOP} width={W} height={H - TOP - 10} fill="#1f3a24" />
      {posts
        .filter((d) => d % 10 === 0)
        .map((d) => (
          <rect key={`s${d}`} x={toX(d)} y={TOP} width={5 * PX_PER_M} height={H - TOP - 10} fill="#23422a" />
        ))}
      {/* Inside rail with posts. */}
      <line x1={0} y1={TOP} x2={W} y2={TOP} stroke="#d6d3d1" strokeWidth={2.5} />
      {posts.map((d) => (
        <line
          key={`p${d}`}
          x1={toX(d)}
          y1={TOP - 7}
          x2={toX(d)}
          y2={TOP}
          stroke="#a8a29e"
          strokeWidth={1.5}
        />
      ))}
      {poles.map((d) => (
        <g key={`m${d}`}>
          <line x1={toX(d)} y1={TOP - 18} x2={toX(d)} y2={TOP} stroke="#fafaf9" strokeWidth={2.5} />
          <text x={toX(d)} y={TOP - 21} textAnchor="middle" fontSize={10} fill="#fafaf9">
            {tr("unit.m", { n: fmt(distance - d) })}
          </text>
        </g>
      ))}
      {finishInShot && (
        <g>
          <line x1={finishX} y1={TOP - 20} x2={finishX} y2={H - 10} stroke="#e0b43a" strokeWidth={3} />
          <text x={finishX} y={TOP - 23} textAnchor="middle" fontSize={11} fontWeight={700} fill="#e0b43a">
            {tr("live.finish")}
          </text>
        </g>
      )}
      <line x1={0} y1={H - 10} x2={W} y2={H - 10} stroke="#78716c" strokeWidth={1.5} />

      {/* Runners, back to front so the leaders are drawn on top. */}
      {inShot
        .sort((a, b) => a.p[0] - b.p[0])
        .map(({ p, i }) => {
          const e = names[ids[i]!];
          const x = toX(p[0]);
          const y = laneY(p[1]);
          const r = e?.mine ? 11 : 9;
          return (
            <g key={ids[i]}>
              {e?.silks ? (
                <SilkMarks silks={e.silks} cx={x} cy={y} r={r} clipId={`cam-${i}`} />
              ) : (
                <circle cx={x} cy={y} r={r} fill={fallback(i)} />
              )}
              <circle
                cx={x}
                cy={y}
                r={r}
                fill="none"
                stroke={e?.cloth ? SILK_COLORS[e.cloth.color] : e?.mine ? "#fafaf9" : "#0c0a09"}
                strokeWidth={e?.mine ? 3.5 : 2}
              />
              {e?.mine && (
                <text x={x} y={y - r - 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fafaf9">
                  {e.horseName.length > 14 ? `${e.horseName.slice(0, 13)}…` : e.horseName}
                </text>
              )}
            </g>
          );
        })}

      {/* Out of shot: how many, and how far back the last one is. */}
      {outOfShot.length > 0 &&
        (() => {
          const label = tr("live.outOfShot", { n: outOfShot.length, m: worstGap });
          return (
            <g>
              <rect
                x={2}
                y={H - 30}
                width={12 + label.length * 5.6}
                height={16}
                rx={4}
                fill="#0c0a09"
                opacity={0.75}
              />
              <text x={8} y={H - 18.5} fontSize={10} fill="#d6d3d1">
                {label}
              </text>
            </g>
          );
        })()}
      {/* Distance to go, bottom right (the top edge belongs to the marker poles). */}
      {(() => {
        const label = toGo > 0 ? tr("live.toGo", { m: fmt(toGo) }) : tr("live.finish");
        const w = 12 + label.length * 5.6;
        return (
          <g>
            <rect x={W - 2 - w} y={H - 30} width={w} height={16} rx={4} fill="#0c0a09" opacity={0.75} />
            <text x={W - 8} y={H - 18.5} textAnchor="end" fontSize={10} fill="#d6d3d1">
              {label}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}
