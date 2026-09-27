"use client";
import type { HorseDetailDto, HorseOfferDto, OffersDto } from "@thoroughline/contracts";
import { useState } from "react";
import { post } from "@/lib/api";
import { countdown, errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";
import { HorseCard } from "./HorseCard";
import { Badge, Button, Card, SectionTitle, useToast } from "./ui";

const REFRESH = ["/market/offers", "/wallet", "/horses", "/home"];

/** Offer form on another owner's horse that is not for sale. */
export function MakeOffer({ h }: { h: HorseDetailDto }) {
  const band = h.offerBand!;
  const [value, setValue] = useState(String(band.min));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const amount = Math.round(Number(value || 0));
  const valid = amount >= band.min && amount <= band.max;
  const submit = async () => {
    if (!valid || !window.confirm(t("offer.confirm", { n: fmt(amount), name: h.name }))) return;
    setBusy(true);
    try {
      await post(`/horses/${h.id}/offers`, { amount });
      haptic.success();
      toast(t("offer.sent"));
      invalidate(...REFRESH);
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle>{t("offer.title")}</SectionTitle>
      <Card>
        <p className="text-sm text-muted">{t("offer.hint", { min: fmt(band.min), max: fmt(band.max) })}</p>
        <label htmlFor="offer" className="mt-3 block text-sm text-muted">
          {t("offer.amount")}
        </label>
        <input
          id="offer"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
          aria-invalid={!valid}
          className="num mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
        />
        <Button className="mt-3 w-full" onClick={submit} disabled={!valid} loading={busy}>
          {t("offer.submit", { n: fmt(amount) })}
        </Button>
      </Card>
    </>
  );
}

function OfferRow({ o, received }: { o: HorseOfferDto; received: boolean }) {
  const now = useNow(1000);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const act = async (what: "accept" | "decline" | "withdraw", ok: string) => {
    setBusy(what);
    try {
      await post(`/market/offers/${o.id}/${what}`);
      haptic.success();
      toast(ok);
      invalidate(...REFRESH);
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const open = o.status === "OPEN";
  return (
    <div>
      <HorseCard horse={o.horse} href={`/horse/?id=${o.horse.id}`} />
      <div className="-mt-2 space-y-2 rounded-b-[var(--radius-card)] border border-t-0 border-line/60 bg-surface-2 px-3.5 pb-3 pt-4 text-sm">
        <p className="num">
          {received
            ? t("offer.from", { amount: fmt(o.amount), name: o.buyerName ?? "—", net: fmt(o.net) })
            : t("offer.to", { amount: fmt(o.amount), name: o.horse.name })}
          {open ? (
            <span className="text-muted"> · {t("offer.expires", { time: countdown(o.expiresAt, now) })}</span>
          ) : null}
        </p>
        {!open && <Badge>{t(`offer.status.${o.status}` as MessageKey)}</Badge>}
        {open && received && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              className="min-h-10 text-sm"
              loading={busy === "decline"}
              disabled={busy !== null}
              onClick={() => void act("decline", t("offer.declined"))}
            >
              {t("offer.decline")}
            </Button>
            <Button
              className="min-h-10 text-sm"
              loading={busy === "accept"}
              disabled={busy !== null}
              onClick={() => {
                if (
                  window.confirm(
                    t("offer.confirmAccept", { name: o.horse.name, amount: fmt(o.amount), net: fmt(o.net) }),
                  )
                )
                  void act("accept", t("offer.accepted"));
              }}
            >
              {t("offer.accept")}
            </Button>
          </div>
        )}
        {open && !received && (
          <Button
            variant="ghost"
            className="min-h-10 w-full text-sm"
            loading={busy === "withdraw"}
            onClick={() => void act("withdraw", t("offer.withdrawn"))}
          >
            {t("offer.withdraw")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Offers received on the player's horses and offers they made, for the market's "Mine" tab. */
export function MyOffers() {
  const { data } = useApi<OffersDto>("/market/offers", { refreshMs: 15_000 });
  if (!data) return null;
  return (
    <>
      {(["received", "made"] as const).map((k) => (
        <div key={k}>
          <SectionTitle>{t(k === "received" ? "offer.received" : "offer.made")}</SectionTitle>
          {data[k].length === 0 ? (
            <p className="text-sm text-muted">{t("offer.none")}</p>
          ) : (
            <div className="space-y-2">
              {data[k].map((o) => (
                <OfferRow key={o.id} o={o} received={k === "received"} />
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
