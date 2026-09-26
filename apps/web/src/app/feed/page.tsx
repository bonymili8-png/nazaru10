"use client";
import type { FeedItemDto } from "@thoroughline/contracts";
import { useState } from "react";
import { FeedList } from "@/components/Feed";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { t } from "@/lib/i18n";

export default function FeedPage() {
  const [scope, setScope] = useState<"all" | "club">("all");
  const { data, error, reload } = useApi<FeedItemDto[]>(`/feed?scope=${scope}&limit=50`, {
    refreshMs: 30_000,
  });
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("feed.title")}</h1>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1" role="tablist">
        {(["all", "club"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            onClick={() => setScope(s)}
            className={`min-h-10 cursor-pointer rounded-lg text-sm font-medium ${scope === s ? "bg-gold text-bg" : "text-muted"}`}
          >
            {s === "all" ? t("feed.all") : t("feed.club")}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {error && <ErrorState error={error} retry={reload} />}
        {!data && !error && <Skeleton className="h-64" />}
        {data?.length === 0 && (
          <EmptyState
            title={t("feed.emptyTitle")}
            body={scope === "club" ? t("feed.emptyClub") : t("feed.emptyAll")}
          />
        )}
        {!!data?.length && <FeedList items={data} />}
      </div>
    </div>
  );
}
