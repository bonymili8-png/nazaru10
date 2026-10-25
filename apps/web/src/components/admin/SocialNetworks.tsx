"use client";
import type {
  MarketingKind,
  SocialAdminDto,
  SocialPlatform,
  SocialPlatformDto,
} from "@thoroughline/contracts";
import { useState } from "react";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { openLink } from "@/lib/telegram";
import { Toggle } from "./Toggle";

const NAME: Record<SocialPlatform, string> = {
  YOUTUBE: "YouTube Shorts",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook Page",
  THREADS: "Threads",
  BLUESKY: "Bluesky",
};

/** How each network is set up the first time (the owner's own accounts, free tools only). */
const SETUP: Record<SocialPlatform, string> = {
  YOUTUBE:
    "Google Cloud console: a project with YouTube Data API v3, an OAuth client (Web) whose redirect URI is the Google address below, the consent screen published. Put its id and secret on the API as GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, then Connect with the Google account that owns the channel.",
  INSTAGRAM:
    "Comes with Facebook: the Instagram account must be Professional (Business or Creator) and linked to the game's Facebook Page.",
  FACEBOOK:
    "Meta for Developers: an app (Business type) with Facebook Login for Business, the Meta redirect address below as a valid OAuth redirect URI, the app switched to Live. Put its id and secret on the API as META_APP_ID / META_APP_SECRET, then Connect and allow the game's Page (and its Instagram account).",
  THREADS:
    "Meta for Developers: an app with the Threads use case, the Threads redirect address below as its callback. Put the Threads app id and secret on the API as THREADS_APP_ID / THREADS_APP_SECRET, then Connect.",
  BLUESKY:
    "Bluesky → Settings → Privacy and security → App passwords: create one. Put the handle and that app password on the API as BLUESKY_HANDLE / BLUESKY_APP_PASSWORD (never the account's own password).",
};

const KIND: Record<MarketingKind, string> = {
  RACE_OF_THE_DAY: "Race of the day",
  TOURNAMENT_CHAMPION: "Champion",
  FIRST_WIN: "First win",
  WEEKLY_TOP: "Top of the week",
};

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

/**
 * The game's own accounts on other networks: connecting each (its own sign-in, opened in the
 * browser), switches, limits, pauses and what went out. Posting runs on its own.
 */
