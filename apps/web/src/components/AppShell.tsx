"use client";
import type { WalletDto } from "@thoroughline/contracts";
import { CircleUserRound, Flag, Gem, Home, Store, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getToken, loginDev, loginWithTelegram, onUnauthorized } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { initTelegram, tg } from "@/lib/telegram";
import { HorseIcon } from "./icons";
import { Button, ToastProvider } from "./ui";

type Phase = "booting" | "ready" | "login" | "outside" | "error";

const NAV = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/horses/", label: "Horses", Icon: HorseIcon },
  { href: "/races/", label: "Races", Icon: Flag },
  { href: "/rankings/", label: "Rankings", Icon: Trophy },
  { href: "/shop/", label: "Market", Icon: Store },
];

function routeForStartParam(p: string | undefined): string | null {
  if (!p) return null;
  const [kind, id] = p.split("_", 2);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (kind === "race") return `/race/?id=${id}`;
  if (kind === "horse") return `/horse/?id=${id}`;
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("booting");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const boot = useCallback(async () => {
    initTelegram();
    const app = tg();
    try {
      if (app) {
        await loginWithTelegram(app.initData);
        setPhase("ready");
        const target = routeForStartParam(app.initDataUnsafe.start_param);
        if (target) router.replace(target);
      } else if (getToken()) setPhase("ready");
      else setPhase(process.env.NEXT_PUBLIC_DEV_AUTH === "true" ? "login" : "outside");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }, [router]);

  useEffect(() => {
    void boot();
    return onUnauthorized(() => void boot());
  }, [boot]);

  return (
    <ToastProvider>
      {phase === "ready" ? (
        <Chrome>{children}</Chrome>
      ) : (
        <Gate
          phase={phase}
          error={error}
          onDevLogin={async (id, name) => {
            await loginDev(id, name);
            setPhase("ready");
          }}
          onRetry={boot}
        />
      )}
    </ToastProvider>
  );
}

function Gate({
  phase,
  error,
  onDevLogin,
  onRetry,
}: {
  phase: Phase;
  error: string | null;
  onDevLogin: (id: number, name: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-gold">Thoroughline</p>
      <h1 className="mt-3 font-display text-4xl font-bold leading-tight">Your racing empire starts here</h1>
      <p className="mt-3 max-w-xs text-muted">Build a stable, train champions and race for glory.</p>
      <div className="mt-8 w-full max-w-xs">
        {phase === "booting" && <div className="skeleton mx-auto h-11 w-full" />}
        {phase === "outside" && <p className="text-sm text-muted">Open this app from Telegram to sign in.</p>}
        {phase === "error" && (
          <>
            <p className="mb-3 text-sm text-bad" role="alert">
              {error}
            </p>
            <Button onClick={onRetry} className="w-full">
              Try again
            </Button>
          </>
        )}
        {phase === "login" && (
          <Button
            className="w-full"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const stored =
                  Number(localStorage.getItem("tl.devId")) || Math.floor(Math.random() * 1e9) + 1e6;
                localStorage.setItem("tl.devId", String(stored));
                await onDevLogin(stored, "Dev Owner");
              } finally {
                setBusy(false);
              }
            }}
          >
            Enter as developer
          </Button>
        )}
      </div>
    </main>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const path = usePathname();
  const wallet = useApi<WalletDto>("/wallet", { refreshMs: 30_000 });
  const b = wallet.data?.balances;
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line/40 bg-bg/90 px-4 py-2.5 backdrop-blur"
        style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
      >
        <Link href="/" className="font-display text-lg font-bold tracking-wide text-gold">
          Thoroughline
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/profile/"
            className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm"
            aria-label="Wallet and profile"
          >
            <span className="num font-semibold text-ink">{b ? fmt(b.CREDITS) : "—"}</span>
            <span className="text-xs text-muted">cr</span>
            <span className="h-3 w-px bg-line" aria-hidden />
            <Gem className="size-3.5 text-gold" aria-hidden />
            <span className="num font-semibold text-ink">{b ? fmt(b.GEMS) : "—"}</span>
          </Link>
          <Link
            href="/profile/"
            className="grid size-11 place-items-center rounded-full text-muted hover:text-ink"
            aria-label="Profile"
          >
            <CircleUserRound className="size-6" />
          </Link>
        </div>
      </header>
      <main className="flex-1 px-4 pb-28 pt-3">{children}</main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line/50 bg-bg/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Main"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {NAV.map(({ href, label, Icon }) => {
            const active =
              href === "/"
                ? path === "/"
                : path.startsWith(href.replace(/\/$/, "")) ||
                  (href === "/horses/" && path.startsWith("/horse")) ||
                  (href === "/races/" && path.startsWith("/race")) ||
                  (href === "/shop/" && path.startsWith("/listing"));
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${active ? "text-gold" : "text-muted hover:text-ink"}`}
                >
                  <Icon className="size-5" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
