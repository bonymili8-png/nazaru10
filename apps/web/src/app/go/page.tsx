"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { appLink } from "@/lib/telegram";

/**
 * Landing page of a campaign link (`/go/?c=CODE`): counts the visit, then opens the game in
 * Telegram with the campaign's start parameter. No sign-in; works from any browser or app.
 */
export default function GoPageWrapper() {
  return (
    <Suspense fallback={null}>
      <GoPage />
    </Suspense>
  );
}

function GoPage() {
  const code = (useSearchParams().get("c") ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    let done = false;
    const open = (param: string | null) => {
      if (done) return;
      done = true;
      const url = appLink(param ?? "") ?? null;
      setTarget(url);
      if (url) window.location.replace(url);
    };
    // Count the visit, but never keep the visitor waiting for it.
    const timer = setTimeout(() => open(code ? `c_${code}` : null), 1500);
    if (code)
      api<{ startParam: string | null }>(`/public/campaigns/${code}/click`, { method: "POST", body: {} })
        .then((r) => open(r.startParam))
        .catch(() => open(`c_${code}`));
    else open(null);
    return () => clearTimeout(timer);
  }, [code]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-gold">Thoroughline</p>
      <h1 className="mt-3 font-display text-3xl font-bold">Opening the game in Telegram…</h1>
      <p className="mt-2 max-w-xs text-sm text-muted">
        Horse racing management — breed, train and race your own stable.
      </p>
      {target && (
        <a
          href={target}
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-gold px-5 font-semibold text-bg"
        >
          Open Thoroughline
        </a>
      )}
    </main>
  );
}
