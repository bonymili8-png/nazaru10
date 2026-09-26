"use client";
import type { MarketListingDto } from "@thoroughline/contracts";
import { Gavel, Tag } from "lucide-react";
import Link from "next/link";
import { countdown, fmt, titleCase } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { coatColor } from "./HorseCard";
import { Badge, Stars } from "./ui";

export function ListingCard({ l }: { l: MarketListingDto }) {
  const now = useNow(1000);
  const h = l.horse;
  const auction = l.type === "AUCTION";
  const live = l.status === "ACTIVE";
  return (
    <Link
      href={`/listing/?id=${l.id}`}
      className="block rounded-[var(--radius-card)] border border-line/60 bg-surface p-3.5 transition-colors hover:border-gold/40"
    >
      <div className="flex items-center gap-3">
        <div
          className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-gold/60 font-display text-lg font-bold"
          style={{ background: coatColor(h.coat) }}
          aria-hidden
        >
          {h.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{h.name}</p>
          <p className="text-sm text-muted">
            {t("horse.ageLine", { age: h.age.toFixed(1), sex: titleCase(h.sex) })} ·{" "}
            {t("common.winsOf", { w: h.record.wins, n: h.record.starts })} · ~
            {t("unit.m", { n: fmt(h.optimalDistance) })}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={auction ? "gold" : "neutral"}>
              {auction ? <Gavel className="size-3" aria-hidden /> : <Tag className="size-3" aria-hidden />}
              {auction ? t("listing.auctionBids", { n: l.bidCount }) : t("listing.buyNow")}
            </Badge>
            {l.iAmLeading && <Badge tone="good">{t("listing.youLead")}</Badge>}
            {l.mine && <Badge>{t("listing.yours")}</Badge>}
            <Stars n={h.potentialStars} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-display text-xl font-bold text-gold">{fmt(l.highestBid ?? l.price)}</p>
          <p className="text-[11px] text-muted">
            {live
              ? auction && l.highestBid
                ? t("listing.currentBid")
                : auction
                  ? t("listing.start")
                  : t("common.credits")
              : titleCase(l.status)}
          </p>
          <p className="num text-[11px] text-muted">{live ? countdown(l.endsAt, now) : ""}</p>
        </div>
      </div>
    </Link>
  );
}
