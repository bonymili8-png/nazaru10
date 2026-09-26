"use client";
import type {
  MarketListingDto,
  MarketMineDto,
  PaymentDto,
  ProductDto,
  ShopHorseDto,
} from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { Gem } from "lucide-react";
import { useState } from "react";
import { HorseCard } from "@/components/HorseCard";
import { ListingCard } from "@/components/ListingCard";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionTitle,
  Skeleton,
  Stars,
  useToast,
} from "@/components/ui";
import { api, post } from "@/lib/api";
import { errorMessage, fmt, titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { haptic, tg } from "@/lib/telegram";

type Tab = "players" | "ring" | "mine" | "gems";
const TABS: [Tab, string][] = [
  ["players", "Players"],
  ["ring", "Sales ring"],
  ["mine", "Mine"],
  ["gems", "Gems"],
];

export default function MarketPage() {
  const [tab, setTab] = useState<Tab>("players");
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Market</h1>
      <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-surface p-1" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium transition-colors ${tab === k ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "players" && <PlayerMarket />}
      {tab === "ring" && <SalesRing />}
      {tab === "mine" && <MyMarket />}
      {tab === "gems" && <Gems />}
    </div>
  );
}

function PlayerMarket() {
  const [type, setType] = useState<"" | "FIXED" | "AUCTION">("");
  const [sort, setSort] = useState("ending");
  const { data, error, reload } = useApi<MarketListingDto[]>(
    `/market/listings?sort=${sort}${type ? `&type=${type}` : ""}`,
    { refreshMs: 15_000 },
  );
  return (
    <>
      <div className="mt-3 flex gap-2">
        <select
          aria-label="Listing type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="min-h-10 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm"
        >
          <option value="">All listings</option>
          <option value="AUCTION">Auctions</option>
          <option value="FIXED">Buy now</option>
        </select>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="min-h-10 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm"
        >
          <option value="ending">Ending soon</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
          <option value="rating">Rating</option>
        </select>
      </div>
      <div className="mt-3 space-y-2">
        {error && <ErrorState error={error} retry={reload} />}
        {!data && !error && <Skeleton className="h-40" />}
        {data?.length === 0 && (
          <EmptyState
            title="No horses for sale"
            body="Owners list horses from their horse page. Check back soon — or sell one yourself."
          />
        )}
        {data?.map((l) => (
          <ListingCard key={l.id} l={l} />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        A {Math.round(defaultConfig.market.saleFeeRate * 100)}% market fee is taken from the seller when a
        sale completes. Bids are held in escrow and returned if you are outbid.
      </p>
    </>
  );
}

function MyMarket() {
  const { data } = useApi<MarketMineDto>("/market/mine", { refreshMs: 15_000 });
  if (!data) return <Skeleton className="mt-3 h-40" />;
  return (
    <>
      <SectionTitle>Your bids</SectionTitle>
      {data.bids.length === 0 ? (
        <p className="text-sm text-muted">No active bids.</p>
      ) : (
        <div className="space-y-2">
          {data.bids.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
      <SectionTitle>Your listings</SectionTitle>
      {data.listings.length === 0 ? (
        <p className="text-sm text-muted">Sell a horse from its profile page.</p>
      ) : (
        <div className="space-y-2">
          {data.listings.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
    </>
  );
}

function SalesRing() {
  const horses = useApi<ShopHorseDto[]>("/shop/horses", { refreshMs: 30_000 });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const buyHorse = async (h: ShopHorseDto) => {
    if (!window.confirm(`Buy ${h.name} for ${fmt(h.price)} credits?`)) return;
    setBusy(h.id);
    try {
      await post(`/shop/horses/${h.id}/buy`);
      haptic.success();
      toast(`${h.name} has arrived at your stable`);
      invalidate("/shop", "/wallet", "/horses", "/home");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <p className="mt-3 text-sm text-muted">
        House-bred prospects arrive through the day. Prices follow ability, potential, age and rarity.
      </p>
      <div className="mt-3 space-y-3">
        {horses.error && <ErrorState error={horses.error} retry={horses.reload} />}
        {!horses.data && !horses.error && <Skeleton className="h-40" />}
        {horses.data?.length === 0 && (
          <EmptyState title="The ring is empty" body="New horses arrive shortly." />
        )}
        {horses.data?.map((h) => (
          <div key={h.id}>
            <HorseCard horse={h} />
            <div className="-mt-2 flex items-center justify-between gap-2 rounded-b-[var(--radius-card)] border border-t-0 border-line/60 bg-surface-2 px-3.5 pb-3 pt-4 text-sm">
              <div className="text-muted">
                <Stars n={h.potentialStars} /> · ~{fmt(h.optimalDistance)}m · {titleCase(h.favouriteSurface)}
              </div>
              <Button className="min-h-10 px-3 text-sm" loading={busy === h.id} onClick={() => buyHorse(h)}>
                {fmt(h.price)} cr
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Gems() {
  const products = useApi<ProductDto[]>("/payments/products");
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const buyGems = async (p: ProductDto) => {
    const app = tg();
    if (!app?.openInvoice) {
      toast("Purchases are available inside Telegram", "bad");
      return;
    }
    setBusy(p.id);
    try {
      const payment = await post<PaymentDto>("/payments", { productId: p.id });
      app.openInvoice(payment.invoiceLink!, (status) => {
        if (status !== "paid") {
          setBusy(null);
          return;
        }
        // Gems are granted by the server when Telegram confirms payment; poll until it lands.
        let tries = 0;
        const check = async () => {
          const s = await api<PaymentDto>(`/payments/${payment.id}`).catch(() => null);
          if (s?.status === "COMPLETED") {
            haptic.success();
            toast(`${p.title} added to your wallet`);
            invalidate("/wallet");
            setBusy(null);
          } else if (tries++ < 10) setTimeout(check, 1500);
          else {
            toast("Payment is processing — gems will appear shortly");
            setBusy(null);
          }
        };
        void check();
      });
    } catch (e) {
      toast(errorMessage(e), "bad");
      setBusy(null);
    }
  };
  return (
    <>
      <p className="mb-2 mt-3 text-xs text-muted">
        Gems buy diagnostics and cosmetics — never race wins. Paid with Telegram Stars.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {products.data?.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <Gem className="size-6 text-gold" aria-hidden />
            <p className="mt-2 font-semibold">{p.title}</p>
            <p className="flex-1 text-xs text-muted">{p.description}</p>
            <Button
              variant="secondary"
              className="mt-3 text-sm"
              loading={busy === p.id}
              onClick={() => buyGems(p)}
            >
              {p.priceStars} Stars
            </Button>
          </Card>
        ))}
      </div>
    </>
  );
}
