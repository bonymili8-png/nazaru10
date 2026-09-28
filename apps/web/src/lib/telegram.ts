/** Minimal typed wrapper over the Telegram Mini App SDK (telegram-web-app.js). */
export type HomeScreenStatus = "unsupported" | "unknown" | "added" | "missed";

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    start_param?: string;
    user?: { id: number; first_name?: string; language_code?: string };
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  openInvoice?(url: string, cb?: (status: "paid" | "cancelled" | "failed" | "pending") => void): void;
  openTelegramLink?(url: string): void;
  isVersionAtLeast?(version: string): boolean;
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(cb: (status: HomeScreenStatus) => void): void;
  onEvent?(event: string, cb: () => void): void;
  offEvent?(event: string, cb: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg = (): TelegramWebApp | null =>
  typeof window !== "undefined" && window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : null;

export function initTelegram(): void {
  const app = tg();
  if (!app) return;
  app.ready();
  app.expand();
  app.setHeaderColor?.("#0c0a09");
  app.setBackgroundColor?.("#0c0a09");
}

export const haptic = {
  tap: () => tg()?.HapticFeedback?.impactOccurred("light"),
  success: () => tg()?.HapticFeedback?.notificationOccurred("success"),
  error: () => tg()?.HapticFeedback?.notificationOccurred("error"),
};

/** Deep link that opens the Mini App with a start parameter (for share cards / referrals). */
export function appLink(startParam: string): string | null {
  const bot = process.env.NEXT_PUBLIC_BOT_USERNAME;
  const app = process.env.NEXT_PUBLIC_APP_SHORT_NAME;
  if (!bot) return null;
  return `https://t.me/${bot}${app ? `/${app}` : ""}?startapp=${encodeURIComponent(startParam)}`;
}

export function shareToTelegram(text: string, url: string): void {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const app = tg();
  if (app?.openTelegramLink) app.openTelegramLink(share);
  else window.open(share, "_blank", "noopener");
}

/** A Mini App link to a race or horse that also credits the sharer as the inviter. */
export function sharedLink(kind: "race" | "horse", id: string, referralCode?: string | null): string {
  return appLink(`${kind}_${id}${referralCode ? `_r${referralCode}` : ""}`) ?? window.location.href;
}

/** Open a t.me link inside Telegram (falls back to a new tab outside it). */
export function openTelegramLink(url: string): void {
  const app = tg();
  if (app?.openTelegramLink) app.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

/** Whether this Telegram client can pin the Mini App to the device home screen (Bot API 8.0+). */
export function canAddToHomeScreen(): boolean {
  const app = tg();
  return !!app?.addToHomeScreen && !!app.checkHomeScreenStatus && (app.isVersionAtLeast?.("8.0") ?? false);
}

/** Resolves the shortcut status; "unsupported" outside Telegram or on old clients. */
export function homeScreenStatus(): Promise<HomeScreenStatus> {
  const app = tg();
  if (!app || !canAddToHomeScreen()) return Promise.resolve("unsupported");
  return new Promise((resolve) => {
    try {
      app.checkHomeScreenStatus!((status) => resolve(status));
    } catch {
      resolve("unsupported");
    }
  });
}

/** Ask Telegram to show its native "Add to Home Screen" dialog; `onAdded` fires once the shortcut exists. */
export function addToHomeScreen(onAdded?: () => void): void {
  const app = tg();
  if (!app?.addToHomeScreen) return;
  if (onAdded && app.onEvent && app.offEvent) {
    const handler = () => {
      app.offEvent!("homeScreenAdded", handler);
      onAdded();
    };
    app.onEvent("homeScreenAdded", handler);
  }
  app.addToHomeScreen();
}
