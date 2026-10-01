// Minimal typed wrapper around the Telegram WebApp API (https://core.telegram.org/bots/webapps).

interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TelegramHaptics {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
}

export interface TelegramWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  version: string;
  platform: string;
  ready(): void;
  expand(): void;
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHaptics;
  setHeaderColor?(color: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function telegram(): TelegramWebApp | null {
  const app = window.Telegram?.WebApp;
  return app && typeof app.ready === "function" ? app : null;
}

/** initData is empty when the page is opened outside Telegram. */
export function telegramInitData(): string {
  return telegram()?.initData ?? "";
}

export function initTelegram(): void {
  const app = telegram();
  if (!app) return;
  app.ready();
  app.expand();
  document.documentElement.dataset.theme = app.colorScheme;
}

export function haptic(kind: "success" | "error" | "warning" | "tap"): void {
  const haptics = telegram()?.HapticFeedback;
  if (!haptics) return;
  try {
    if (kind === "tap") haptics.impactOccurred("light");
    else haptics.notificationOccurred(kind);
  } catch {
    // older clients
  }
}
