import { SILK_COLORS, type Silks } from "@thoroughline/contracts";
import { useId } from "react";

/**
 * Racing-silk marks drawn inside a circle (cx, cy, r). Used for the live-race markers and the
 * standalone <Silk> badge, so a stable looks the same everywhere.
 */
export function SilkMarks({
  silks,
  cx,
  cy,
  r,
  clipId,
}: {
  silks: Silks;
  cx: number;
  cy: number;
  r: number;
  clipId: string;
}) {
  const a = SILK_COLORS[silks.primary];
  const b = SILK_COLORS[silks.secondary];
  const x0 = cx - r;
  const y0 = cy - r;
  const d = r * 2;
  let marks: React.ReactNode = null;
  switch (silks.pattern) {
    case "HOOPS":
      marks = [0.18, 0.5, 0.82].map((f) => (
        <rect key={f} x={x0} y={y0 + d * f - d * 0.08} width={d} height={d * 0.16} fill={b} />
      ));
      break;
    case "SASH":
      marks = (
        <polygon
          points={`${x0},${y0 + d * 0.2} ${x0 + d * 0.2},${y0} ${x0 + d},${y0 + d * 0.8} ${x0 + d * 0.8},${y0 + d}`}
          fill={b}
        />
      );
      break;
    case "QUARTERED":
      marks = (
        <>
          <rect x={cx} y={y0} width={r} height={r} fill={b} />
          <rect x={x0} y={cy} width={r} height={r} fill={b} />
        </>
      );
      break;
    case "DIAMONDS":
      marks = [
        [0.3, 0.3],
        [0.7, 0.3],
        [0.5, 0.55],
        [0.3, 0.8],
        [0.7, 0.8],
      ].map(([fx, fy]) => {
        const x = x0 + d * fx!;
        const y = y0 + d * fy!;
        const s = d * 0.13;
        return (
          <polygon
            key={`${fx}-${fy}`}
            points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`}
            fill={b}
          />
        );
      });
      break;
    case "STAR": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r * 0.72 : r * 0.3;
        return `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
      }).join(" ");
      marks = <polygon points={pts} fill={b} />;
      break;
    }
    default:
      marks = null;
  }
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={a} />
      <g clipPath={`url(#${clipId})`}>{marks}</g>
    </>
  );
}

/** Round silk badge. Solid silks get a ring in the secondary colour so both colours show. */
export function Silk({ silks, size = 28, title }: { silks: Silks; size?: number; title?: string }) {
  const id = useId().replace(/:/g, "");
  const r = 50;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? "Racing silks"}
      className="shrink-0"
    >
      <SilkMarks silks={silks} cx={50} cy={50} r={r - 4} clipId={`silk-${id}`} />
      <circle
        cx={50}
        cy={50}
        r={r - 4}
        fill="none"
        stroke={SILK_COLORS[silks.secondary]}
        strokeWidth={silks.pattern === "SOLID" ? 8 : 3}
      />
    </svg>
  );
}
