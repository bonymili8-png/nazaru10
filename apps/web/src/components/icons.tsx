import type { SVGProps } from "react";

/** Horse-head glyph drawn to match lucide's 24px / 2px-stroke style. */
export function HorseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M8 21v-5.5c-2-1-3.5-3-3.5-5.5 0-4 3-7 7-7.5l1-2 1.5 2.5c3 1 5.5 4 6 8l1.5 3-2 1.5-2.5-1.5-2 1.5v6.5" />
      <path d="M14 8.5h.01" />
    </svg>
  );
}
