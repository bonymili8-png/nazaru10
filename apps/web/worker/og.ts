/**
 * Link previews for the public share pages. The site is a static export, so every replay page
 * is the same HTML; the Worker fetches the race or horse from the API and writes its own title,
 * description and preview image into the page before it is served. Pure functions (tested).
 */

export interface Meta {
  title: string;
  description: string;
  image: string;
  url: string;
}

/** The slice of the public race the preview needs. */
export interface RaceLike {
  name: string;
  trackName: string;
  distance: number;
  surface: string;
  entryList: { horseName: string; position: number | null }[];
}

/** The slice of the public horse the preview needs. */
export interface HorseLike {
  name: string;
  starts: number;
  wins: number;
  raceRating: number;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PITCH = "A free horse racing sim inside Telegram. No betting.";
const word = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function raceMeta(r: RaceLike, id: string, apiUrl: string, pageUrl: string): Meta {
  const winner = r.entryList.find((e) => e.position === 1)?.horseName;
  return {
    title: winner ? `${winner} wins the ${r.name} | Thoroughline` : `${r.name} | Thoroughline`,
    description: `${r.trackName} · ${r.distance}m ${word(r.surface)}. Watch the replay, then train your own racehorse. ${PITCH}`,
    image: `${apiUrl}/public/og/race/${id}`,
    url: pageUrl,
  };
}

export function horseMeta(h: HorseLike, id: string, apiUrl: string, pageUrl: string): Meta {
  return {
    title: `${h.name}: ${h.starts} starts, ${h.wins} wins | Thoroughline`,
    description: `Rating ${h.raceRating}. Can your horse beat ${h.name}? ${PITCH}`,
    image: `${apiUrl}/public/og/horse/${id}`,
    url: pageUrl,
  };
}

const attr = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/** Replace the page's title, description and any Open Graph / Twitter tags with these. */
export function injectMeta(html: string, m: Meta): string {
  const tags = [
    `<title>${attr(m.title)}</title>`,
    `<meta name="description" content="${attr(m.description)}"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:site_name" content="Thoroughline"/>`,
    `<meta property="og:title" content="${attr(m.title)}"/>`,
    `<meta property="og:description" content="${attr(m.description)}"/>`,
    `<meta property="og:image" content="${attr(m.image)}"/>`,
    `<meta property="og:image:width" content="1200"/>`,
    `<meta property="og:image:height" content="630"/>`,
    `<meta property="og:url" content="${attr(m.url)}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${attr(m.title)}"/>`,
    `<meta name="twitter:description" content="${attr(m.description)}"/>`,
    `<meta name="twitter:image" content="${attr(m.image)}"/>`,
  ].join("");
  const cleaned = html
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\s+(?:name|property)="(?:description|og:[^"]*|twitter:[^"]*)"[^>]*>/gi, "");
  return cleaned.replace(/<head([^>]*)>/i, (h) => `${h}${tags}`);
}
