import type { HorseSummaryDto } from "@thoroughline/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { fmt, titleCase } from "@/lib/format";
import { Badge } from "./ui";

const RARITY_TONE: Record<string, "neutral" | "gold" | "good" | "warn"> = {
  COMMON: "neutral",
  UNCOMMON: "good",
  RARE: "warn",
  EPIC: "gold",
  LEGENDARY: "gold",
};

const STATUS_TONE: Record<string, "neutral" | "gold" | "good" | "warn" | "bad"> = {
  IDLE: "good",
  TRAINING: "warn",
  ENTERED: "gold",
  RACING: "gold",
  INJURED: "bad",
  LISTED: "neutral",
  BREEDING: "gold",
  RETIRED: "neutral",
};

/** Silks colour derived from the coat: gives every horse a consistent visual identity. */
export const coatColor = (coat: string) =>
  ({
    BAY: "#8b4513",
    DARK_BAY: "#4a2511",
    CHESTNUT: "#b5541c",
    GREY: "#9ca3af",
    BLACK: "#1f1f1f",
    ROAN: "#a0716b",
    PALOMINO: "#d9b36c",
    DAPPLE_GREY: "#c7cbd1",
  })[coat] ?? "#8b4513";

export function HorseCard({
  horse,
  href,
  extra,
}: {
  horse: HorseSummaryDto;
  href?: string;
  extra?: React.ReactNode;
}) {
  const body = (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line/60 bg-surface p-3.5 transition-colors hover:border-gold/40">
      <div
        className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-gold/60 font-display text-lg font-bold text-ink"
        style={{ background: coatColor(horse.coat) }}
        aria-hidden
      >
        {horse.name.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{horse.name}</p>
        <p className="mt-0.5 text-sm text-muted">
          {horse.age.toFixed(1)}y {titleCase(horse.sex)} · {horse.record.starts} starts · {horse.record.wins}{" "}
          wins
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[horse.status]}>{titleCase(horse.status)}</Badge>
          <Badge tone={RARITY_TONE[horse.rarity]}>{titleCase(horse.rarity)}</Badge>
          {horse.record.earnings > 0 && (
            <span className="num text-xs text-muted">{fmt(horse.record.earnings)} cr earned</span>
          )}
          {extra}
        </div>
      </div>
      <div className="text-right">
        <p className="num font-display text-2xl font-bold text-gold">{Math.round(horse.abilityRating)}</p>
        <p className="text-[11px] uppercase tracking-wider text-muted">Rating</p>
      </div>
      {href && <ChevronRight className="size-5 text-muted" aria-hidden />}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
