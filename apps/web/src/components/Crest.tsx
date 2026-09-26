import {
  type Crest as CrestSpec,
  type CrestIcon,
  type CrestShape,
  SILK_COLORS,
} from "@thoroughline/contracts";
import type { ReactElement } from "react";

/** Outline of each crest shape in a 48×56 box. */
const SHAPES: Record<CrestShape, string> = {
  SHIELD: "M5 4H43V26C43 40 34 48 24 53C14 48 5 40 5 26Z",
  ROUND: "M24 5A22 22 0 1 1 23.99 5Z",
  DIAMOND: "M24 3L45 28L24 53L3 28Z",
  BANNER: "M6 3H42V52L24 43L6 52Z",
};

/** Emblems drawn in a 24×24 box, filled with the charge colour (`f`) over the field (`b`). */
const ICONS: Record<CrestIcon, (f: string, b: string) => ReactElement> = {
  HORSESHOE: (f) => (
    <g fill="none" stroke={f} strokeWidth={3.4} strokeLinecap="round">
      <path d="M6 3.5V11A6 6 0 0 0 18 11V3.5" />
      <path d="M4.2 3.5H7.8M16.2 3.5H19.8" strokeWidth={2.4} />
    </g>
  ),
  STAR: (f) => (
    <path fill={f} d="M12 2L14.9 8.6L22 9.3L16.6 14L18.2 21L12 17.3L5.8 21L7.4 14L2 9.3L9.1 8.6Z" />
  ),
  CRESCENT: (f) => <path fill={f} d="M15 2.5A9.5 9.5 0 1 0 15 21.5A7.6 7.6 0 1 1 15 2.5Z" />,
  CROWN: (f) => (
    <g fill={f}>
      <path d="M3 17L3.8 6.5L8.6 11.2L12 4.5L15.4 11.2L20.2 6.5L21 17Z" />
      <rect x={3} y={18.3} width={18} height={2.7} rx={0.8} />
    </g>
  ),
  LIGHTNING: (f) => <path fill={f} d="M13.5 2L5 13.2H11L9.8 22L19 10.2H13Z" />,
  CLOVER: (f) => (
    <g fill={f}>
      <circle cx={12} cy={7.2} r={4.3} />
      <circle cx={12} cy={16.2} r={4.3} />
      <circle cx={7.5} cy={11.7} r={4.3} />
      <circle cx={16.5} cy={11.7} r={4.3} />
      <path d="M12 16L14.5 22.5" stroke={f} strokeWidth={1.8} strokeLinecap="round" />
    </g>
  ),
  GEM: (f, b) => (
    <g>
      <path fill={f} d="M6.5 4H17.5L22 9.5L12 21L2 9.5Z" />
      <path
        d="M2 9.5H22M9 4L7.5 9.5L12 21L16.5 9.5L15 4"
        fill="none"
        stroke={b}
        strokeWidth={1}
        opacity={0.6}
      />
    </g>
  ),
  LAUREL: (f) => (
    <g fill={f}>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (200 - i * 26) * (Math.PI / 180);
        const x = 12 + Math.cos(a) * 8;
        const y = 12 - Math.sin(a) * 8;
        const deg = 90 - (200 - i * 26);
        return (
          <g key={i}>
            <ellipse cx={x} cy={y} rx={1.7} ry={3.2} transform={`rotate(${deg + 35} ${x} ${y})`} />
            <ellipse cx={24 - x} cy={y} rx={1.7} ry={3.2} transform={`rotate(${-deg - 35} ${24 - x} ${y})`} />
          </g>
        );
      })}
    </g>
  ),
};

/** A stable's crest (shape, emblem and two colours). Purely cosmetic. */
export function Crest({ crest, size = 40, title }: { crest: CrestSpec; size?: number; title?: string }) {
  const field = SILK_COLORS[crest.field];
  const charge = SILK_COLORS[crest.charge];
  return (
    <svg
      viewBox="0 0 48 56"
      width={size}
      height={(size * 56) / 48}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className="shrink-0"
    >
      <path d={SHAPES[crest.shape]} fill={field} stroke={charge} strokeWidth={2.5} strokeLinejoin="round" />
      <g transform="translate(12 15)">{ICONS[crest.icon](charge, field)}</g>
    </svg>
  );
}
