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

/** The Mini App link behind a share page's "Play free" button (credits the sharer). */
export function playLink(kind: "race" | "horse", id: string, ref: string | null): string {
  const code = ref && /^[A-Za-z0-9]{1,16}$/.test(ref) ? ref : null;
  return appLink(`${kind}_${id}${code ? `_r${code}` : ""}`) ?? appLink(code ? `ref_${code}` : "start") ?? "/";
}

/** Count one view of a share page (best effort, never blocks the page). */
export function countVisit(kind: "race" | "horse", id: string, ref: string | null): void {
  const code = ref && /^[A-Za-z0-9]{1,16}$/.test(ref) ? ref : undefined;
  void post("/public/share-visits", { kind, id, ref: code }).catch(() => undefined);
}
