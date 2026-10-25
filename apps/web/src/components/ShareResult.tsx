"use client";
import type { RaceDetailDto, RaceEntryDto, UserDto } from "@thoroughline/contracts";
import { Share2, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { t } from "@/lib/i18n";
import { shareUrl } from "@/lib/share";
import { haptic, shareToTelegram } from "@/lib/telegram";

/** Share prompts: at most this many a week, once per race, and only for a win or a place. */
const PER_WEEK = 3;
const KEY = "tl.sharePrompts";

const weekOf = (d: Date) => {
  const day = Math.floor(d.getTime() / 86_400_000);
  return String(Math.floor((day + 3) / 7)); // weeks since the epoch, Monday-based
};

interface Seen {
  week: string;
  races: string[];
  dismissed: string[];
}

function load(): Seen {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Seen | null;
    if (s && s.week === weekOf(new Date())) return s;
  } catch {
    /* storage unavailable: prompts just show */
  }
  return { week: weekOf(new Date()), races: [], dismissed: [] };
}

function save(s: Seen): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* nothing to keep */
  }
}

/**
 * After the viewer's horse runs: a share button, and after a win or a place a gold prompt to
 * share the replay (it opens for anyone, with a preview card, and credits the sharer).
 */
export function ShareResult({ race, mine, me }: { race: RaceDetailDto; mine: RaceEntryDto[]; me?: UserDto }) {
  const best = mine.reduce((a, b) => ((a.position ?? 99) <= (b.position ?? 99) ? a : b));
  const placed = (best.position ?? 99) <= 3;
  const [prompt, setPrompt] = useState(false);
  useEffect(() => {
    if (!placed || me?.settings.sharePrompts === false) return;
    const s = load();
    if (s.dismissed.includes(race.id)) return;
    if (s.races.includes(race.id)) return setPrompt(true);
    if (s.races.length >= PER_WEEK) return;
    save({ ...s, races: [...s.races, race.id] });
    setPrompt(true);
  }, [placed, race.id, me?.settings.sharePrompts]);

  const share = () => {
    haptic.success();
    shareToTelegram(
      t(best.position === 1 ? "race.shareFirst" : "race.sharePlace", {
        horse: best.horseName,
        n: best.position ?? "",
        race: race.name,
      }),
      shareUrl("race", race.id, me?.referralCode),
    );
  };
  const dismiss = () => {
    const s = load();
    save({ ...s, dismissed: [...s.dismissed, race.id] });
    setPrompt(false);
  };

  if (prompt)
    return (
      <Card className="mt-4 border-gold/60 bg-gold/10">
        <p className="flex items-center gap-2 font-display text-lg font-bold">
          <Trophy className="size-5 text-gold" aria-hidden />
          {best.position === 1
            ? t("share.wonTitle", { horse: best.horseName })
            : t("share.placedTitle", { horse: best.horseName, n: best.position ?? "" })}
        </p>
        <p className="mt-1 text-sm text-muted">{t("share.promptBody")}</p>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <Button onClick={share}>
            <Share2 className="size-4" aria-hidden />
            {t("share.replay")}
          </Button>
          <Button variant="ghost" onClick={dismiss}>
            {t("share.notNow")}
          </Button>
        </div>
      </Card>
    );
  return (
    <Button variant="secondary" className="mt-4 w-full" onClick={share}>
      <Share2 className="size-4" aria-hidden />
      {t("race.share")}
    </Button>
  );
}
