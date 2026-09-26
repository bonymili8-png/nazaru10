"use client";
import type { LedgerLineDto, UserDto, WalletDto } from "@thoroughline/contracts";
import { Copy, Languages, LifeBuoy, Share2, ShieldCheck, Shirt } from "lucide-react";
import { Button, Card, LinkButton, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { put } from "@/lib/api";
import { errorMessage, fmt, has, titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { getLocale, LOCALES, t, useLocale } from "@/lib/i18n";
import { appLink, shareToTelegram } from "@/lib/telegram";

export default function ProfilePage() {
  const me = useApi<UserDto>("/me");
  const wallet = useApi<WalletDto>("/wallet");
  const tx = useApi<{ items: LedgerLineDto[] }>("/wallet/transactions?limit=30");
  const toast = useToast();
  const { locale, setLocale } = useLocale();
  const b = wallet.data?.balances;
  const link = me.data ? (appLink(`ref_${me.data.referralCode}`) ?? me.data.referralCode) : "";

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">
        {me.data?.firstName ?? me.data?.username ?? t("common.owner")}
      </h1>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {b ? (
          (
            [
              [t("profile.credits"), b.CREDITS],
              [t("profile.gems"), b.GEMS],
              [t("profile.reputation"), b.REPUTATION],
              [t("profile.prestige"), b.PRESTIGE],
            ] as const
          ).map(([k, v]) => (
            <Card key={k} className="p-3">
              <p className="text-xs uppercase tracking-wider text-muted">{k}</p>
              <p className="num font-display text-2xl font-bold text-gold">{fmt(v)}</p>
            </Card>
          ))
        ) : (
          <Skeleton className="col-span-2 h-24" />
        )}
      </div>

      <LinkButton href="/silks/" variant="secondary" className="mt-3 w-full">
        <Shirt className="size-4" aria-hidden />
        {t("profile.silks")}
      </LinkButton>

      {me.data && me.data.role !== "PLAYER" && (
        <LinkButton href="/admin/" variant="secondary" className="mt-3 w-full">
          <ShieldCheck className="size-4" aria-hidden />
          {t("profile.admin", { role: titleCase(me.data.role) })}
        </LinkButton>
      )}

      <SectionTitle>{t("profile.language")}</SectionTitle>
      <div
        className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1"
        role="radiogroup"
        aria-label={t("profile.language")}
      >
        {LOCALES.map((l) => (
          <button
            key={l.id}
            role="radio"
            aria-checked={locale === l.id}
            lang={l.id}
            onClick={() => {
              setLocale(l.id);
              // Remembered on the server too, so the bot writes in the same language.
              void put("/me/settings", { locale: l.id }).catch(() => undefined);
            }}
            className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-medium ${locale === l.id ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
          >
            <Languages className="size-4" aria-hidden />
            {l.label}
          </button>
        ))}
      </div>

      {me.data && (
        <Card className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium" id="notif-label">
              {t("profile.notifications")}
            </p>
            <p className="text-xs text-muted">{t("profile.notificationsHint")}</p>
          </div>
          <button
            role="switch"
            aria-checked={me.data.settings.notifications}
            aria-labelledby="notif-label"
            onClick={async () => {
              const next = !me.data!.settings.notifications;
              await put("/me/settings", { notifications: next })
                .then(() => invalidate("/me"))
                .catch((e: unknown) => toast(errorMessage(e), "bad"));
            }}
            className={`min-h-11 shrink-0 cursor-pointer rounded-full px-4 text-sm font-medium ${me.data.settings.notifications ? "bg-gold text-bg" : "bg-surface-2 text-muted"}`}
          >
            {me.data.settings.notifications ? t("profile.on") : t("profile.off")}
          </button>
        </Card>
      )}

      <SectionTitle>{t("profile.invite")}</SectionTitle>
      <Card>
        <p className="text-sm text-muted">{t("profile.inviteText")}</p>
        <p className="num mt-2 break-all rounded-lg bg-surface-2 px-3 py-2 text-sm">{link || "…"}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            className="text-sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(link).catch(() => undefined);
              toast(t("profile.copied"));
            }}
          >
            <Copy className="size-4" aria-hidden />
            {t("profile.copy")}
          </Button>
          <Button className="text-sm" onClick={() => shareToTelegram(t("profile.shareText"), link)}>
            <Share2 className="size-4" aria-hidden />
            {t("profile.share")}
          </Button>
        </div>
      </Card>

      <SectionTitle>{t("profile.history")}</SectionTitle>
      <Card className="divide-y divide-line/40 p-0">
        {!tx.data && <Skeleton className="h-32" />}
        {tx.data?.items.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">{ledgerText(l)}</p>
              <p className="text-xs text-muted">
                {new Date(l.createdAt).toLocaleString(getLocale() === "uk" ? "uk-UA" : [], {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <span className={`num shrink-0 text-sm font-semibold ${l.amount > 0 ? "text-good" : "text-ink"}`}>
              {l.amount > 0 ? "+" : ""}
              {fmt(l.amount)}{" "}
              {l.currency === "CREDITS" ? t("common.cr") : titleCase(l.currency).toLowerCase()}
            </span>
          </div>
        ))}
      </Card>

      <SectionTitle>{t("profile.help")}</SectionTitle>
      <Card className="text-sm text-muted">
        <p className="flex items-center gap-2 font-medium text-ink">
          <LifeBuoy className="size-4" aria-hidden />
          {t("profile.support")}
        </p>
        <p className="mt-1">{t("profile.supportText", { pay: "/paysupport", help: "/help" })}</p>
        <p className="mt-2">{t("profile.virtual")}</p>
      </Card>
    </div>
  );
}

/** Server reasons are English; in other languages the ledger type reads better. */
const ledgerText = (l: LedgerLineDto) => {
  const k = `ledger.${l.type}`;
  if (getLocale() !== "en" && has(k)) return t(k);
  return l.reason ?? (has(k) ? t(k) : titleCase(l.type));
};
