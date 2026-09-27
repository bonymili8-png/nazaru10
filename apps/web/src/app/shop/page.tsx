"use client";
import type {
  SubscriptionDto,
  MarketListingDto,
  MyShareDto,
  ShareOfferDto,
  MarketMineDto,
  PaymentDto,
  ProductDto,
  ShopHorseDto,
} from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { Check, Crown, Gem } from "lucide-react";
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
import { getLocale, type MessageKey, t } from "@/lib/i18n";
import { haptic, tg } from "@/lib/telegram";

type Tab = "players" | "shares" | "ring" | "mine" | "gems";
const TABS: Tab[] = ["players", "shares", "ring", "mine", "gems"];

/** Product texts are translated by id; the server's English text is the fallback. */
const productText = (p: ProductDto, field: "title" | "description") => {
  const k = `product.${p.id}.${field}` as MessageKey;
  return t(k) === k ? p[field] : t(k);
};

export default function MarketPage() {
  const [tab, setTab] = useState<Tab>("players");
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("shop.title")}</h1>
      <div className="mt-3 grid grid-cols-5 gap-1 rounded-xl bg-surface p-1" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-10 cursor-pointer rounded-lg px-0.5 text-[13px] font-medium leading-tight transition-colors ${tab === k ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
          >
            {t(`shop.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === "players" && <PlayerMarket />}
      {tab === "ring" && <SalesRing />}
      {tab === "mine" && <MyMarket />}
      {tab === "gems" && <Gems />}
      {tab === "shares" && <Shares />}
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
          aria-label={t("shop.listingType")}
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="min-h-10 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm"
        >
          <option value="">{t("shop.allListings")}</option>
          <option value="AUCTION">{t("shop.auctions")}</option>
          <option value="FIXED">{t("listing.buyNow")}</option>
        </select>
        <select
          aria-label={t("shop.sort")}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="min-h-10 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm"
        >
          <option value="ending">{t("shop.ending")}</option>
          <option value="newest">{t("shop.newest")}</option>
          <option value="price_asc">{t("shop.priceAsc")}</option>
          <option value="price_desc">{t("shop.priceDesc")}</option>
          <option value="rating">{t("common.strength")}</option>
        </select>
      </div>
      <div className="mt-3 space-y-2">
        {error && <ErrorState error={error} retry={reload} />}
        {!data && !error && <Skeleton className="h-40" />}
        {data?.length === 0 && <EmptyState title={t("shop.noneForSale")} body={t("shop.noneForSaleBody")} />}
        {data?.map((l) => (
          <ListingCard key={l.id} l={l} />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        {t("shop.feeNote", { fee: Math.round(defaultConfig.market.saleFeeRate * 100) })}
      </p>
    </>
  );
}

function MyMarket() {
  const { data } = useApi<MarketMineDto>("/market/mine", { refreshMs: 15_000 });
  if (!data) return <Skeleton className="mt-3 h-40" />;
  return (
    <>
      <SectionTitle>{t("shop.yourBids")}</SectionTitle>
      {data.bids.length === 0 ? (
        <p className="text-sm text-muted">{t("shop.noBids")}</p>
      ) : (
        <div className="space-y-2">
          {data.bids.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
      <SectionTitle>{t("shop.yourListings")}</SectionTitle>
      {data.listings.length === 0 ? (
        <p className="text-sm text-muted">{t("shop.sellHint")}</p>
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
    if (!window.confirm(t("shop.confirmBuy", { name: h.name, price: fmt(h.price) }))) return;
    setBusy(h.id);
    try {
      await post(`/shop/horses/${h.id}/buy`);
      haptic.success();
      toast(t("shop.arrived", { name: h.name }));
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
      <p className="mt-3 text-sm text-muted">{t("shop.ringIntro")}</p>
      <div className="mt-3 space-y-3">
        {horses.error && <ErrorState error={horses.error} retry={horses.reload} />}
        {!horses.data && !horses.error && <Skeleton className="h-40" />}
        {horses.data?.length === 0 && (
          <EmptyState title={t("shop.ringEmpty")} body={t("shop.ringEmptyBody")} />
        )}
        {horses.data?.map((h) => (
          <div key={h.id}>
            <HorseCard horse={h} />
            <div className="-mt-2 flex items-center justify-between gap-2 rounded-b-[var(--radius-card)] border border-t-0 border-line/60 bg-surface-2 px-3.5 pb-3 pt-4 text-sm">
              <div className="text-muted">
                <Stars n={h.potentialStars} /> · ~{t("unit.m", { n: fmt(h.optimalDistance) })} ·{" "}
                {titleCase(h.favouriteSurface)}
              </div>
              <Button className="min-h-10 px-3 text-sm" loading={busy === h.id} onClick={() => buyHorse(h)}>
                {fmt(h.price)} {t("common.cr")}
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
      toast(t("shop.onlyTelegram"), "bad");
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
            toast(t("shop.added", { title: productText(p, "title") }));
            invalidate("/wallet", "/subscription", "/me", "/cosmetics");
            setBusy(null);
          } else if (tries++ < 10) setTimeout(check, 1500);
          else {
            toast(t("shop.processing"));
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
      {products.data
        ?.filter((p) => p.subscriptionDays)
        .map((p) => (
          <OwnersCircle key={p.id} product={p} busy={busy === p.id} onSubscribe={() => buyGems(p)} />
        ))}
      <p className="mb-2 mt-3 text-xs text-muted">{t("shop.gemsNote")}</p>
      <div className="grid grid-cols-2 gap-2">
        {products.data
          ?.filter((p) => !p.subscriptionDays)
          .map((p) => (
            <Card key={p.id} className="flex flex-col">
              <Gem className="size-6 text-gold" aria-hidden />
              <p className="mt-2 font-semibold">{productText(p, "title")}</p>
              <p className="flex-1 text-xs text-muted">{productText(p, "description")}</p>
              <Button
                variant="secondary"
                className="mt-3 text-sm"
                loading={busy === p.id}
                onClick={() => buyGems(p)}
              >
                {t("shop.stars", { n: p.priceStars })}
              </Button>
            </Card>
          ))}
      </div>
    </>
  );
}

function Shares() {
  const mine = useApi<MyShareDto[]>("/syndicates/mine");
  const offers = useApi<ShareOfferDto[]>("/syndicates/offers", { refreshMs: 30_000 });
  return (
    <>
      <SectionTitle>{t("shares.mine")}</SectionTitle>
      {!mine.data && <Skeleton className="h-20" />}
      {mine.data?.length === 0 && <p className="text-sm text-muted">{t("shares.none")}</p>}
      <div className="space-y-2">
        {mine.data?.map((s) => (
          <HorseCard
            key={s.horse.id}
            horse={s.horse}
            href={`/horse/?id=${s.horse.id}`}
            extra={
              <p className="num text-xs text-muted">
                {t("shares.line", {
                  n: s.shares,
                  total: s.totalShares,
                  cost: fmt(s.costPaid),
                  earned: fmt(s.earned),
                })}
              </p>
            }
          />
        ))}
      </div>
      <SectionTitle>{t("shares.offers")}</SectionTitle>
      {offers.error && <ErrorState error={offers.error} retry={offers.reload} />}
      {!offers.data && !offers.error && <Skeleton className="h-32" />}
      {offers.data?.length === 0 && <p className="text-sm text-muted">{t("shares.noOffers")}</p>}
      <div className="space-y-2">
        {offers.data?.map((o) => (
          <HorseCard
            key={o.horse.id}
            horse={o.horse}
            href={`/horse/?id=${o.horse.id}`}
            extra={
              <p className="num text-xs text-gold">
                {t("shares.offerLine", {
                  n: o.available,
                  price: fmt(o.pricePerShare),
                  manager: o.managerName,
                })}
              </p>
            }
          />
        ))}
      </div>
    </>
  );
}

function OwnersCircle({
  product,
  busy,
  onSubscribe,
}: {
  product: ProductDto;
  busy: boolean;
  onSubscribe: () => void;
}) {
  const sub = useApi<SubscriptionDto>("/subscription");
  const [acting, setActing] = useState(false);
  const toast = useToast();
  const s = sub.data;
  const date = s?.periodEnd
    ? new Date(s.periodEnd).toLocaleDateString(getLocale() === "uk" ? "uk-UA" : "en-GB")
    : "";
  const act = async (path: "cancel" | "resume") => {
    if (path === "cancel" && !window.confirm(t("circle.confirmCancel", { date }))) return;
    setActing(true);
    try {
      await post(`/subscription/${path}`);
      haptic.success();
      toast(path === "cancel" ? t("circle.cancelled") : t("circle.resumed"));
      sub.reload();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setActing(false);
    }
  };
  return (
    <Card className="mt-3 border-gold/50 bg-gradient-to-br from-surface to-surface-2">
      <p className="flex items-center gap-2 font-display text-xl font-bold">
        <Crown className="size-5 text-gold" aria-hidden />
        {t("circle.title")}
      </p>
      <p className="mt-1 text-xs text-muted">{t("circle.perks")}</p>
      <ul className="mt-3 space-y-1 text-sm">
        {[
          t("circle.perk1", { n: product.grants.gems ?? 0 }),
          t("circle.perk2"),
          t("circle.perk3"),
          t("circle.perk4"),
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{t("circle.noPower")}</p>
      {s?.member ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-gold" role="status">
            {s.status === "CANCELED" ? t("circle.endsOn", { date }) : t("circle.renewsOn", { date })}
          </p>
          <Button
            variant={s.status === "CANCELED" ? "primary" : "ghost"}
            className="w-full text-sm"
            loading={acting}
            onClick={() => act(s.status === "CANCELED" ? "resume" : "cancel")}
          >
            {s.status === "CANCELED" ? t("circle.resume") : t("circle.cancel")}
          </Button>
        </div>
      ) : (
        <Button className="mt-3 w-full" loading={busy} onClick={onSubscribe}>
          {t("circle.subscribe", { n: product.priceStars })}
        </Button>
      )}
    </Card>
  );
}
