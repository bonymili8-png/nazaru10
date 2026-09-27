"use client";
import type { FinishEffect as Effect } from "@thoroughline/contracts";
import type { CSSProperties, ReactNode } from "react";

/** Deterministic pseudo-random in [0, 1) so the effect renders the same on every client. */
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const CONFETTI = ["#e0b43a", "#f87171", "#4ade80", "#60a5fa", "#fafaf9", "#c084fc"];

function falling(n: number, draw: (i: number) => ReactNode, style: (i: number) => CSSProperties) {
  return Array.from({ length: n }, (_, i) => (
    <span
      key={i}
      style={{
        left: `${rnd(i, 1) * 100}%`,
        top: 0,
        animationName: "fx-fall",
        animationDuration: `${1.8 + rnd(i, 2) * 1.6}s`,
        animationDelay: `${rnd(i, 3) * 0.9}s`,
        animationTimingFunction: "cubic-bezier(0.3, 0.1, 0.6, 1)",
        ["--dx" as string]: `${(rnd(i, 4) - 0.5) * 120}px`,
        ["--spin" as string]: `${(rnd(i, 5) - 0.5) * 900}deg`,
        ...style(i),
      }}
    >
      {draw(i)}
    </span>
  ));
}

function fireworks() {
  const bursts = [
    { x: 25, y: 30, c: "#e0b43a", d: 0 },
    { x: 70, y: 22, c: "#f87171", d: 0.45 },
    { x: 50, y: 55, c: "#60a5fa", d: 0.9 },
    { x: 82, y: 60, c: "#4ade80", d: 1.3 },
  ];
  return bursts.flatMap((b, k) =>
    Array.from({ length: 14 }, (_, i) => (
      <span
        key={`${k}-${i}`}
        style={{
          left: `${b.x}%`,
          top: `${b.y}%`,
          width: 6,
          height: 6,
          borderRadius: 9999,
          background: b.c,
          boxShadow: `0 0 8px ${b.c}`,
          animationName: "fx-spark",
          animationDuration: "1.3s",
          animationDelay: `${b.d}s`,
          animationTimingFunction: "cubic-bezier(0.1, 0.7, 0.3, 1)",
          ["--a" as string]: `${(360 / 14) * i}deg`,
          ["--r" as string]: `${55 + rnd(i + k * 20, 6) * 35}px`,
        }}
      />
    )),
  );
}

function lightning() {
  return [
    <span
      key="flash"
      style={{ inset: 0, background: "#fafaf9", animationName: "fx-flash", animationDuration: "1.4s" }}
    />,
    ...[18, 58, 84].map((x, k) => (
      <svg
        key={x}
        viewBox="0 0 24 60"
        width={34}
        height={86}
        style={{
          left: `${x}%`,
          top: `${8 + k * 6}%`,
          animationName: "fx-flash",
          animationDuration: "1.4s",
          animationDelay: `${k * 0.15}s`,
          filter: "drop-shadow(0 0 6px #fde68a)",
        }}
        aria-hidden
      >
        <path d="M14 0L3 32H11L7 60L22 22H13L18 0Z" fill="#fde68a" />
      </svg>
    )),
  ];
}

/**
 * The winner's celebration, drawn over the race picture once. Remount (change `key`) to replay.
 * Purely cosmetic and silent; nothing is shown under reduced motion.
 */
export function FinishEffect({ effect }: { effect: Effect }) {
  if (effect === "NONE") return null;
  const particles =
    effect === "CONFETTI"
      ? falling(
          46,
          () => null,
          (i) => ({
            width: 7,
            height: 11,
            borderRadius: 2,
            background: CONFETTI[i % CONFETTI.length],
          }),
        )
      : effect === "GOLD_RAIN"
        ? falling(
            38,
            () => null,
            (i) => ({
              width: 12,
              height: 12,
              borderRadius: 9999,
              background: "radial-gradient(circle at 35% 35%, #fde68a, #e0b43a 55%, #a16207)",
              boxShadow: "0 0 6px rgba(224,180,58,0.7)",
              transform: `scale(${0.7 + rnd(i, 7) * 0.6})`,
            }),
          )
        : effect === "ROSES"
          ? falling(
              30,
              () => null,
              (i) => ({
                width: 12,
                height: 16,
                borderRadius: "80% 0 80% 0",
                background: i % 3 ? "#e11d48" : "#fb7185",
              }),
            )
          : effect === "FIREWORKS"
            ? fireworks()
            : lightning();
  return (
    <div className="fx" aria-hidden data-effect={effect}>
      {particles}
    </div>
  );
}
