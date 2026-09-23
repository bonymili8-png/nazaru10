import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: Date;
  startParam: string | null;
  queryId: string | null;
}

export class InitDataError extends Error {
  constructor(readonly reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "FUTURE" | "NO_USER") {
    super(`Telegram init data rejected: ${reason}`);
  }
}

/**
 * Validate Telegram Mini App `initData` (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256(key = "WebAppData", botToken); hash = HMAC_SHA256(key = secret, data_check_string),
 * where data_check_string is every field except `hash`, sorted by key, joined as "key=value" with "\n".
 */
export function verifyInitData(
  raw: string,
  botToken: string,
  maxAgeSec: number,
  now: Date,
): VerifiedInitData {
  if (!botToken) throw new InitDataError("BAD_SIGNATURE");
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    throw new InitDataError("MALFORMED");
  }
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw new InitDataError("MALFORMED");

  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const [k, v] of params) {
    if (k === "hash") continue;
    if (seen.has(k)) throw new InitDataError("MALFORMED");
    seen.add(k);
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs.join("\n")).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new InitDataError("BAD_SIGNATURE");

  const authDateSec = Number(params.get("auth_date"));
  if (!Number.isInteger(authDateSec) || authDateSec <= 0) throw new InitDataError("MALFORMED");
  const ageSec = now.getTime() / 1000 - authDateSec;
  if (ageSec > maxAgeSec) throw new InitDataError("EXPIRED");
  if (ageSec < -60) throw new InitDataError("FUTURE");

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(params.get("user") ?? "null") as TelegramWebAppUser;
  } catch {
    throw new InitDataError("MALFORMED");
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw new InitDataError("NO_USER");

  return {
    user,
    authDate: new Date(authDateSec * 1000),
    startParam: params.get("start_param"),
    queryId: params.get("query_id"),
  };
}

/** Build a correctly signed initData string (tests and local tooling). */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const dcs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
