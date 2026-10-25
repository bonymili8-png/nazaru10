"use client";
import type { MarketingAdminDto, MarketingItemDto, MarketingKind } from "@thoroughline/contracts";
import { useState } from "react";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { getToken, post } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { SocialNetworks } from "./SocialNetworks";
import { SwitchHistory, Toggle } from "./Toggle";

const KIND_LABEL: Record<MarketingKind, string> = {
  RACE_OF_THE_DAY: "Race of the day",
  TOURNAMENT_CHAMPION: "Tournament champion",
  FIRST_WIN: "First win",
  WEEKLY_TOP: "Top of the week (Mondays)",
};

const field =
  "mt-1 min-h-11 w-full rounded-xl border border-line/60 bg-surface-2 px-3 text-base text-ink placeholder:text-muted focus:border-gold focus:outline-none";

/** Telegram HTML caption → plain text for the console (bold kept as plain words). */
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

/**
 * Automatic posts to the game's own Telegram channel: whether the bot can post there, the kill
 * switches, the queue (preview, skip) and what went out. Posting itself runs on its own.
 */
export function Marketing() {
  const path = "/admin/marketing";
  const { data, error, reload } = useApi<MarketingAdminDto>(path, { refreshMs: 30_000 });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [channel, setChannel] = useState("");
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="mt-3 h-64" />;

  const act = async (key: string, url: string, body: unknown, done?: string) => {
    setBusy(key);
    try {
      const r = await post<MarketingAdminDto & { published?: number }>(url, body);
      if (done) toast(done);
      if (r.published === 0)
        toast("Nothing posted (queue empty, daily limit reached, paused or switched off)");
      invalidate(path, "/admin/campaigns", "/admin/audit");
      return true;
    } catch (e) {
      toast(errorMessage(e), "bad");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const flip = (key: string, enabled: boolean, label: string) => {
    if (!window.confirm(`${enabled ? "Switch on" : "Switch off"}: ${label}?`)) return;
    void act(`switch:${key}`, `${path}/switch`, { key, enabled });
  };
  const tg = data.telegram;

  return (
    <>
      <p className="mt-3 text-xs text-muted">
        Posts about real game events go to the game&apos;s own channel only, in English, with a card image and
        buttons that carry each kind&apos;s campaign code (see the campaigns tab for the players they bring).
        Everything runs on its own; these are the controls.
      </p>

      <SectionTitle>Telegram channel</SectionTitle>
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">
              {tg.channel}{" "}
              <Badge tone={tg.status.ok ? "good" : "bad"}>
                {tg.status.ok ? "bot can post" : "cannot post"}
              </Badge>
            </p>
            <p className="text-xs text-muted">
              {tg.status.ok ? tg.status.title : tg.status.error} · {tg.publishedToday}/{tg.maxPerDay} today ·
              every {Math.round(tg.minGapMinutes / 60)} h at most · {tg.window[0]}:00–{tg.window[1]}:00 UTC ·
              last post {time(tg.lastPublishedAt)}
            </p>
            {!tg.links.web && (
              <p className="mt-1 text-xs text-warn">
                WEBAPP_URL is not set on the API: posts carry only the &quot;Play free&quot; button.
              </p>
            )}
          </div>
        </div>
        {tg.paused && (
          <div className="rounded-xl border border-bad/50 bg-bad/10 p-3 text-sm">
            <p className="font-semibold text-bad">Paused after repeated errors</p>
            <p className="text-xs text-muted">
              {tg.paused.reason} · {time(tg.paused.at)}
            </p>
            <Button
              variant="secondary"
              className="mt-2 w-full"
              loading={busy === "resume"}
              onClick={() => void act("resume", `${path}/resume`, {}, "Posting resumed")}
            >
              Resume posting
            </Button>
          </div>
        )}
        <div className="divide-y divide-line/40">
          {(
            [
              ["ALL", "Automatic posting", data.enabled],
              ["TELEGRAM", "Telegram channel", tg.enabled],
            ] as const
          ).map(([key, label, on]) => (
            <div key={key} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm font-medium">{label}</span>
              <Toggle
                on={on}
                label={label}
                busy={busy === `switch:${key}`}
                onFlip={() => flip(key, !on, label)}
              />
            </div>
          ))}
          {(Object.keys(KIND_LABEL) as MarketingKind[]).map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">
                {KIND_LABEL[k]} <span className="num text-xs text-muted">· {data.campaigns[k]}</span>
              </span>
              <Toggle
                on={data.kinds[k]}
                label={KIND_LABEL[k]}
                busy={busy === `switch:${k}`}
                onFlip={() => flip(k, !data.kinds[k], KIND_LABEL[k])}
              />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            className="text-sm"
            loading={busy === "detect"}
            onClick={() => void act("detect", `${path}/detect`, {}, "Checked for new events")}
          >
            Find new posts
          </Button>
          <Button
            variant="secondary"
            className="text-sm"
            loading={busy === "publish"}
            onClick={() => {
              if (window.confirm("Post the next queued item to the channel now?"))
                void act("publish", `${path}/publish-next`, {});
            }}
          >
            Publish next now
          </Button>
        </div>
        <label className="block text-xs text-muted">
          Change the channel (the bot must be its admin)
          <div className="mt-1 flex gap-2">
            <input
              value={channel}
              onChange={(e) => setChannel(e.target.value.trim())}
              placeholder="@thoroughline_racing"
              aria-label="Channel handle"
              className={`${field} mt-0`}
            />
            <Button
              variant="secondary"
              disabled={!/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(channel)}
              loading={busy === "channel"}
              onClick={async () => {
                if (await act("channel", `${path}/channel`, { channel }, `Posting to ${channel}`))
                  setChannel("");
              }}
            >
              Save
            </Button>
          </div>
        </label>
        <SwitchHistory history={data.history} />
      </Card>

      <SocialNetworks />

      <SectionTitle>Queue ({data.queue.length})</SectionTitle>
      <div className="space-y-2">
        {data.queue.length === 0 && (
          <p className="text-sm text-muted">Nothing waiting. New events are picked up every half minute.</p>
        )}
        {data.queue.map((i) => (
          <Item key={i.id} item={i}>
            <Button
              variant="ghost"
              className="min-h-9 px-2 text-xs"
              loading={busy === `skip:${i.id}`}
              onClick={() => void act(`skip:${i.id}`, `${path}/items/${i.id}/skip`, {}, "Will not be posted")}
            >
              Don&apos;t post
            </Button>
          </Item>
        ))}
      </div>

      <SectionTitle>Recent</SectionTitle>
      <div className="space-y-2">
        {data.recent.length === 0 && <p className="text-sm text-muted">Nothing posted yet.</p>}
        {data.recent.map((i) => (
          <Item key={i.id} item={i} channel={tg.channel} />
        ))}
      </div>
    </>
  );
}

function Item({
  item,
  channel,
  children,
}: {
  item: MarketingItemDto;
  channel?: string;
  children?: React.ReactNode;
}) {
  const [img, setImg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [video, setVideo] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const toast = useToast();
  const tone = { QUEUED: "neutral", PUBLISHED: "good", SKIPPED: "neutral", FAILED: "bad" } as const;
  const show = async () => {
    setLoading(true);
    try {
      const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const r = await fetch(`${base}/admin/marketing/items/${item.id}/image`, {
        headers: { authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (r.ok) setImg(URL.createObjectURL(await r.blob()));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card className="text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{KIND_LABEL[item.kind]}</p>
        <Badge tone={tone[item.status]}>{item.status.toLowerCase()}</Badge>
      </div>
      <p className="mt-1 whitespace-pre-line text-xs text-muted">{plain(item.caption)}</p>
      {img && <img src={img} alt="Post card" className="mt-2 w-full rounded-lg" />}
      {video && (
        <video
          src={video}
          controls
          playsInline
          className="mx-auto mt-2 max-h-[70vh] rounded-lg"
          aria-label="Race video"
        />
      )}
      <p className="num mt-2 text-[11px] text-muted">
        {item.status === "PUBLISHED" ? `posted ${time(item.publishedAt)}` : `queued ${time(item.createdAt)}`}
        {item.status === "QUEUED" && ` · expires ${time(item.expiresAt)}`}
        {item.lastError && ` · ${item.lastError}`}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {!img && (
          <Button
            variant="ghost"
            className="min-h-9 px-2 text-xs"
            loading={loading}
            onClick={() => void show()}
          >
            Preview card
          </Button>
        )}
        {!video && item.kind !== "WEEKLY_TOP" && (
          <Button
            variant="ghost"
            className="min-h-9 px-2 text-xs"
            loading={rendering}
            onClick={async () => {
              setRendering(true);
              try {
                setVideo((await post<{ url: string }>(`/admin/marketing/items/${item.id}/video`, {})).url);
              } catch (e) {
                toast(errorMessage(e), "bad");
              } finally {
                setRendering(false);
              }
            }}
          >
            {rendering ? "Making the video…" : "Video"}
          </Button>
        )}
        {item.status === "PUBLISHED" && channel && item.externalId && (
          <a
            href={`https://t.me/${channel.slice(1)}/${item.externalId}`}
            target="_blank"
            rel="noopener"
            className="text-xs text-gold underline underline-offset-2"
          >
            Open in the channel
          </a>
        )}
        {children}
      </div>
    </Card>
  );
}
