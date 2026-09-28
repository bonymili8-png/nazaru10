"use client";
import { ChevronLeft } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useCallback, useEffect } from "react";
import { t } from "@/lib/i18n";
import { tg } from "@/lib/telegram";

/** Bottom-nav sections: they are roots, so no back button there. */
const ROOTS = new Set(["/", "/horses/", "/races/", "/rankings/", "/shop/"]);

/** Where "back" goes when the page was opened directly (deep link, reload): its section. */
function parentOf(path: string): string {
  if (path.startsWith("/horse/") || path.startsWith("/breeding/")) return "/horses/";
  if (path.startsWith("/race/") || path.startsWith("/tournament")) return "/races/";
  if (path.startsWith("/listing/")) return "/shop/";
  if (path.startsWith("/club/")) return "/rankings/";
  return "/";
}

/**
 * The session's in-app history (URLs incl. query), kept at module level so it survives
 * re-renders. "Back" navigates to the previous entry with the client router instead of
 * `history.back()`: inside Telegram's webview a history step can reload the whole app, while a
 * router navigation never does (and cached data shows instantly).
 */
const stack: string[] = [];
let pending: "back" | "replace" | null = null;
let popped = false;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (popped = true));

/** Call before `router.replace`: the next page takes the current one's place in history. */
export function markReplace(): void {
  pending = "replace";
}

function track(url: string): void {
  const top = stack[stack.length - 1];
  if (url !== top) {
    if (pending === "replace" && stack.length > 0) stack[stack.length - 1] = url;
    // The browser's own back button (outside Telegram) steps back through the same history.
    else if (popped && stack[stack.length - 2] === url) stack.pop();
    else {
      stack.push(url);
      if (stack.length > 50) stack.shift();
    }
  }
  pending = null;
  popped = false;
}

function useBack(): { show: boolean; back: () => void } {
  const path = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  useEffect(() => track(path + (search ? `?${search}` : "")), [path, search]);
  const back = useCallback(() => {
    if (stack.length > 1) {
      stack.pop();
      pending = "back";
      router.push(stack[stack.length - 1]!);
    } else {
      // Opened directly (deep link, reload): go up to the section instead of leaving the app.
      markReplace();
      router.replace(parentOf(path));
    }
  }, [path, router]);
  return { show: !ROOTS.has(path), back };
}

/** Telegram clients from Bot API 6.1 draw a Back button in the Mini App header. */
const hasNativeBack = () => {
  const app = tg();
  return !!app?.BackButton && (app.isVersionAtLeast?.("6.1") ?? true);
};

function Inner({ root }: { root: ReactNode }) {
  const { show, back } = useBack();

  // Telegram's own back button in the Mini App header mirrors the in-app one.
  useEffect(() => {
    const button = tg()?.BackButton;
    if (!button) return;
    if (!show) {
      button.hide();
      return;
    }
    button.onClick(back);
    button.show();
    return () => button.offClick(back);
  }, [show, back]);

  // Inside Telegram its header already shows "Back"; a second one in the page would be noise.
  if (!show || hasNativeBack()) return root;
  return (
    <button
      onClick={back}
      className="-ml-2 flex min-h-11 cursor-pointer items-center gap-0.5 rounded-lg pl-1 pr-2.5 text-sm font-medium text-muted transition-colors hover:text-ink"
    >
      <ChevronLeft className="size-5" aria-hidden />
      {t("shell.back")}
    </button>
  );
}

/**
 * Header back button (mirrored by Telegram's BackButton) on every page below a bottom-nav
 * section; on the sections themselves `root` (the logo) is shown instead.
 */
export function BackNav({ root }: { root: ReactNode }) {
  return (
    <Suspense fallback={root}>
      <Inner root={root} />
    </Suspense>
  );
}
