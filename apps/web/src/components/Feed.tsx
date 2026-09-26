"use client";
import type { FeedItemDto, FeedKind } from "@thoroughline/contracts";
import { Baby, Crown, Flag, Gavel, Medal, Users } from "lucide-react";
import { fmt } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";

const ICON: Record<FeedKind, typeof Flag> = {
  WIN: Flag,
  CHAMPION: Crown,
  BIG_SALE: Gavel,
  FOAL: Baby,
  SEASON_TOP: Medal,
  CLUB_CREATED: Users,
};

/** "5 min ago", "3 h ago", "2 d ago". */
function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("feed.now");
  if (s < 3600) return t("feed.minAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("feed.hAgo", { n: Math.floor(s / 3600) });
  return t("feed.dAgo", { n: Math.floor(s / 86400) });
}

export function FeedList({ items }: { items: FeedItemDto[] }) {
  const now = useNow(60_000);
  return (
    <ul className="divide-y divide-line/40 rounded-[var(--radius-card)] border border-line/60 bg-surface">
      {items.map((f) => {
        const Icon = ICON[f.kind] ?? Flag;
        const text = t(`feed.${f.kind}` as MessageKey, {
          ...f.vars,
          name: f.actorName,
          price: typeof f.vars.price === "number" ? fmt(f.vars.price) : (f.vars.price ?? ""),
        });
        const body = (
          <div className="flex items-start gap-3 px-4 py-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
            <p className="min-w-0 flex-1 text-sm leading-snug">{text}</p>
            <span className="shrink-0 text-xs text-muted">{ago(f.createdAt, now)}</span>
          </div>
        );
        return (
          <li key={f.id}>
            {f.link ? (
              <a href={f.link} className="block hover:bg-surface-2">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
