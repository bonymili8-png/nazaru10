"use client";
import { CAMPAIGN_PLATFORMS, type CampaignDto, type CampaignPlatform } from "@thoroughline/contracts";
import { Copy } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionTitle,
  Skeleton,
  useToast,
} from "@/components/ui";
import { post } from "@/lib/api";
import { errorMessage, fmt, titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { appLink } from "@/lib/telegram";

const PERIODS = [
  ["7 days", 7],
  ["30 days", 30],
  ["90 days", 90],
  ["All time", null],
] as const;

const field =
  "mt-1 min-h-11 w-full rounded-xl border border-line/60 bg-surface-2 px-3 text-base text-ink placeholder:text-muted focus:border-gold focus:outline-none";

/** The tracked link (counts the visit, then opens the Mini App) and the direct Mini App link. */
const trackedLink = (code: string) => `${window.location.origin}/go/?c=${code}`;

/**
 * Campaign links for partners — a group admin, an author, a channel — each with its own funnel:
 * visits → opened the game → new players → first race → came back / still playing → paid.
 */
export function Campaigns() {
  const [days, setDays] = useState<number | null>(30);
  // Rounded to the hour so the polled URL (and its cache) stays stable within the hour.
  const from =
    days === null ? null : new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - days * 86_400_000);
  const path = `/admin/campaigns${from ? `?from=${encodeURIComponent(from.toISOString())}` : ""}`;
  const { data, error, reload } = useApi<CampaignDto[]>(path, { refreshMs: 60_000 });
  return (
    <>
      <CreateCampaign onCreated={() => invalidate(path)} />
      <SectionTitle>Links and results</SectionTitle>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Period">
        {PERIODS.map(([label, d]) => (
          <button
            key={label}
            role="radio"
            aria-checked={days === d}
            onClick={() => setDays(d)}
            className={`min-h-10 cursor-pointer rounded-full border px-3 text-sm ${days === d ? "border-gold bg-gold/10 text-ink" : "border-line/60 text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Visits and opens are counted in the period; what the new players did next (first race, coming back,
        buying) is counted to date.
      </p>
      {error && <ErrorState error={error} retry={reload} />}
      {!data && !error && <Skeleton className="mt-3 h-40" />}
      {data?.length === 0 && (
        <EmptyState title="No campaign links yet" body="Create one above for each partner." />
      )}
      <div className="mt-3 space-y-3">
        {data?.map((c) => (
          <CampaignCard key={c.id} c={c} refresh={path} />
        ))}
      </div>
    </>
  );
}

function CreateCampaign({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [partner, setPartner] = useState("");
  const [platform, setPlatform] = useState<CampaignPlatform>("FACEBOOK");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const c = await post<CampaignDto>("/admin/campaigns", {
        name,
        platform,
        ...(partner.trim() ? { partner } : {}),
        ...(code.trim() ? { code } : {}),
        ...(note.trim() ? { note } : {}),
      });
      toast(`Link ${c.code} created`);
      setName("");
      setPartner("");
      setCode("");
      setNote("");
      onCreated();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle>New campaign link</SectionTitle>
      <Card>
        <label className="block text-sm">
          Name (where it will be posted)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="UK Horse Racing Fans · Facebook"
            className={field}
          />
        </label>
        <label className="mt-3 block text-sm">
          Partner (group admin or author)
          <input
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
            maxLength={80}
            placeholder="John Smith"
            className={field}
          />
        </label>
        <p className="mt-3 text-sm">Platform</p>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Platform">
          {CAMPAIGN_PLATFORMS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={platform === p}
              onClick={() => setPlatform(p)}
              className={`min-h-10 cursor-pointer rounded-full border px-3 text-sm ${platform === p ? "border-gold bg-gold/10 text-ink" : "border-line/60 text-muted"}`}
            >
              {titleCase(p)}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-sm">
          Code (optional — letters and digits, else generated)
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={12}
            placeholder="UKFANS"
            className={`${field} font-mono tracking-widest`}
          />
        </label>
        <label className="mt-3 block text-sm">
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Post on Friday, 3,200 members"
            className={field}
          />
        </label>
        <Button
          className="mt-3 w-full"
          loading={busy}
          disabled={name.trim().length < 2}
          onClick={() => void create()}
        >
          Create link
        </Button>
      </Card>
    </>
  );
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

function CampaignCard({ c, refresh }: { c: CampaignDto; refresh: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const f = c.funnel;
  const tracked = trackedLink(c.code);
  const direct = appLink(c.startParam);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      window.prompt("Copy the link:", text);
    }
  };
  const toggle = async () => {
    if (
      !c.archived &&
      !window.confirm(`Archive ${c.code}? Its link stops counting and opening as a campaign.`)
    )
      return;
    setBusy(true);
    try {
      await post(`/admin/campaigns/${c.id}/${c.archived ? "restore" : "archive"}`);
      invalidate(refresh);
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  // Each stage with its share of the stage that feeds it.
  const rows: [string, number, string][] = [
    ["Link visits", f.clicks, `${fmt(f.visitors)} unique`],
    ["Opened the game", f.opened, pct(f.opened, f.visitors)],
    ["New players", f.newPlayers, pct(f.newPlayers, f.opened)],
    ["Ran a first race", f.firstRace, pct(f.firstRace, f.newPlayers)],
    ["Came back another day", f.returned, pct(f.returned, f.newPlayers)],
    ["Active in the last 7 days", f.active7d, pct(f.active7d, f.newPlayers)],
    ["Bought gems", f.payers, pct(f.payers, f.newPlayers)],
  ];
  const max = Math.max(1, f.clicks, f.opened);
  return (
    <Card className={c.archived ? "opacity-70" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.name}</p>
          <p className="truncate text-xs text-muted">
            {c.partner ?? "No partner set"} · created {new Date(c.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone="gold">{titleCase(c.platform)}</Badge>
          {c.archived && <Badge>Archived</Badge>}
        </div>
      </div>
      <p className="num mt-2 font-mono text-lg font-bold tracking-widest text-gold">{c.code}</p>
      {c.note && <p className="text-xs text-muted">{c.note}</p>}

      <div className="mt-2 space-y-1.5">
        {[
          ["Tracked link (counts visits)", tracked],
          ...(direct ? ([["Direct Telegram link", direct]] as const) : []),
        ].map(([label, url]) => (
          <div key={label} className="flex items-center gap-2 rounded-lg bg-bg/40 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
              <p className="truncate font-mono text-xs">{url}</p>
            </div>
            <button
              onClick={() => void copy(url)}
              aria-label={`Copy ${label}`}
              className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:text-gold"
            >
              <Copy className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.map(([label, n, sub], i) => (
          <div key={label}>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-muted">{label}</dt>
              <dd className="num shrink-0">
                <span className="font-semibold">{fmt(n)}</span>{" "}
                <span className="text-xs text-muted">{sub}</span>
              </dd>
            </div>
            {i < 3 && (
              <div className="mt-0.5 h-1.5 rounded-full bg-bg/60" aria-hidden>
                <div className="h-full rounded-full bg-gold/70" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            )}
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2 border-t border-line/40 pt-1.5">
          <dt className="text-muted">Stars paid by its new players</dt>
          <dd className="num font-semibold text-gold">{fmt(f.stars)} ⭐</dd>
        </div>
      </dl>
      <Button variant="ghost" className="mt-2 w-full text-sm" loading={busy} onClick={() => void toggle()}>
        {c.archived ? "Restore link" : "Archive link"}
      </Button>
    </Card>
  );
}
