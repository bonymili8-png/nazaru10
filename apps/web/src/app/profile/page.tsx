"use client";
import type { LedgerLineDto, UserDto, WalletDto } from "@thoroughline/contracts";
import { Copy, LifeBuoy, Share2, ShieldCheck, Shirt } from "lucide-react";
import { Button, Card, LinkButton, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { fmt, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { appLink, shareToTelegram } from "@/lib/telegram";

export default function ProfilePage() {
  const me = useApi<UserDto>("/me");
  const wallet = useApi<WalletDto>("/wallet");
  const tx = useApi<{ items: LedgerLineDto[] }>("/wallet/transactions?limit=30");
  const toast = useToast();
  const b = wallet.data?.balances;
  const link = me.data ? (appLink(`ref_${me.data.referralCode}`) ?? me.data.referralCode) : "";

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">
        {me.data?.firstName ?? me.data?.username ?? "Owner"}
      </h1>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {b ? (
          (
            [
              ["Credits", b.CREDITS],
              ["Gems", b.GEMS],
              ["Reputation", b.REPUTATION],
              ["Prestige", b.PRESTIGE],
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
        Racing silks
      </LinkButton>

      {me.data && me.data.role !== "PLAYER" && (
        <LinkButton href="/admin/" variant="secondary" className="mt-3 w-full">
          <ShieldCheck className="size-4" aria-hidden />
          Admin console · {titleCase(me.data.role)}
        </LinkButton>
      )}

      <SectionTitle>Invite friends</SectionTitle>
      <Card>
        <p className="text-sm text-muted">
          When a friend you invite runs their first race, you both get 500 credits.
        </p>
        <p className="num mt-2 break-all rounded-lg bg-surface-2 px-3 py-2 text-sm">{link || "…"}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            className="text-sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(link).catch(() => undefined);
              toast("Copied");
            }}
          >
            <Copy className="size-4" aria-hidden />
            Copy
          </Button>
          <Button
            className="text-sm"
            onClick={() => shareToTelegram("Join my racing stable on Thoroughline 🏇", link)}
          >
            <Share2 className="size-4" aria-hidden />
            Share
          </Button>
        </div>
      </Card>

      <SectionTitle>Wallet history</SectionTitle>
      <Card className="divide-y divide-line/40 p-0">
        {!tx.data && <Skeleton className="h-32" />}
        {tx.data?.items.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">{l.reason ?? titleCase(l.type)}</p>
              <p className="text-xs text-muted">
                {new Date(l.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
              </p>
            </div>
            <span className={`num shrink-0 text-sm font-semibold ${l.amount > 0 ? "text-good" : "text-ink"}`}>
              {l.amount > 0 ? "+" : ""}
              {fmt(l.amount)} {l.currency === "CREDITS" ? "cr" : l.currency.toLowerCase()}
            </span>
          </div>
        ))}
      </Card>

      <SectionTitle>Help</SectionTitle>
      <Card className="text-sm text-muted">
        <p className="flex items-center gap-2 font-medium text-ink">
          <LifeBuoy className="size-4" aria-hidden />
          Support
        </p>
        <p className="mt-1">
          Payment problems? Send <span className="text-ink">/paysupport</span> to the bot with your order
          details. For anything else use <span className="text-ink">/help</span>.
        </p>
        <p className="mt-2">Credits and gems are virtual items with no cash value and cannot be withdrawn.</p>
      </Card>
    </div>
  );
}
