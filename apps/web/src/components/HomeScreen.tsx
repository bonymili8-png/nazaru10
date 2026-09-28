"use client";
import { Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, useToast } from "@/components/ui";
import { t } from "@/lib/i18n";
import { addToHomeScreen, haptic, homeScreenStatus, type HomeScreenStatus } from "@/lib/telegram";

const DISMISS_KEY = "tl.homeScreenDismissed";

function useHomeScreenStatus(): [HomeScreenStatus | null, (s: HomeScreenStatus) => void] {
  const [status, setStatus] = useState<HomeScreenStatus | null>(null);
  useEffect(() => {
    let live = true;
    void homeScreenStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return [status, setStatus];
}

function useAdd(setStatus: (s: HomeScreenStatus) => void) {
  const toast = useToast();
  return () =>
    addToHomeScreen(() => {
      setStatus("added");
      haptic.success();
      toast(t("homeScreen.added"));
    });
}

/** Profile setting: pin the game to the phone's home screen, or confirm it already is. */
export function HomeScreenSetting() {
  const [status, setStatus] = useHomeScreenStatus();
  const add = useAdd(setStatus);
  if (!status || status === "unsupported") return null;
  return (
    <Card className="mt-2 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t("homeScreen.title")}</p>
        <p className="text-xs text-muted">
          {status === "added" ? t("homeScreen.already") : t("homeScreen.hint")}
        </p>
      </div>
      {status !== "added" && (
        <Button variant="secondary" className="shrink-0" onClick={add}>
          <Smartphone className="size-4" aria-hidden />
          {t("homeScreen.add")}
        </Button>
      )}
    </Card>
  );
}

/** One-time, dismissible nudge on the home page for players who haven't pinned the game yet. */
export function HomeScreenBanner() {
  const [status, setStatus] = useHomeScreenStatus();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);
  const add = useAdd(setStatus);
  if (dismissed || status !== "missed") return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode: hidden for this session only */
    }
  };
  return (
    <Card className="mb-3 flex items-center gap-3">
      <Smartphone className="size-6 shrink-0 text-gold" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t("homeScreen.bannerTitle")}</p>
        <p className="text-xs text-muted">{t("homeScreen.hint")}</p>
      </div>
      <Button className="shrink-0" onClick={add}>
        {t("homeScreen.add")}
      </Button>
      <button
        onClick={dismiss}
        aria-label={t("homeScreen.dismiss")}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </Card>
  );
}