export function SocialNetworks() {
  const path = "/admin/marketing/social";
  const { data, error, reload } = useApi<SocialAdminDto>(path, { refreshMs: 30_000 });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<{ platform: SocialPlatform; url: string } | null>(null);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="mt-3 h-48" />;

  const act = async <T,>(key: string, url: string, done?: string): Promise<T | null> => {
    setBusy(key);
    try {
      const r = await post<T>(url, {});
      if (done) toast(done);
      invalidate(path, "/admin/campaigns", "/admin/audit");
      return r;
    } catch (e) {
      toast(errorMessage(e), "bad");
      return null;
    } finally {
      setBusy(null);
    }
  };
  const flip = async (key: "ALL" | SocialPlatform, enabled: boolean, label: string) => {
    if (!window.confirm(`${enabled ? "Switch on" : "Switch off"}: ${label}?`)) return;
    setBusy(`switch:${key}`);
    try {
      await post(`${path}/switch`, { key, enabled });
      invalidate(path, "/admin/marketing");
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const connect = async (p: SocialPlatform) => {
    const r = await act<{ url: string }>(`connect:${p}`, `${path}/${p}/connect`);
    if (!r) return;
    setSignIn({ platform: p, url: r.url });
    openLink(r.url);
  };

  return (
    <>
      <SectionTitle>Other networks</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-muted">
        The same events go to the game&apos;s own accounts: a vertical race video (YouTube, Instagram,
        Facebook, Threads) or the card (Bluesky, the weekly top). Up to {data.maxPerDay} a day on each, at
        least {Math.round(data.minGapMinutes / 60)} h apart, {data.window[0]}:00–{data.window[1]}:00 UTC. Each
        network links through its own campaign.
      </p>
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Posting to other networks</span>
          <Toggle
            on={data.enabled}
            label="Posting to other networks"
            busy={busy === "switch:ALL"}
            onFlip={() => void flip("ALL", !data.enabled, "posting to other networks")}
          />
        </div>
        {!data.ffmpeg && (
          <p className="text-xs text-warn">
            ffmpeg is missing on the API: no videos, so YouTube and Instagram cannot post (the Docker image
            installs it).
          </p>
        )}
        {!data.apiUrl && (
          <p className="text-xs text-warn">
            The API&apos;s public address is unknown: set API_PUBLIC_URL (Railway sets it by itself when the
            service has a public domain).
          </p>
        )}
        {data.apiUrl && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer py-1">Redirect addresses to register</summary>
            {(["GOOGLE", "META", "THREADS"] as const).map((k) => (
              <p key={k} className="mt-1 break-all">
                <span className="font-medium text-ink">{k.charAt(0) + k.slice(1).toLowerCase()}:</span>{" "}
                <span className="num select-all">{data.redirectUris[k]}</span>
              </p>
            ))}
          </details>
        )}
      </Card>

      {signIn && (
        <Card className="mt-2 text-xs">
          <p className="text-sm font-medium">Finish signing in to {NAME[signIn.platform]} in the browser</p>
          <p className="mt-1 text-muted">
            When it says &quot;connected&quot;, come back and pull to refresh. If the page did not open, copy
            this link into a browser:
          </p>
          <p className="num mt-1 select-all break-all">{signIn.url}</p>
          <Button
            variant="ghost"
            className="mt-1 min-h-9 px-2 text-xs"
            onClick={() => {
              setSignIn(null);
              invalidate(path);
            }}
          >
            Done
          </Button>
        </Card>
      )}

      <div className="mt-2 space-y-2">
        {data.platforms.map((p) => (
          <Network
            key={p.platform}
            p={p}
            busy={busy}
            onFlip={() => void flip(p.platform, !p.enabled, NAME[p.platform])}
            onConnect={() => void connect(p.platform)}
            onAction={(what, done) => act(`${what}:${p.platform}`, `${path}/${p.platform}/${what}`, done)}
          />
        ))}
      </div>
    </>
  );
}

function Network({
  p,
  busy,
  onFlip,
  onConnect,
  onAction,
}: {
  p: SocialPlatformDto;
  busy: string | null;
  onFlip: () => void;
  onConnect: () => void;
  onAction: (what: string, done?: string) => Promise<unknown>;
}) {
  const toast = useToast();
  const name = NAME[p.platform];
  const ready = !!p.account && !p.account.error && p.missing.length === 0;
  const state = p.paused
    ? { tone: "bad" as const, text: "paused" }
    : ready
      ? { tone: "good" as const, text: "connected" }
      : p.account?.error
        ? { tone: "bad" as const, text: "needs attention" }
        : { tone: "neutral" as const, text: "not connected" };
  return (
    <Card className="space-y-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {name} <Badge tone={state.tone}>{state.text}</Badge>
          </p>
          <p className="text-xs text-muted">
            {p.account?.name ? `${p.account.name} · ` : ""}
            {p.publishedToday} today · last {time(p.lastPublishedAt)} · campaign{" "}
            <span className="num">{p.campaign}</span>
          </p>
          {p.account?.error && <p className="mt-1 text-xs text-bad">{p.account.error}</p>}
          {p.account?.expiresAt && (
            <p className="text-xs text-muted">
              Token renews itself · valid until {time(p.account.expiresAt)}
            </p>
          )}
        </div>
        <Toggle on={p.enabled} label={name} busy={busy === `switch:${p.platform}`} onFlip={onFlip} />
      </div>

      {p.missing.length > 0 && (
        <div className="rounded-xl bg-surface-2 p-3 text-xs text-muted">
          <p>
            Missing on the API (Railway → Variables):{" "}
            <span className="num font-medium text-ink">{p.missing.join(", ")}</span>
          </p>
          <p className="mt-1">{SETUP[p.platform]}</p>
        </div>
      )}
      {p.needsFfmpeg && p.platform === "INSTAGRAM" && !p.account && p.missing.length === 0 && (
        <p className="text-xs text-muted">{SETUP.INSTAGRAM}</p>
      )}

      {p.paused && (
        <div className="rounded-xl border border-bad/50 bg-bad/10 p-3 text-xs">
          <p className="font-semibold text-bad">Paused after repeated errors</p>
          <p className="text-muted">
            {p.paused.reason} · {time(p.paused.at)}
          </p>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            loading={busy === `resume:${p.platform}`}
            onClick={() => void onAction("resume", "Posting resumed")}
          >
            Resume posting
          </Button>
        </div>
      )}

      <p className="text-xs text-muted">
        Posts: {p.kinds.map((k) => KIND[k]).join(", ") || "none switched on"}
      </p>
      {p.bioLink && (
        <p className="text-xs text-muted">
          Link for the profile&apos;s bio:{" "}
          <span className="num select-all break-all text-ink">{p.bioLink}</span>
          <button
            className="ml-2 cursor-pointer text-gold underline underline-offset-2"
            onClick={() => {
              void navigator.clipboard?.writeText(p.bioLink!).then(() => toast("Link copied"));
            }}
          >
            Copy
          </button>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {p.connect === "OAUTH" && p.missing.length === 0 && (
          <Button
            variant={p.account ? "ghost" : "secondary"}
            className="min-h-9 px-3 text-xs"
            loading={busy === `connect:${p.platform}`}
            onClick={onConnect}
          >
            {p.account ? "Reconnect" : p.platform === "INSTAGRAM" ? "Connect (via Facebook)" : "Connect"}
          </Button>
        )}
        {p.account && (
          <>
            <Button
              variant="ghost"
              className="min-h-9 px-3 text-xs"
              loading={busy === `check:${p.platform}`}
              onClick={() => void onAction("check", "Checked")}
            >
              Check
            </Button>
            <Button
              variant="ghost"
              className="min-h-9 px-3 text-xs"
              loading={busy === `publish-next:${p.platform}`}
              onClick={async () => {
                if (!window.confirm(`Post the next waiting item to ${name} now? It can take a minute.`))
                  return;
                const r = (await onAction("publish-next")) as { published?: number } | null;
                if (r)
                  toast(
                    r.published
                      ? `Posted to ${name}`
                      : "Nothing posted (nothing new, daily limit, paused or off)",
                  );
              }}
            >
              Post next now
            </Button>
            {p.connect === "OAUTH" && (
              <Button
                variant="ghost"
                className="min-h-9 px-3 text-xs text-bad"
                loading={busy === `disconnect:${p.platform}`}
                onClick={() => {
                  if (window.confirm(`Disconnect ${name}? Posting there stops until it is connected again.`))
                    void onAction("disconnect", `${name} disconnected`);
                }}
              >
                Disconnect
              </Button>
            )}
          </>
        )}
      </div>

      {p.recent.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer py-1 text-muted">Recent ({p.recent.length})</summary>
          <ul className="mt-1 space-y-1">
            {p.recent.map((r) => (
              <li key={`${r.itemId}`} className="flex flex-wrap items-center gap-x-2">
                <Badge tone={r.status === "PUBLISHED" ? "good" : r.status === "FAILED" ? "bad" : "neutral"}>
                  {r.status.toLowerCase()}
                </Badge>
                <span>{KIND[r.kind]}</span>
                <span className="num text-muted">{time(r.at)}</span>
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener"
                    className="text-gold underline underline-offset-2"
                  >
                    Open
                  </a>
                )}
                {r.error && <span className="w-full text-bad">{r.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
