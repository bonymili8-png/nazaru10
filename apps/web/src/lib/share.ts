import { post } from "./api";
import { appLink } from "./telegram";

/**
 * Public share pages: a finished race's replay and a horse's card. They open in any browser
 * without signing in, and chat apps show a preview card for them (drawn by the API).
 */
export function shareUrl(kind: "race" | "horse", id: string, referralCode?: string | null): string {
  const page = kind === "race" ? "replay" : "horse-card";
  const ref = referralCode ? `&r=${encodeURIComponent(referralCode)}` : "";
  return `${window.location.origin}/${page}/?id=${id}${ref}`;
}

const CAMPAIGN = /^[A-Za-z0-9]{4,12}$/;

/**
 * The Mini App link behind a share page's "Play free" button: credits the player who shared it
 * (`r`), or the campaign of the game's own post that linked here (`c`).
 */
export function playLink(
  kind: "race" | "horse",
  id: string,
  ref: string | null,
  campaign?: string | null,
): string {
  if (campaign && CAMPAIGN.test(campaign)) return appLink(`${kind}_${id}_c${campaign}`) ?? "/";
  const code = ref && /^[A-Za-z0-9]{1,16}$/.test(ref) ? ref : null;
  return appLink(`${kind}_${id}${code ? `_r${code}` : ""}`) ?? appLink(code ? `ref_${code}` : "start") ?? "/";
}

/** A visit from one of the game's own posts counts as a click on its campaign link. */
export function countCampaignClick(campaign: string | null): void {
  if (!campaign || !CAMPAIGN.test(campaign)) return;
  void post(`/public/campaigns/${campaign}/click`).catch(() => undefined);
}

/** Count one view of a share page (best effort, never blocks the page). */
export function countVisit(kind: "race" | "horse", id: string, ref: string | null): void {
  const code = ref && /^[A-Za-z0-9]{1,16}$/.test(ref) ? ref : undefined;
  void post("/public/share-visits", { kind, id, ref: code }).catch(() => undefined);
}
