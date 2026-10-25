import { horseMeta, type HorseLike, injectMeta, raceMeta, type RaceLike, UUID } from "./og";

/**
 * Cloudflare Worker in front of the static Mini App. It only runs for the public share pages
 * (`run_worker_first` in wrangler.jsonc) and only adds link-preview tags to them; anything else,
 * and any failure, serves the static page unchanged.
 */
interface Env {
  ASSETS: { fetch(request: Request | string): Promise<Response> };
}

let apiUrl: string | null = null;

/** The API's address, written next to the site at build time (scripts/share-config.mjs). */
async function api(env: Env, origin: string): Promise<string | null> {
  if (apiUrl) return apiUrl;
  const res = await env.ASSETS.fetch(`${origin}/share-config.json`);
  if (!res.ok) return null;
  const cfg = (await res.json()) as { apiUrl?: string };
  apiUrl = cfg.apiUrl ? cfg.apiUrl.replace(/\/$/, "") : null;
  return apiUrl;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const asset = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const kind = url.pathname.startsWith("/replay/")
      ? "race"
      : url.pathname.startsWith("/horse-card/")
        ? "horse"
        : null;
    const id = url.searchParams.get("id") ?? "";
    const html = (asset.headers.get("content-type") ?? "").includes("text/html");
    if (!kind || request.method !== "GET" || !asset.ok || !html || !UUID.test(id)) return asset;
    let page: string | null = null;
    try {
      const base = await api(env, url.origin);
      if (!base) return asset;
      const res = await fetch(`${base}/public/${kind === "race" ? "races" : "horses"}/${id}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return asset;
      const data = await res.json();
      page = await asset.text();
      const meta =
        kind === "race"
          ? raceMeta(data as RaceLike, id, base, url.toString())
          : horseMeta(data as HorseLike, id, base, url.toString());
      const headers = new Headers(asset.headers);
      headers.delete("content-length");
      headers.set("content-type", "text/html; charset=utf-8");
      headers.set("cache-control", "public, max-age=300");
      return new Response(injectMeta(page, meta), { status: 200, headers });
    } catch {
      // Never break the page for a preview: serve it as it is.
      return page === null ? asset : new Response(page, { status: 200, headers: asset.headers });
    }
  },
};
