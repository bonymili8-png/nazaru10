"use client";
import type { OwnerCardDto } from "@thoroughline/contracts";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Crest } from "@/components/Crest";
import { MemberBadge } from "@/components/MemberBadge";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { t } from "@/lib/i18n";

/** Find other owners by name, username or stable name, and open their stables. */
export default function OwnersPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  // Search as the owner types, without a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);
  const { data, error, reload } = useApi<OwnerCardDto[]>(
    query.length >= 2 ? `/owners?q=${encodeURIComponent(query)}` : null,
  );
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("owners.title")}</h1>
      <label className="relative mt-3 block">
        <span className="sr-only">{t("owners.search")}</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("owners.placeholder")}
          maxLength={40}
          autoFocus
          className="min-h-12 w-full rounded-xl border border-line/60 bg-surface-2 pl-11 pr-3 text-base text-ink placeholder:text-muted focus:border-gold focus:outline-none"
        />
      </label>
      <p className="mt-2 text-xs text-muted">{t("owners.hint")}</p>
      <div className="mt-3 space-y-2">
        {error && <ErrorState error={error} retry={reload} />}
        {query.length >= 2 && !data && !error && <Skeleton className="h-20" />}
        {data?.length === 0 && <EmptyState title={t("owners.none")} body={t("owners.noneBody")} />}
        {data?.map((o) => (
          <Link key={o.userId} href={`/owner/?id=${o.userId}`} className="block">
            <Card className="flex items-center gap-3 transition-colors hover:border-gold/40">
              <Crest crest={o.crest} size={40} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate font-semibold">
                  {o.stableName}
                  {o.member && <MemberBadge />}
                </p>
                <p className="truncate text-xs text-muted">
                  {o.name} · {t("owners.level", { n: o.level })} · {t("owners.horses", { n: o.horses })}
                </p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
