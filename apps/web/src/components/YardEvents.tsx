"use client";
import type {
  YardChoice,
  YardDto,
  YardEventDto,
  YardEventKind,
  YardOutcomeDto,
} from "@thoroughline/contracts";
import { Hammer, HeartPulse, Soup, Thermometer } from "lucide-react";
import { useState } from "react";
import { Button, Card, SectionTitle, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

const ICON: Record<YardEventKind, typeof Hammer> = {
  LOST_SHOE: Hammer,
  HEAT_IN_LEG: Thermometer,
  OFF_FEED: Soup,
  CAST_IN_BOX: HeartPulse,
};

/** What a settled event did, in words: "−120 cr · fresh shoes". */
export function outcomeText(o: YardOutcomeDto): string {
  if (o.void) return t("yard.out.void");
  const parts: string[] = [];
  if (o.credits > 0) parts.push(t("yard.out.credits", { n: fmt(o.credits) }));
  if (o.freshShoes) parts.push(t("yard.out.freshShoes"));
  if (o.shoesWorn) parts.push(t("yard.out.shoesWorn"));
  if (o.fatigue > 0) parts.push(t("yard.out.fatigue", { n: o.fatigue }));
  if (o.health < 0) parts.push(t("yard.out.health", { n: -o.health }));
  if (o.bond > 0) parts.push(t("yard.out.bond", { n: o.bond }));
  if (o.injuryFactor > 1) parts.push(t("yard.out.risk"));
  return parts.length ? parts.join(" · ") : t("yard.out.fine");
}

/**
 * Yard events: open ones as a choice (no advice: the owner decides), and, where `settled` is
 * set, the last day's settled ones with what they did.
 */
export function YardEvents({ settled = false }: { settled?: boolean }) {
  const { data } = useApi<YardDto>("/yard", { refreshMs: 60_000 });
  const toast = useToast();
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return null;
  const open = data.events.filter((e) => !e.choice);
  const done = settled ? data.events.filter((e) => e.choice) : [];
  if (!open.length && !done.length) return null;

  const answer = async (e: YardEventDto, choice: YardChoice) => {
    setBusy(`${e.id}:${choice}`);
    try {
      const r = await post<YardEventDto>(`/yard/${e.id}/${choice}`);
      haptic.success();
      toast(`${e.horseName}: ${outcomeText(r.outcome!)}`, r.outcome?.bad ? "bad" : undefined);
      invalidate("/yard", `/horses/${e.horseId}`, "/horses", "/wallet", "/home", "/horses/care/round");
    } catch (err) {
      haptic.error();
      toast(errorMessage(err), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionTitle>{t("yard.title")}</SectionTitle>
      <div className="space-y-2">
        {open.map((e) => {
          const Icon = ICON[e.kind];
          return (
            <Card key={e.id} className="border-warn/40">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{t(`yard.${e.kind}.title` as MessageKey)}</p>
                  <p className="mt-1 text-sm text-muted">
                    {t(`yard.${e.kind}.story` as MessageKey, { name: e.horseName })}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  className="text-sm"
                  loading={busy === `${e.id}:ACT`}
                  disabled={busy !== null}
                  onClick={() => void answer(e, "ACT")}
                >
                  {t(`yard.${e.kind}.act` as MessageKey, { n: fmt(e.actCost) })}
                </Button>
                <Button
                  variant="ghost"
                  className="text-sm"
                  loading={busy === `${e.id}:WAIT`}
                  disabled={busy !== null}
                  onClick={() => void answer(e, "WAIT")}
                >
                  {t(`yard.${e.kind}.wait` as MessageKey)}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted">
                {t("yard.expires", { t: countdown(e.expiresAt, now) })}
              </p>
            </Card>
          );
        })}
        {done.length > 0 && (
          <Card>
            <ul className="space-y-2 text-sm">
              {done.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">
                    {e.horseName}: {t(`yard.${e.kind}.title` as MessageKey).toLowerCase()}
                  </span>
                  <span className={`block text-xs ${e.outcome?.bad ? "text-bad" : "text-muted"}`}>
                    {!e.answered && `${t("yard.settledItself")} · `}
                    {e.outcome ? outcomeText(e.outcome) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
