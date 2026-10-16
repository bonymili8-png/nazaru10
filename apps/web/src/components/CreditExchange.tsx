"use client";
import type { GemExchangeDto, GemExchangeResultDto, WalletDto } from "@thoroughline/contracts";
import { Coins, Gem } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Card, SectionTitle, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

/** A fresh id per tap: a retried request with the same id is a no-op on the server. */
const requestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Credits for gems (shop, gems tab): fixed bundles with a volume bonus and a daily cap.
 * Hidden entirely while the admin has the exchange switched off.
 */
export function CreditExchange({ focus = false }: { focus?: boolean }) {
  const { data } = useApi<GemExchangeDto>("/wallet/exchange");
  const ref = useRef<HTMLDivElement>(null);
  const shown = !!data?.enabled && !!data.bundles.length;
  // Opened from the header's credit balance: bring the exchange into view once it is there.
  useEffect(() => {
    if (focus && shown) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focus, shown]);
  const wallet = useApi<WalletDto>("/wallet");
  const toast = useToast();
  const now = useNow(30_000);
  const [busy, setBusy] = useState<number | null>(null);
  if (!data || !shown) return null;
  const gems = wallet.data?.balances.GEMS ?? 0;

  const buy = async (b: GemExchangeDto["bundles"][number]) => {
    if (!window.confirm(t("exchange.confirm", { gems: b.gems, credits: fmt(b.credits) }))) return;
    setBusy(b.gems);
    try {
      await post<GemExchangeResultDto>("/wallet/exchange", {
        gems: b.gems,
        credits: b.credits,
        requestId: requestId(),
      });
      haptic.success();
      toast(t("exchange.done", { credits: fmt(b.credits) }));
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      invalidate("/wallet", "/me");
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="scroll-mt-20">
      <SectionTitle>{t("exchange.title")}</SectionTitle>
      <Card>
        <p className="text-sm text-muted">{t("exchange.intro", { rate: fmt(data.baseRate) })}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {data.bundles.map((b) => {
            const overCap = b.credits > data.creditsLeft;
            const short = b.gems > gems;
            return (
              <button
                key={b.gems}
                onClick={() => void buy(b)}
                disabled={busy !== null || overCap || short}
                aria-label={t("exchange.buyLabel", { gems: b.gems, credits: fmt(b.credits) })}
                className="flex min-h-24 cursor-pointer flex-col items-start rounded-xl border border-line/60 bg-surface-2 p-3 text-left transition-colors hover:border-gold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex w-full items-center justify-between gap-1">
                  <Coins className="size-5 text-gold" aria-hidden />
                  {b.bonusPct > 0 && <Badge tone="good">{t("exchange.bonus", { n: b.bonusPct })}</Badge>}
                </span>
                <span className="num mt-1 font-display text-xl font-bold">
                  {t("exchange.credits", { n: fmt(b.credits) })}
                </span>
                <span className="num inline-flex items-center gap-1 text-xs text-muted">
                  <Gem className="size-3.5 text-gold" aria-hidden />
                  {busy === b.gems
                    ? t("exchange.buying")
                    : overCap
                      ? t("exchange.overCap")
                      : short
                        ? t("exchange.short", { n: b.gems - gems })
                        : t("exchange.forGems", { n: b.gems })}
                </span>
              </button>
            );
          })}
        </div>
        <p className="num mt-3 text-center text-xs text-muted">
          {t("exchange.today", {
            bought: fmt(data.creditsToday),
            limit: fmt(data.dailyCreditLimit),
          })}
          {data.creditsToday > 0 && ` · ${t("exchange.resets", { t: countdown(data.resetsAt, now) })}`}
        </p>
      </Card>
    </div>
  );
}
