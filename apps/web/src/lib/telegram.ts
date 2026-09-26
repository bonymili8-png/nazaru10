/** Minimal typed wrapper over the Telegram Mini App SDK (telegram-web-app.js). */
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
