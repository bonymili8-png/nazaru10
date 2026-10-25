import type { SocialPlatform } from "@thoroughline/contracts";

/**
 * The official APIs of the networks the game posts to: YouTube Data API (Shorts), Meta Graph API
 * (a Facebook Page and the Instagram professional account linked to it), Threads API and Bluesky
 * (AT Protocol, an app password). Implemented over HTTPS, faked in tests. Credentials are the
 * owner's own accounts, connected once from the admin console (OAuth) or set on the server
 * (Bluesky); nothing here reads or writes anyone else's content.
 */

/** Who the owner signs in with: Google (YouTube), Meta (Facebook + Instagram), Threads. */
export type OAuthProvider = "GOOGLE" | "META" | "THREADS";

export interface AppCredentials {
  clientId: string;
  clientSecret: string;
}

/** What is kept (encrypted) for a connected account. */
export interface SocialSecret {
  /** Google: the refresh token. Meta: the Page token (does not expire). Threads: long-lived token. */
  token: string;
}

export interface SocialAccount {
  platform: SocialPlatform;
  /** Channel id, Page id, Instagram user id, Threads user id or Bluesky DID. */
  accountId: string;
  /** Channel title, Page name or @username, for the console. */
  name: string;
  secret: SocialSecret;
  /** When the token stops working unless refreshed (Threads); null when it does not expire. */
  expiresAt: Date | null;
}

export interface SocialPost {
  /** The caption, already written for the platform (plain text). */
  text: string;
  /** YouTube's title. */
  title: string;
  tags: string[];
  /** Where "play" points (Bluesky makes it a link in the text). */
  link: { text: string; url: string };
  /** The race video, with a public URL Meta and Threads fetch it from. */
  video: { url: string; bytes: Buffer } | null;
  /** The card (JPEG), with its public URL. */
  image: { url: string; bytes: Buffer; width: number; height: number; alt: string };
}

export interface Published {
  id: string;
  url: string | null;
}

export interface SocialApi {
  authorizeUrl(provider: OAuthProvider, app: AppCredentials, redirectUri: string, state: string): string;
  /** Finish the sign-in: the accounts it gives (Meta: the Page and its Instagram account). */
  connect(
    provider: OAuthProvider,
    app: AppCredentials,
    code: string,
    redirectUri: string,
    pageId?: string,
  ): Promise<SocialAccount[]>;
  /** A fresh long-lived token (Threads); null for platforms whose tokens do not expire. */
  refresh(
    account: SocialAccount,
    app: AppCredentials,
  ): Promise<{ secret: SocialSecret; expiresAt: Date } | null>;
  /** Whether the account still works (its name as the platform has it now). */
  check(account: SocialAccount, app: AppCredentials): Promise<{ name: string }>;
  publish(account: SocialAccount, post: SocialPost, app: AppCredentials): Promise<Published>;
  /** Bluesky signs in with a handle and an app password (kept on the server, not in the database). */
  blueskyAccount(handle: string, password: string, service: string): Promise<SocialAccount>;
}

export const SOCIAL_API = Symbol("SOCIAL_API");

const GRAPH = "https://graph.facebook.com/v21.0";
const THREADS = "https://graph.threads.net/v1.0";
const DAY = 86_400_000;

class ApiError extends Error {}

/** The error a platform returned, readable in the console. */
async function body<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const j = json as {
      error?: { message?: string } | string;
      error_description?: string;
      message?: string;
    } | null;
    const msg =
      (typeof j?.error === "object" ? j.error.message : undefined) ??
      j?.error_description ??
      j?.message ??
      (typeof j?.error === "string" ? j.error : undefined) ??
      text.slice(0, 200);
    throw new ApiError(`${what}: ${msg || res.status}`);
  }
  return json as T;
}

const form = (o: Record<string, string>) => new URLSearchParams(o);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = 30_000;

