"use client";
import { Send } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { t } from "@/lib/i18n";

/** Header and call to action for the public share pages (opened from links outside the app). */
export function PublicFrame({ play, cta, children }: { play: string; cta: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-10 pt-4">
      <header className="flex items-center justify-between gap-3">
        <a href={play} className="font-display text-xl font-bold tracking-wide text-gold">
          Thoroughline
        </a>
        <a
          href={play}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-gold px-4 text-sm font-semibold text-bg"
        >
          <Send className="size-4" aria-hidden />
          {t("pub.playFree")}
        </a>
      </header>
      {children}
      <Card className="mt-6 bg-gradient-to-br from-surface to-surface-2 text-center">
        <p className="font-display text-xl font-bold">{cta}</p>
        <p className="mt-1 text-sm text-muted">{t("pub.pitch")}</p>
        <a
          href={play}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 font-semibold text-bg"
        >
          <Send className="size-4" aria-hidden />
          {t("pub.playInTelegram")}
        </a>
        <p className="mt-2 text-xs text-muted">{t("pub.needsTelegram")}</p>
      </Card>
    </main>
  );
}
