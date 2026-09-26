"use client";
import type { SyndicateDto } from "@thoroughline/contracts";
import { Users } from "lucide-react";
import { useState } from "react";
import { Button, Card, SectionTitle, useToast } from "@/components/ui";
import { del, post } from "@/lib/api";
import { errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

/** Co-ownership of a horse: share breakdown, buying shares, and the manager's controls. */
export function Syndicate({ horseId, horseName }: { horseId: string; horseName: string }) {
  const { data: s, reload } = useApi<SyndicateDto>(`/syndicates/${horseId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [offerShares, setOfferShares] = useState(1);
  const [price, setPrice] = useState("");
  const toast = useToast();
  if (!s) return null;
  const isManager = s.priceBand !== null;
  const sold = s.totalShares - s.managerShares;
  // Nothing to show a visitor when the horse has no partners and no shares on offer.
  if (!isManager && sold === 0 && !s.offer) return null;

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      haptic.success();
      toast(ok);
      invalidate("/syndicates", "/wallet", `/horses/${horseId}`);
      reload();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const canOffer = s.maxPartnerShares - sold;
  const band = s.priceBand;
  const priceValue = Number(price || band?.min || 0);
  const buyBack = s.partners.length > 0;

  return (
    <>
      <SectionTitle>{t("syn.title")}</SectionTitle>
      <Card className="space-y-3 text-sm">
        <p className="text-muted">{t("syn.intro", { max: s.maxPartnerShares, total: s.totalShares })}</p>
        {/* Share bar: manager in gold, partners in grey. */}
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="bg-gold" style={{ width: `${(s.managerShares / s.totalShares) * 100}%` }} />
          {s.partners.map((p, i) => (
            <div
              key={p.userId}
              className={i % 2 ? "bg-sky-400/70" : "bg-emerald-400/70"}
              style={{ width: `${(p.shares / s.totalShares) * 100}%` }}
            />
          ))}
        </div>
        <ul className="space-y-1">
          <li className="flex justify-between">
            <span>
              {s.managerName} · {t("syn.manager")}
            </span>
            <span className="num">{t("syn.shares", { n: s.managerShares, total: s.totalShares })}</span>
          </li>
          {s.partners.map((p) => (
            <li key={p.userId} className="flex justify-between text-muted">
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" aria-hidden />
                {p.name}
              </span>
              <span className="num">{t("syn.shares", { n: p.shares, total: s.totalShares })}</span>
            </li>
          ))}
        </ul>

        {!isManager && s.myShares > 0 && <p className="text-good">{t("syn.youHold", { n: s.myShares })}</p>}

        {!isManager && s.offer && (
          <div className="rounded-xl bg-surface-2 p-3">
            <p>{t("syn.onOffer", { n: s.offer.available, price: fmt(s.offer.pricePerShare) })}</p>
            <div className="mt-2 flex items-center gap-2">
              <label className="sr-only" htmlFor="syn-count">
                {t("syn.howMany")}
              </label>
              <select
                id="syn-count"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="min-h-11 rounded-xl border border-line bg-surface px-3"
              >
                {Array.from({ length: s.offer.available }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <Button
                className="flex-1"
                loading={busy === "buy"}
                onClick={() => {
                  const total = fmt(s.offer!.pricePerShare * count);
                  if (!window.confirm(t("syn.confirmBuy", { n: count, name: horseName, total }))) return;
                  void run(
                    "buy",
                    () => post(`/syndicates/${horseId}/buy`, { shares: count }),
                    t("syn.bought"),
                  );
                }}
              >
                {t("syn.buy", { total: fmt(s.offer.pricePerShare * count) })}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">{t("syn.buyHint")}</p>
          </div>
        )}

        {isManager && band && (
          <div className="space-y-2 rounded-xl bg-surface-2 p-3">
            {s.offer ? (
              <div className="flex items-center justify-between gap-2">
                <span>{t("syn.onOffer", { n: s.offer.available, price: fmt(s.offer.pricePerShare) })}</span>
                <Button
                  variant="ghost"
                  className="min-h-9 px-2 text-xs"
                  loading={busy === "withdraw"}
                  onClick={() =>
                    run("withdraw", () => del(`/syndicates/${horseId}/offer`), t("syn.withdrawn"))
                  }
                >
                  {t("common.withdraw")}
                </Button>
              </div>
            ) : canOffer > 0 ? (
              <>
                <p className="font-medium">{t("syn.sellTitle")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted">
                    {t("syn.howMany")}
                    <select
                      value={offerShares}
                      onChange={(e) => setOfferShares(Number(e.target.value))}
                      className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink"
                    >
                      {Array.from({ length: canOffer }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-muted">
                    {t("syn.pricePerShare")}
                    <input
                      inputMode="numeric"
                      value={price}
                      placeholder={String(band.min)}
                      onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
                      className="num mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink"
                    />
                  </label>
                </div>
                <p
                  className={`text-xs ${priceValue < band.min || priceValue > band.max ? "text-bad" : "text-muted"}`}
                >
                  {t("syn.band", {
                    min: fmt(band.min),
                    max: fmt(band.max),
                    fee: Math.round(s.feeRate * 100),
                  })}
                </p>
                <Button
                  variant="secondary"
                  className="w-full"
                  loading={busy === "offer"}
                  disabled={priceValue < band.min || priceValue > band.max}
                  onClick={() =>
                    run(
                      "offer",
                      () =>
                        post(`/syndicates/${horseId}/offer`, {
                          shares: offerShares,
                          pricePerShare: priceValue,
                        }),
                      t("syn.offered"),
                    )
                  }
                >
                  {t("syn.offer", { n: offerShares })}
                </Button>
              </>
            ) : (
              <p className="text-muted">{t("syn.maxSold", { max: s.maxPartnerShares })}</p>
            )}
            {buyBack && (
              <Button
                variant="ghost"
                className="w-full text-sm"
                loading={busy === "dissolve"}
                onClick={() => {
                  if (!window.confirm(t("syn.confirmDissolve"))) return;
                  void run("dissolve", () => post(`/syndicates/${horseId}/dissolve`), t("syn.dissolved"));
                }}
              >
                {t("syn.dissolve")}
              </Button>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