export class HttpSocialApi implements SocialApi {
  constructor(private readonly opts: { pollMs?: number; maxPolls?: number } = {}) {}

  authorizeUrl(provider: OAuthProvider, app: AppCredentials, redirectUri: string, state: string): string {
    switch (provider) {
      case "GOOGLE":
        return `https://accounts.google.com/o/oauth2/v2/auth?${form({
          client_id: app.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope:
            "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
          access_type: "offline",
          prompt: "consent",
          state,
        })}`;
      case "META":
        return `https://www.facebook.com/v21.0/dialog/oauth?${form({
          client_id: app.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope:
            "pages_show_list,pages_read_engagement,pages_manage_posts,business_management,instagram_basic,instagram_content_publish",
          state,
        })}`;
      case "THREADS":
        return `https://threads.net/oauth/authorize?${form({
          client_id: app.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "threads_basic,threads_content_publish",
          state,
        })}`;
    }
  }

  async connect(
    provider: OAuthProvider,
    app: AppCredentials,
    code: string,
    redirectUri: string,
    pageId?: string,
  ): Promise<SocialAccount[]> {
    switch (provider) {
      case "GOOGLE": {
        const tok = await body<{ access_token: string; refresh_token?: string }>(
          await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            body: form({
              code,
              client_id: app.clientId,
              client_secret: app.clientSecret,
              redirect_uri: redirectUri,
              grant_type: "authorization_code",
            }),
            signal: AbortSignal.timeout(TIMEOUT),
          }),
          "Google sign-in",
        );
        if (!tok.refresh_token)
          throw new ApiError(
            "Google gave no refresh token: remove the app's access in your Google account and connect again",
          );
        const ch = await this.youtubeChannel(tok.access_token);
        return [
          {
            platform: "YOUTUBE",
            accountId: ch.id,
            name: ch.title,
            secret: { token: tok.refresh_token },
            expiresAt: null,
          },
        ];
      }
      case "META": {
        const short = await body<{ access_token: string }>(
          await fetch(
            `${GRAPH}/oauth/access_token?${form({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code })}`,
            { signal: AbortSignal.timeout(TIMEOUT) },
          ),
          "Facebook sign-in",
        );
        // A long-lived user token makes Page tokens that do not expire.
        const long = await body<{ access_token: string }>(
          await fetch(
            `${GRAPH}/oauth/access_token?${form({
              grant_type: "fb_exchange_token",
              client_id: app.clientId,
              client_secret: app.clientSecret,
              fb_exchange_token: short.access_token,
            })}`,
            { signal: AbortSignal.timeout(TIMEOUT) },
          ),
          "Facebook token",
        );
        const pages = await body<{
          data: {
            id: string;
            name: string;
            access_token: string;
            instagram_business_account?: { id: string; username?: string };
          }[];
        }>(
          await fetch(
            `${GRAPH}/me/accounts?${form({
              fields: "id,name,access_token,instagram_business_account{id,username}",
              access_token: long.access_token,
            })}`,
            { signal: AbortSignal.timeout(TIMEOUT) },
          ),
          "Facebook Pages",
        );
        const page =
          (pageId ? pages.data.find((p) => p.id === pageId) : undefined) ??
          pages.data.find((p) => p.instagram_business_account) ??
          pages.data[0];
        if (!page)
          throw new ApiError(
            pageId
              ? `The Page ${pageId} was not among the Pages you allowed`
              : "No Facebook Page was allowed: create a Page for the game and allow it when connecting",
          );
        const out: SocialAccount[] = [
          {
            platform: "FACEBOOK",
            accountId: page.id,
            name: page.name,
            secret: { token: page.access_token },
            expiresAt: null,
          },
        ];
        const ig = page.instagram_business_account;
        if (ig)
          out.push({
            platform: "INSTAGRAM",
            accountId: ig.id,
            name: ig.username ? `@${ig.username}` : page.name,
            secret: { token: page.access_token },
            expiresAt: null,
          });
        return out;
      }
      case "THREADS": {
        const short = await body<{ access_token: string; user_id: string | number }>(
          await fetch("https://graph.threads.net/oauth/access_token", {
            method: "POST",
            body: form({
              client_id: app.clientId,
              client_secret: app.clientSecret,
              grant_type: "authorization_code",
              redirect_uri: redirectUri,
              code,
            }),
            signal: AbortSignal.timeout(TIMEOUT),
          }),
          "Threads sign-in",
        );
        const long = await body<{ access_token: string; expires_in: number }>(
          await fetch(
            `https://graph.threads.net/access_token?${form({
              grant_type: "th_exchange_token",
              client_secret: app.clientSecret,
              access_token: short.access_token,
            })}`,
            { signal: AbortSignal.timeout(TIMEOUT) },
          ),
          "Threads token",
        );
        const me = await this.threadsMe(long.access_token);
        return [
          {
            platform: "THREADS",
            accountId: me.id,
            name: `@${me.username}`,
            secret: { token: long.access_token },
            expiresAt: new Date(Date.now() + long.expires_in * 1000),
          },
        ];
      }
    }
  }

  async refresh(account: SocialAccount): Promise<{ secret: SocialSecret; expiresAt: Date } | null> {
    if (account.platform !== "THREADS") return null;
    const r = await body<{ access_token: string; expires_in: number }>(
      await fetch(
        `https://graph.threads.net/refresh_access_token?${form({ grant_type: "th_refresh_token", access_token: account.secret.token })}`,
        { signal: AbortSignal.timeout(TIMEOUT) },
      ),
      "Threads token refresh",
    );
    return {
      secret: { token: r.access_token },
      expiresAt: new Date(Date.now() + (r.expires_in || 60 * 86400) * 1000),
    };
  }

  async check(account: SocialAccount, app: AppCredentials): Promise<{ name: string }> {
    switch (account.platform) {
      case "YOUTUBE":
        return { name: (await this.youtubeChannel(await this.googleAccess(account, app))).title };
      case "FACEBOOK": {
        const p = await this.graph<{ name: string }>(
          `${account.accountId}?fields=name`,
          account,
          "Facebook Page",
        );
        return { name: p.name };
      }
      case "INSTAGRAM": {
        const p = await this.graph<{ username: string }>(
          `${account.accountId}?fields=username`,
          account,
          "Instagram",
        );
        return { name: `@${p.username}` };
      }
      case "THREADS":
        return { name: `@${(await this.threadsMe(account.secret.token)).username}` };
      case "BLUESKY":
        return { name: account.name };
    }
  }

  async publish(account: SocialAccount, post: SocialPost, app: AppCredentials): Promise<Published> {
    switch (account.platform) {
      case "YOUTUBE":
        return this.youtube(account, post, app);
      case "FACEBOOK":
        return this.facebook(account, post);
      case "INSTAGRAM":
        return this.instagram(account, post);
      case "THREADS":
        return this.threads(account, post);
      case "BLUESKY":
        return this.bluesky(account, post);
    }
  }

  /* ─────────────── YouTube ─────────────── */

  private async googleAccess(account: SocialAccount, app: AppCredentials): Promise<string> {
    const r = await body<{ access_token: string }>(
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: form({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          refresh_token: account.secret.token,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      }),
      "Google token",
    );
    return r.access_token;
  }

  private async youtubeChannel(access: string): Promise<{ id: string; title: string }> {
    const r = await body<{ items?: { id: string; snippet: { title: string } }[] }>(
      await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(TIMEOUT),
      }),
      "YouTube channel",
    );
    const ch = r.items?.[0];
    if (!ch) throw new ApiError("This Google account has no YouTube channel: create one first");
    return { id: ch.id, title: ch.snippet.title };
  }

  private async youtube(account: SocialAccount, post: SocialPost, app: AppCredentials): Promise<Published> {
    if (!post.video) throw new ApiError("YouTube takes videos only");
    const access = await this.googleAccess(account, app);
    const start = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": "video/mp4",
          "x-upload-content-length": String(post.video.bytes.length),
        },
        body: JSON.stringify({
          snippet: {
            title: post.title.slice(0, 100),
            description: post.text.slice(0, 5000),
            tags: post.tags,
            categoryId: "20",
            defaultLanguage: "en",
          },
          status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
    if (!start.ok) await body(start, "YouTube upload");
    const location = start.headers.get("location");
    if (!location) throw new ApiError("YouTube upload: no upload address");
    const done = await body<{ id: string }>(
      await fetch(location, {
        method: "PUT",
        headers: { "content-type": "video/mp4" },
        body: post.video.bytes,
        signal: AbortSignal.timeout(5 * 60_000),
      }),
      "YouTube upload",
    );
    return { id: done.id, url: `https://youtube.com/shorts/${done.id}` };
  }

  /* ─────────────── Facebook + Instagram ─────────────── */

  private async graph<T>(
    path: string,
    account: SocialAccount,
    what: string,
    post?: Record<string, string>,
  ): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    return body<T>(
      await fetch(
        post
          ? `${GRAPH}/${path}`
          : `${GRAPH}/${path}${sep}access_token=${encodeURIComponent(account.secret.token)}`,
        post
          ? {
              method: "POST",
              body: form({ ...post, access_token: account.secret.token }),
              signal: AbortSignal.timeout(TIMEOUT),
            }
          : { signal: AbortSignal.timeout(TIMEOUT) },
      ),
      what,
    );
  }

  private async facebook(account: SocialAccount, post: SocialPost): Promise<Published> {
    if (post.video) {
      const r = await body<{ id: string }>(
        await fetch(`https://graph-video.facebook.com/v21.0/${account.accountId}/videos`, {
          method: "POST",
          body: form({
            file_url: post.video.url,
            description: post.text,
            title: post.title.slice(0, 100),
            access_token: account.secret.token,
          }),
          signal: AbortSignal.timeout(2 * 60_000),
        }),
        "Facebook video",
      );
      return { id: r.id, url: `https://www.facebook.com/${account.accountId}/videos/${r.id}` };
    }
    const r = await this.graph<{ id: string; post_id?: string }>(
      `${account.accountId}/photos`,
      account,
      "Facebook photo",
      {
        url: post.image.url,
        message: post.text,
      },
    );
    return { id: r.post_id ?? r.id, url: `https://www.facebook.com/${r.post_id ?? r.id}` };
  }

  /** Wait until a media container has been fetched and processed. */
  private async ready(check: () => Promise<string>, what: string): Promise<void> {
    const every = this.opts.pollMs ?? 5000;
    for (let i = 0; i < (this.opts.maxPolls ?? 60); i++) {
      const s = await check();
      if (s === "FINISHED") return;
      if (s === "ERROR" || s === "EXPIRED")
        throw new ApiError(`${what}: the platform could not process the media`);
      await sleep(every);
    }
    throw new ApiError(`${what}: still processing, try again later`);
  }

  private async instagram(account: SocialAccount, post: SocialPost): Promise<Published> {
    const media: Record<string, string> = post.video
      ? { media_type: "REELS", video_url: post.video.url, share_to_feed: "true" }
      : { image_url: post.image.url };
    const c = await this.graph<{ id: string }>(`${account.accountId}/media`, account, "Instagram", {
      ...media,
      caption: post.text,
    });
    await this.ready(
      async () =>
        (await this.graph<{ status_code: string }>(`${c.id}?fields=status_code`, account, "Instagram"))
          .status_code,
      "Instagram",
    );
    const p = await this.graph<{ id: string }>(`${account.accountId}/media_publish`, account, "Instagram", {
      creation_id: c.id,
    });
    const link = await this.graph<{ permalink?: string }>(
      `${p.id}?fields=permalink`,
      account,
      "Instagram",
    ).catch(() => ({ permalink: undefined }));
    return { id: p.id, url: link.permalink ?? null };
  }

  /* ─────────────── Threads ─────────────── */

  private async threadsMe(token: string): Promise<{ id: string; username: string }> {
    return body(
      await fetch(`${THREADS}/me?fields=id,username&access_token=${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(TIMEOUT),
      }),
      "Threads account",
    );
  }

  private async threadsCall<T>(path: string, token: string, post?: Record<string, string>): Promise<T> {
    return body<T>(
      await fetch(
        post ? `${THREADS}/${path}` : `${THREADS}/${path}&access_token=${encodeURIComponent(token)}`,
        post
          ? {
              method: "POST",
              body: form({ ...post, access_token: token }),
              signal: AbortSignal.timeout(TIMEOUT),
            }
          : { signal: AbortSignal.timeout(TIMEOUT) },
      ),
      "Threads",
    );
  }

  private async threads(account: SocialAccount, post: SocialPost): Promise<Published> {
    const token = account.secret.token;
    const media: Record<string, string> = post.video
      ? { media_type: "VIDEO", video_url: post.video.url }
      : { media_type: "IMAGE", image_url: post.image.url };
    const c = await this.threadsCall<{ id: string }>(`${account.accountId}/threads`, token, {
      ...media,
      text: post.text.slice(0, 500),
    });
    await this.ready(
      async () => (await this.threadsCall<{ status: string }>(`${c.id}?fields=status`, token)).status,
      "Threads",
    );
    const p = await this.threadsCall<{ id: string }>(`${account.accountId}/threads_publish`, token, {
      creation_id: c.id,
    });
    const link = await this.threadsCall<{ permalink?: string }>(`${p.id}?fields=permalink`, token).catch(
      () => ({
        permalink: undefined,
      }),
    );
    return { id: p.id, url: link.permalink ?? null };
  }

  /* ─────────────── Bluesky ─────────────── */

  async blueskyAccount(handle: string, password: string, service: string): Promise<SocialAccount> {
    const s = await this.blueskySession(handle, password, service);
    return {
      platform: "BLUESKY",
      accountId: s.did,
      name: `@${s.handle}`,
      secret: { token: JSON.stringify({ handle, password, service }) },
      expiresAt: null,
    };
  }

  private async blueskySession(handle: string, password: string, service: string) {
    return body<{ accessJwt: string; did: string; handle: string }>(
      await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: handle, password }),
        signal: AbortSignal.timeout(TIMEOUT),
      }),
      "Bluesky sign-in",
    );
  }

  private async bluesky(account: SocialAccount, post: SocialPost): Promise<Published> {
    const { handle, password, service } = JSON.parse(account.secret.token) as {
      handle: string;
      password: string;
      service: string;
    };
    const s = await this.blueskySession(handle, password, service);
    const auth = { authorization: `Bearer ${s.accessJwt}` };
    const blob = await body<{ blob: unknown }>(
      await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
        method: "POST",
        headers: { ...auth, "content-type": "image/jpeg" },
        body: post.image.bytes,
        signal: AbortSignal.timeout(TIMEOUT),
      }),
      "Bluesky image",
    );
    const { text, facets } = blueskyText(post.text, post.link);
    const r = await body<{ uri: string }>(
      await fetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          repo: s.did,
          collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text,
            facets,
            langs: ["en"],
            createdAt: new Date().toISOString(),
            embed: {
              $type: "app.bsky.embed.images",
              images: [
                {
                  alt: post.image.alt,
                  image: blob.blob,
                  aspectRatio: { width: post.image.width, height: post.image.height },
                },
              ],
            },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      }),
      "Bluesky post",
    );
    const rkey = r.uri.split("/").pop()!;
    return { id: r.uri, url: `https://bsky.app/profile/${s.handle}/post/${rkey}` };
  }
}

/**
 * Bluesky text with the play link and hashtags made clickable (facets count UTF-8 bytes). The
 * link is appended as `link.text`, which must not already be in the caption.
 */
export function blueskyText(caption: string, link: { text: string; url: string }) {
  const text = `${caption}\n${link.text}`;
  const enc = new TextEncoder();
  const at = (i: number) => enc.encode(text.slice(0, i)).length;
  const facets: unknown[] = [];
  const li = text.lastIndexOf(link.text);
  facets.push({
    index: { byteStart: at(li), byteEnd: at(li + link.text.length) },
    features: [{ $type: "app.bsky.richtext.facet#link", uri: link.url }],
  });
  for (const m of text.matchAll(/(^|\s)#([A-Za-z][A-Za-z0-9]{1,40})/g)) {
    const start = m.index! + m[1]!.length;
    facets.push({
      index: { byteStart: at(start), byteEnd: at(start + 1 + m[2]!.length) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }],
    });
  }
  return { text, facets };
}

/** In-memory stand-in for tests: records what would be posted. */
export class FakeSocialApi implements SocialApi {
  calls: { method: string; args: unknown[] }[] = [];
  /** Make the next publishes fail with this message. */
  publishError: string | null = null;
  private n = 0;

  authorizeUrl(provider: OAuthProvider, app: AppCredentials, redirectUri: string, state: string): string {
    return `https://auth.example/${provider.toLowerCase()}?${form({ client_id: app.clientId, redirect_uri: redirectUri, state })}`;
  }

  async connect(
    provider: OAuthProvider,
    app: AppCredentials,
    code: string,
    redirectUri: string,
    pageId?: string,
  ) {
    this.calls.push({ method: "connect", args: [provider, code, redirectUri, pageId] });
    if (code === "bad") throw new ApiError(`${provider} sign-in: invalid code`);
    switch (provider) {
      case "GOOGLE":
        return [
          {
            platform: "YOUTUBE" as const,
            accountId: "UC123",
            name: "Thoroughline",
            secret: { token: `rt-${code}` },
            expiresAt: null,
          },
        ];
      case "META":
        return [
          {
            platform: "FACEBOOK" as const,
            accountId: pageId ?? "page1",
            name: "Thoroughline Racing",
            secret: { token: `pt-${code}` },
            expiresAt: null,
          },
          {
            platform: "INSTAGRAM" as const,
            accountId: "ig1",
            name: "@thoroughline",
            secret: { token: `pt-${code}` },
            expiresAt: null,
          },
        ];
      case "THREADS":
        return [
          {
            platform: "THREADS" as const,
            accountId: "th1",
            name: "@thoroughline",
            secret: { token: `th-${code}` },
            expiresAt: new Date(Date.now() + 60 * DAY),
          },
        ];
    }
  }

  async refresh(account: SocialAccount) {
    this.calls.push({ method: "refresh", args: [account.platform] });
    if (account.platform !== "THREADS") return null;
    return { secret: { token: `${account.secret.token}+` }, expiresAt: new Date(Date.now() + 60 * DAY) };
  }

  async check(account: SocialAccount) {
    return { name: account.name };
  }

  async publish(account: SocialAccount, post: SocialPost): Promise<Published> {
    this.calls.push({ method: "publish", args: [account.platform, post, account.secret.token] });
    if (this.publishError) throw new ApiError(this.publishError);
    const id = `${account.platform.toLowerCase()}-${++this.n}`;
    return { id, url: `https://social.example/${id}` };
  }

  async blueskyAccount(handle: string, password: string, service: string): Promise<SocialAccount> {
    if (password === "wrong") throw new ApiError("Bluesky sign-in: Invalid identifier or password");
    return {
      platform: "BLUESKY",
      accountId: "did:plc:test",
      name: `@${handle}`,
      secret: { token: JSON.stringify({ handle, password, service }) },
      expiresAt: null,
    };
  }
}
