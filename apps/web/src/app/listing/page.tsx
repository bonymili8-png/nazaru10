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
  if (!id) return <ErrorState error={new Error("No listing selected")} />;
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
          <Badge tone={auction ? "gold" : "neutral"}>{auction ? "Timed auction" : "Buy now"}</Badge>
          <Badge tone={open ? "good" : "neutral"}>
            {open ? `Ends in ${countdown(l.endsAt, now)}` : titleCase(l.status)}
          </Badge>
        </div>
        <p className="num mt-3 font-display text-4xl font-bold text-gold">
          {fmt(l.salePrice ?? l.highestBid ?? l.price)}
        </p>
        <p className="text-sm text-muted">
          {l.status === "SOLD"
            ? "sold for"
            : auction
              ? l.highestBid
                ? `current bid · ${l.bidCount} bid${l.bidCount === 1 ? "" : "s"}`
                : "starting price"
              : "credits"}{" "}
          · guide value {fmt(l.referenceValue)}
        </p>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted">Seller</span>
          <span>{l.sellerName ?? "Owner"}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-muted">Potential</span>
          <Stars n={l.horse.potentialStars} />
        </div>

        {open && !l.mine && !auction && (
          <Button
            className="mt-4 w-full"
            loading={busy === "buy"}
            onClick={() => {
              if (window.confirm(`Buy ${l.horse.name} for ${fmt(l.price)} credits?`))
                void act("buy", () => post(`/market/listings/${l.id}/buy`), `${l.horse.name} is yours!`);
            }}
          >
            Buy for {fmt(l.price)} cr
          </Button>
        )}
        {open && !l.mine && !auction && shortOf(l.price) > 0 && (
          <p className="mt-2 text-sm text-warn" role="status">
            You have {fmt(balance!)} credits — {fmt(shortOf(l.price))} short.
          </p>
        )}

        {open && !l.mine && auction && (
          <div className="mt-4">
            {l.iAmLeading && <p className="mb-2 text-sm text-good">You are the highest bidder.</p>}
            <label htmlFor="bid" className="text-sm text-muted">
              Your bid (minimum {fmt(l.minNextBid)})
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
                    "Bid placed — held in escrow",
                  )
                }
              >
                <Gavel className="size-4" aria-hidden />
                Bid
              </Button>
            </div>
            {shortOf(bidValue) > 0 && !l.iAmLeading && (
              <p className="mt-2 text-sm text-warn" role="status">
                You have {fmt(balance!)} credits — {fmt(shortOf(bidValue))} short for this bid.
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              Your bid is held in escrow and returned in full if someone outbids you. Late bids extend the
              auction by 5 minutes.
            </p>
          </div>
        )}

        {open && l.mine && (
          <Button
            variant="danger"
            className="mt-4 w-full"
            disabled={l.bidCount > 0}
            loading={busy === "cancel"}
            onClick={() => act("cancel", () => post(`/market/listings/${l.id}/cancel`), "Listing cancelled")}
          >
            {l.bidCount > 0 ? "Auctions with bids can't be cancelled" : "Cancel listing"}
          </Button>
        )}
      </Card>

      {auction && (
        <>
          <SectionTitle>Bids</SectionTitle>
          <Card className="divide-y divide-line/40 p-0">
            {l.bids.length === 0 && <p className="p-4 text-sm text-muted">No bids yet.</p>}
            {l.bids.map((b, i) => (
              <div
                key={`${b.createdAt}${b.amount}`}
                className={`flex justify-between px-4 py-2.5 text-sm ${b.mine ? "bg-gold/10" : ""}`}
              >
                <span className="flex items-center gap-1.5">
                  {i === 0 && <Crown className="size-3.5 text-gold" aria-label="Leading bid" />}
                  {b.mine ? "You" : (b.bidderName ?? "Bidder")}
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
          Safe trading
        </p>
        <p className="mt-1">
          Payment and the horse change hands in one step on the server. The seller receives the price minus a{" "}
          {Math.round(l.feeRate * 100)}% market fee.{" "}
          <Link href="/shop/" className="text-gold underline">
            Back to market
          </Link>
        </p>
      </Card>
    </div>
  );
}
