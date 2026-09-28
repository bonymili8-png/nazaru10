"use client";
import type { SponsorContractDto, SponsorsDto } from "@thoroughline/contracts";
import { TRACKS } from "@thoroughline/engine";
import { Handshake } from "lucide-react";
import { useState } from "react";
import { sponsorGoalText } from "@/components/SponsorGoal";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

export default function SponsorsPage() {
  const { data, error, reload } = useApi<SponsorsDto>("/sponsors", { refreshMs: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const now = useNow(60_000);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="h-64" />;

  const sign = async (code: string) => {
    setBusy(code);
    try {
      await post(`/sponsors/${code}/sign`);
      haptic.success();
      toast(t("sponsor.signed"));
      invalidate("/sponsors", "/home");
      reload();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("sponsor.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("sponsor.intro")}</p>

      {data.active && <ActiveContract k={data.active} now={now} />}

      <SectionTitle>{t("sponsor.offers")}</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-muted">
        {t("sponsor.newOffersIn", { t: countdown(data.weekEndsAt, now) })}
      </p>
      <div className="space-y-2">
        {data.offers.map((o) => (
          <Card key={o.code} className="flex items-center gap-3">
            <Handshake className="size-6 shrink-0 text-gold" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{o.name}</p>
              <p className="text-sm text-muted">{sponsorGoalText(o.goal)}</p>
              <p className="num text-sm text-gold">
                {t("sponsor.reward", { cr: fmt(o.reward), rep: o.reputation })}
              </p>
            </div>
            <Button
              className="min-h-10 shrink-0 px-3 text-sm"
              disabled={data.signedThisWeek || !!data.active}
              loading={busy === o.code}
              onClick={() => sign(o.code)}
              aria-label={t("sponsor.signName", { name: o.name })}
            >
              {t("sponsor.sign")}
            </Button>
          </Card>
        ))}
      </div>
      {data.signedThisWeek && <p className="mt-2 text-xs text-muted">{t("sponsor.oncePerWeek")}</p>}

      {data.history.length > 0 && (
        <>
          <SectionTitle>{t("sponsor.history")}</SectionTitle>
          <Card className="divide-y divide-line/40 p-0 text-sm">
            {data.history.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="truncate">{k.name}</span>
                <Badge tone={k.status === "COMPLETED" ? "good" : "neutral"}>
                  {k.status === "COMPLETED"
                    ? t("sponsor.completed", { cr: fmt(k.reward) })
                    : t("sponsor.expired")}
                </Badge>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function ActiveContract({ k, now }: { k: SponsorContractDto; now: number }) {
  return (
    <Card className="mt-3 border-gold/50 bg-gradient-to-br from-surface to-surface-2">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">{t("sponsor.active")}</p>
      <p className="mt-1 font-display text-xl font-bold">{k.name}</p>
      <p className="text-sm text-muted">{sponsorGoalText(k.goal)}</p>
      {k.goal.surface && (
        // Track names are what race cards show, so the player can spot qualifying races.
        <p className="mt-1 text-xs text-muted">
          {t("sponsor.tracks", {
            tracks: TRACKS.filter((tr) => tr.surface === k.goal.surface)
              .map((tr) => tr.name)
              .join(", "),
          })}
        </p>
      )}
      <div
        className="mt-3 h-2 rounded-full bg-bg/60"
        role="progressbar"
        aria-valuenow={k.progress}
        aria-valuemax={k.goal.count}
        aria-label={t("sponsor.progress")}
      >
        <div
          className="h-2 rounded-full bg-gold"
          style={{ width: `${(k.progress / k.goal.count) * 100}%` }}
        />
      </div>
      <p className="num mt-2 flex justify-between text-sm">
        <span>{t("sponsor.progressOf", { n: k.progress, of: k.goal.count })}</span>
        <span className="text-muted">{t("sponsor.endsIn", { t: countdown(k.expiresAt, now) })}</span>
      </p>
      <p className="num mt-1 text-sm text-gold">
        {t("sponsor.reward", { cr: fmt(k.reward), rep: k.reputation })}
      </p>
    </Card>
  );
}
