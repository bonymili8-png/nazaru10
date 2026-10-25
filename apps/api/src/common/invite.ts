/**
 * The referral code carried by a Mini App start parameter: a plain invite (`ref_CODE`) or a shared
 * race / horse link that also credits the sharer (`race_<uuid>_rCODE`, `horse_<uuid>_rCODE`).
 * Telegram limits start parameters to 64 characters of [A-Za-z0-9_-].
 */
export function inviteCodeOf(param: string | null | undefined): string | null {
  if (!param) return null;
  const m =
    /^ref_([A-Za-z0-9]{1,16})$/.exec(param) ??
    /^(?:race|horse)_[0-9a-f-]{36}_r([A-Za-z0-9]{1,16})$/i.exec(param);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * The campaign code carried by a tracked link's start parameter: `c_CODE`, or a race / horse link
 * from one of the game's own posts (`race_<uuid>_cCODE`, opening that race).
 */
export function campaignCodeOf(param: string | null | undefined): string | null {
  if (!param) return null;
  const m =
    /^c_([A-Za-z0-9]{4,12})$/.exec(param) ??
    /^(?:race|horse)_[0-9a-f-]{36}_c([A-Za-z0-9]{4,12})$/i.exec(param);
  return m ? m[1]!.toUpperCase() : null;
}
