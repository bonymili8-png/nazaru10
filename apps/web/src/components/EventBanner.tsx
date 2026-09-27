"use client";
import type { LiveEventDto } from "@thoroughline/contracts";
import { PartyPopper } from "lucide-react";
import { CLASS_NAMES, countdown } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";

/** Live-ops events running now (or starting within a day), as a banner at the top of Home. */
export function EventBanner() {
  const { data } = useApi<LiveEventDto[]>("/events", { refreshMs: 60_000 });
  const now = useNow(1000);
  if (!data?.length) return null;
  return (
    <div className="mb-3 space-y-2">
      {data.map((e) => {
        const started = new Date(e.startsAt).getTime() <= now;
        const m = e.multiplier.toFixed(e.multiplier % 1 ? 1 : 0);
        const what =
          e.kind === "PURSE_BOOST" && e.classes
            ? t("event.PURSE_BOOST.classes", { m, classes: e.classes.map((c) => CLASS_NAMES[c]).join(", ") })
            : t(e.kind === "PURSE_BOOST" ? "event.PURSE_BOOST" : "event.PASS_XP_BOOST", { m });
        return (
          <div
            key={e.id}
            className="flex items-center gap-3 rounded-[var(--radius-card)] border border-gold/50 bg-gradient-to-r from-gold/20 to-surface p-3"
            role="status"
          >
            <PartyPopper className="size-6 shrink-0 text-gold" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{e.title}</p>
              <p className="text-sm text-gold">{what}</p>
            </div>
            <p className="num shrink-0 text-right text-xs text-muted">
              {started
                ? t("event.endsIn", { time: countdown(e.endsAt, now) })
                : t("event.startsIn", { time: countdown(e.startsAt, now) })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
