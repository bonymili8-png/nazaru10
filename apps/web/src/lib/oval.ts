import type { TrackDef } from "@thoroughline/engine";

/**
 * Map race progress (metres) + lane to 2-D track coordinates, matching the engine's oval
 * model: finish at the end of the home straight (bottom), running counter-clockwise on screen.
 */
export function ovalPoint(
  track: TrackDef,
  distance: number,
  progress: number,
  lane: number,
  laneScale = 2.2,
): { x: number; y: number } {
  const T = track.turnLength;
  const S = track.straightLength;
  const R = T / Math.PI;
  const C = 2 * T + 2 * S;
  const start = (((C - (distance % C)) % C) + C) % C;
  const p = (start + progress) % C;
  const off = lane * laneScale;
  if (p < T) {
    const a = Math.PI / 2 - Math.PI * (p / T);
    return { x: S / 2 + (R + off) * Math.cos(a), y: (R + off) * Math.sin(a) };
  }
  if (p < T + S) return { x: S / 2 - (p - T), y: -(R + off) };
  if (p < 2 * T + S) {
    const a = -Math.PI / 2 - Math.PI * ((p - T - S) / T);
    return { x: -S / 2 + (R + off) * Math.cos(a), y: (R + off) * Math.sin(a) };
  }
  return { x: -S / 2 + (p - 2 * T - S), y: R + off };
}

export function ovalBounds(track: TrackDef, margin = 30) {
  const R = track.turnLength / Math.PI;
  const w = track.straightLength + 2 * R + 2 * margin;
  const h = 2 * R + 2 * margin;
  return { x: -w / 2, y: -h / 2, w, h, R };
}
