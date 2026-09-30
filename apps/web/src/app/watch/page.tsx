"use client";
import type { ShowdownDto } from "@thoroughline/contracts";
import { Maximize } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CurrentRace, ModeBadge, PastRaces, Standings } from "@/components/Showdown";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { t } from "@/lib/i18n";

/**
 * The public broadcast of a showdown — no sign-in, no app chrome — made to be screen-shared or
 * recorded: TikTok Live, Instagram, YouTube, OBS. Portrait first, like a phone stream.
 */
export default function WatchPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-64" />}>
      <WatchPage />
    </Suspense>
  );
}

function WatchPage() {
  const code = useSearchParams().get("code")?.toUpperCase() ?? "";
  const {
    data: s,
    error,
    reload,
  } = useApi<ShowdownDto>(code ? `/public/showdowns/${code}` : null, {
    refreshMs: 3000,
  });
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-8 pt-4">
      {!code && <ErrorState error={new Error(t("showdown.noCode"))} />}
      {error && <ErrorState error={error} retry={reload} />}
      {code && !s && !error && <Skeleton className="h-64" />}
      {s && <Broadcast s={s} />}
    </main>
  );
}

function Broadcast({ s }: { s: ShowdownDto }) {
  const live = s.races[0]?.status === "RUNNING";
  const fullscreen = () => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.3em] text-gold">
            Thoroughline · {t("showdown.title")}
          </p>
          <h1 className="truncate font-display text-2xl font-bold">{s.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <ModeBadge mode={s.mode} />
            {live && (
              <span className="flex items-center gap-1.5 rounded-full bg-bad px-2 py-0.5 text-xs font-bold text-white">
                <span className="size-2 animate-pulse rounded-full bg-white" aria-hidden />
                {t("showdown.live")}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={fullscreen}
          aria-label={t("showdown.fullscreen")}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:text-ink"
        >
          <Maximize className="size-5" aria-hidden />
        </button>
      </header>

      <CurrentRace s={s} livePath={(id) => `/public/showdowns/${s.code}/races/${id}/live`} />
      {!s.races.length && (
        <Card className="mt-4 text-center text-sm text-muted">{t("showdown.waitingFirst")}</Card>
      )}

      <div className="mt-4">
        <Standings s={s} compact />
      </div>
      <p className="mt-3 text-center text-xs text-muted">{t("showdown.joinOnAir", { code: s.code })}</p>
      <PastRaces s={s} />
    </>
  );
}
