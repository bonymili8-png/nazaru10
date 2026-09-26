"use client";
import type { ClubDetailDto, ClubSummaryDto, MyClubDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { ChevronRight, Users } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

/** Rankings → Clubs: the viewer's club (or founding one) and the club table. */
export function ClubsBoard() {
  const mine = useApi<MyClubDto>("/clubs/mine");
  const [q, setQ] = useState("");
  const list = useApi<ClubSummaryDto[]>(
    `/clubs?limit=30${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`,
  );
  const now = useNow(60_000);
  const cfg = defaultConfig.clubs;

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted">
        {t("club.rules", { max: cfg.maxMembers, h: cfg.rejoinCooldownHours })}
      </p>
      {mine.data?.clubId ? (
        <a
          href={`/club/?id=${mine.data.clubId}`}
          className="flex items-center justify-between rounded-[var(--radius-card)] border border-gold/50 bg-gold/10 px-4 py-3"
        >
          <span className="flex items-center gap-2 font-medium">
            <Users className="size-4 text-gold" aria-hidden />
            {t("club.yourClub")}
          </span>
          <ChevronRight className="size-4 text-muted" aria-hidden />
        </a>
      ) : mine.data ? (
        <FoundClub cost={mine.data.createCost} cooldown={mine.data.cooldownUntil} now={now} />
      ) : (
        <Skeleton className="h-16" />
      )}

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("club.search")}
        aria-label={t("club.search")}
        className="min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm"
      />
      {list.error && <ErrorState error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Skeleton className="h-40" />}
      {list.data?.length === 0 && <EmptyState title={t("club.emptyTitle")} body={t("club.emptyBody")} />}
      {!!list.data?.length && (
        <Card className="divide-y divide-line/40 p-0">
          {list.data.map((k) => (
            <a
              key={k.id}
              href={`/club/?id=${k.id}`}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-surface-2 ${k.id === mine.data?.clubId ? "bg-gold/10" : ""}`}
            >
              <span
                className={`num w-7 font-display text-lg font-bold ${k.rank && k.rank <= 3 ? "text-gold" : "text-muted"}`}
              >
                {k.rank ?? "—"}
              </span>
              <Badge tone="gold">{k.tag}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{k.name}</p>
                <p className="text-xs text-muted">{t("club.members", { n: k.members, max: k.maxMembers })}</p>
              </div>
              <span className="num font-semibold">{t("club.pts", { n: fmt(k.points) })}</span>
            </a>
          ))}
        </Card>
      )}
    </div>
  );
}

function FoundClub({ cost, cooldown, now }: { cost: number; cooldown: string | null; now: number }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (cooldown && new Date(cooldown).getTime() > now)
    return <Card className="text-sm text-muted">{t("club.cooldown", { t: countdown(cooldown, now) })}</Card>;
  if (!open)
    return (
      <Card className="space-y-3">
        <p className="text-sm text-muted">{t("club.none")}</p>
        <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
          {t("club.create")}
        </Button>
      </Card>
    );
  const field = "mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3";
  return (
    <Card className="space-y-3">
      <label className="block text-sm text-muted">
        {t("club.name")}
        <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} className={field} />
      </label>
      <label className="block text-sm text-muted">
        {t("club.tag")}
        <input
          value={tag}
          maxLength={4}
          onChange={(e) => setTag(e.target.value.toUpperCase())}
          className={`${field} uppercase`}
        />
      </label>
      <label className="block text-sm text-muted">
        {t("club.description")}
        <input
          value={description}
          maxLength={140}
          onChange={(e) => setDescription(e.target.value)}
          className={field}
        />
      </label>
      <Button
        className="w-full"
        loading={busy}
        disabled={name.trim().length < 3 || tag.trim().length < 2}
        onClick={async () => {
          if (!window.confirm(t("club.confirmCreate", { name: name.trim(), cost: fmt(cost) }))) return;
          setBusy(true);
          try {
            const club = await post<ClubDetailDto>("/clubs", { name, tag, description });
            haptic.success();
            toast(t("club.created"));
            invalidate("/clubs", "/wallet");
            window.location.href = `/club/?id=${club.id}`;
          } catch (e) {
            haptic.error();
            toast(errorMessage(e), "bad");
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("club.createCost", { cost: fmt(cost) })}
      </Button>
    </Card>
  );
}
