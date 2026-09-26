import { type SaddleCloth as Cloth, SILK_COLORS } from "@thoroughline/contracts";
import { useId } from "react";

/** A saddle cloth (60×40 box): cloth colour, pattern in the trim colour, trim border. */
export function SaddleCloth({
  cloth,
  width = 48,
  label,
  title,
}: {
  cloth: Cloth;
  width?: number;
  /** Optional text on the cloth (e.g. the horse's initial or gate number). */
  label?: string;
  title?: string;
}) {
  const clip = useId();
  const base = SILK_COLORS[cloth.color];
  const trim = SILK_COLORS[cloth.trim];
  return (
    <svg
      viewBox="0 0 60 40"
      width={width}
      height={(width * 40) / 60}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className="shrink-0"
    >
      <defs>
        <clipPath id={clip}>
          <path d="M4 3H56Q58 3 58 5V29Q58 37 50 37H10Q2 37 2 29V5Q2 3 4 3Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width={60} height={40} fill={base} />
        {cloth.pattern === "STRIPE" && <path d="M-4 40L28 0H40L8 40Z" fill={trim} opacity={0.9} />}
        {cloth.pattern === "CHECK" &&
          [0, 1, 2, 3, 4, 5].flatMap((i) =>
            [0, 1, 2, 3].map((j) =>
              (i + j) % 2 ? (
                <rect key={`${i}${j}`} x={i * 10} y={j * 10} width={10} height={10} fill={trim} />
              ) : null,
            ),
          )}
        {cloth.pattern === "STARS" &&
          [
            [12, 12],
            [30, 24],
            [48, 12],
          ].map(([x, y]) => (
            <path
              key={`${x}`}
              transform={`translate(${x! - 6} ${y! - 6}) scale(0.5)`}
              d="M12 2L14.9 8.6L22 9.3L16.6 14L18.2 21L12 17.3L5.8 21L7.4 14L2 9.3L9.1 8.6Z"
              fill={trim}
            />
          ))}
      </g>
      <path
        d="M4 3H56Q58 3 58 5V29Q58 37 50 37H10Q2 37 2 29V5Q2 3 4 3Z"
        fill="none"
        stroke={trim}
        strokeWidth={3}
      />
      {label && (
        <text
          x={30}
          y={22}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={17}
          fontWeight={800}
          fill={trim}
          stroke={base}
          strokeWidth={3}
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </svg>
  );
}
