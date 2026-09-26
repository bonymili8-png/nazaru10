"use client";
import type { MarketListingDetailDto, WalletDto } from "@thoroughline/contracts";
import { Crown, Gavel, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { HorseCard } from "@/components/HorseCard";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, Stars, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, fmt, titleCase } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

export default function ListingPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ListingPage />
    </Suspense>
  );
}

function ListingPage() {
  const id = useSearchParams().get("id");
  const {
    data: l,
    error,
    reload,
  } = useApi<MarketListingDetailDto>(id ? `/market/listings/${id}` : null, { refreshMs: 5000 });
  const wallet = useApi<WalletDto>("/wallet");
  const now = useNow(1000);
  const toast = useToast();
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!id) return <ErrorState error={new Error(t("listing.noneSelected"))} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!l) return <Skeleton className="h-64" />;

  const open = l.status === "ACTIVE";
  const auction = l.type === "AUCTION";
  const bidValue = Number(amount || l.minNextBid);
  const balance = wallet.data?.balances.CREDITS ?? null;
  const shortOf = (need: number) => (balance !== null && balance < need ? need - balance : 0);
  const act = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(what);
    try {
      await fn();
      haptic.success();
      toast(ok);
      setAmount("");
      invalidate(`/market`, "/wallet", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <HorseCard horse={l.horse} href={`/horse/?id=${l.horse.id}`} />
      <Card className="mt-3">
        <div className="flex items-center justify-between">
          <Badge tone={auction ? "gold" : "neutral"}>
            {auction ? t("listing.timed") : t("listing.buyNow")}
          </Badge>
          <Badge tone={open ? "good" : "neutral"}>
            {open ? t("listing.endsIn", { t: countdown(l.endsAt, now) }) : titleCase(l.status)}
          </Badge>
        </div>
        <p className="num mt-3 font-display text-4xl font-bold text-gold">
          {fmt(l.salePrice ?? l.highestBid ?? l.price)}
        </p>
        <p className="text-sm text-muted">
          {l.status === "SOLD"
            ? t("listing.soldFor")
            : auction
              ? l.highestBid
                ? t("listing.currentBids", { n: l.bidCount })
                : t("listing.startingPrice")
              : t("common.credits")}{" "}
          · {t("listing.guide", { v: fmt(l.referenceValue) })}
        </p>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted">{t("listing.seller")}</span>
          <span>{l.sellerName ?? t("common.owner")}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-muted">{t("horse.potential")}</span>
          <Stars n={l.horse.potentialStars} />
        </div>

        {open && !l.mine && !auction && (
          <Button
            className="mt-4 w-full"
            loading={busy === "buy"}
            onClick={() => {
              if (window.confirm(t("shop.confirmBuy", { name: l.horse.name, price: fmt(l.price) })))
                void act(
                  "buy",
                  () => post(`/market/listings/${l.id}/buy`),
                  t("listing.yoursNow", { name: l.horse.name }),
                );
            }}
          >
            {t("listing.buyFor", { price: fmt(l.price) })}
          </Button>
        )}
        {open && !l.mine && !auction && shortOf(l.price) > 0 && (
          <p className="mt-2 text-sm text-warn" role="status">
            {t("listing.short", { have: fmt(balance!), short: fmt(shortOf(l.price)) })}
          </p>
        )}

        {open && !l.mine && auction && (
          <div className="mt-4">
            {l.iAmLeading && <p className="mb-2 text-sm text-good">{t("listing.highest")}</p>}
            <label htmlFor="bid" className="text-sm text-muted">
              {t("listing.yourBid", { min: fmt(l.minNextBid) })}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="bid"
                inputMode="numeric"
                className="num min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3"
                value={amount}
                placeholder={String(l.minNextBid)}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              />
              <Button
                loading={busy === "bid"}
                disabled={bidValue < l.minNextBid}
                onClick={() =>
                  act(
                    "bid",
                    () => post(`/market/listings/${l.id}/bids`, { amount: bidValue }),
                    t("listing.bidPlaced"),
                  )
                }
              >
                <Gavel className="size-4" aria-hidden />
                {t("listing.bid")}
              </Button>
            </div>
            {shortOf(bidValue) > 0 && !l.iAmLeading && (
              <p className="mt-2 text-sm text-warn" role="status">
                {t("listing.shortBid", { have: fmt(balance!), short: fmt(shortOf(bidValue)) })}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">{t("listing.escrow")}</p>
          </div>
        )}

        {open && l.mine && (
          <Button
            variant="danger"
            className="mt-4 w-full"
            disabled={l.bidCount > 0}
            loading={busy === "cancel"}
            onClick={() =>
              act("cancel", () => post(`/market/listings/${l.id}/cancel`), t("listing.cancelled"))
            }
          >
            {l.bidCount > 0 ? t("listing.cantCancel") : t("listing.cancel")}
          </Button>
        )}
      </Card>

      {auction && (
        <>
          <SectionTitle>{t("listing.bids")}</SectionTitle>
          <Card className="divide-y divide-line/40 p-0">
            {l.bids.length === 0 && <p className="p-4 text-sm text-muted">{t("listing.noBids")}</p>}
            {l.bids.map((b, i) => (
              <div
                key={`${b.createdAt}${b.amount}`}
                className={`flex justify-between px-4 py-2.5 text-sm ${b.mine ? "bg-gold/10" : ""}`}
              >
                <span className="flex items-center gap-1.5">
                  {i === 0 && <Crown className="size-3.5 text-gold" aria-label={t("listing.leading")} />}
                  {b.mine ? t("listing.you") : (b.bidderName ?? t("listing.bidder"))}
                </span>
                <span className="num font-semibold">{fmt(b.amount)}</span>
              </div>
            ))}
          </Card>
        </>
      )}

      <Card className="mt-4 text-xs text-muted">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <ShieldCheck className="size-4 text-good" aria-hidden />
          {t("listing.safe")}
        </p>
        <p className="mt-1">
          {t("listing.safeText", { fee: Math.round(l.feeRate * 100) })}{" "}
          <Link href="/shop/" className="text-gold underline">
            {t("listing.back")}
          </Link>
        </p>
      </Card>
    </div>
  );
}
