"use client";
import type { PaymentDto, ProductDto, ShopHorseDto } from "@thoroughline/contracts";
import { Gem } from "lucide-react";
import { useState } from "react";
import { HorseCard } from "@/components/HorseCard";
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
import { fmt, titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { haptic, tg } from "@/lib/telegram";

export default function ShopPage() {
  const horses = useApi<ShopHorseDto[]>("/shop/horses", { refreshMs: 30_000 });
  const products = useApi<ProductDto[]>("/payments/products");
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
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

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
      toast((e as Error).message, "bad");
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Sales ring</h1>
      <p className="mt-1 text-sm text-muted">
        Fresh prospects arrive through the day. Prices follow ability, potential, age and rarity.
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

      <SectionTitle>Racing Gems</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-muted">
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
    </div>
  );
}
