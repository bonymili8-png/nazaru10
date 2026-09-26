"use client";
import type { PassRewardDto, PassTierDto, RacingPassDto } from "@thoroughline/contracts";
import { Check, Crown, Gem, Lock, Ticket } from "lucide-react";
import { useState } from "react";
import { Silk } from "@/components/Silk";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, titleCase } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { t as tr } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

export default function PassPage() {
  const { data, error, reload } = useApi<RacingPassDto>("/pass");
  const now = useNow(60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  const inTier = data.tier >= data.maxTier ? data.xpPerTier : data.xp - data.tier * data.xpPerTier;

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      haptic.success();
      toast(ok);
      invalidate("/pass", "/wallet", "/cosmetics");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{tr("pass.title")}</h1>
      <Card className="mt-3 bg-gradient-to-br from-surface to-surface-2">
        <div className="flex items-center justify-between">
          <p className="font-display text-2xl font-bold">{tr("rank.seasonN", { n: data.season })}</p>
          <p className="num text-sm text-muted">{tr("rank.endsIn", { t: countdown(data.endsAt, now) })}</p>
        </div>
        <p className="num mt-2 text-sm">
          {tr("pass.tierLine", { tier: data.tier, max: data.maxTier, xp: data.xp })}
        </p>
        <div
          className="mt-2 h-2 rounded-full bg-bg/60"
          role="progressbar"
          aria-valuenow={inTier}
          aria-valuemax={data.xpPerTier}
          aria-label={tr("pass.progress")}
        >
          <div
            className="h-2 rounded-full bg-gold"
            style={{ width: `${(inTier / data.xpPerTier) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          {tr("pass.xpRules", {
            run: data.xpRules.raceRun,
            win: data.xpRules.win,
            second: data.xpRules.second,
            third: data.xpRules.third,
            training: data.xpRules.training,
          })}
        </p>
        {!data.premium && (
          <Button
            className="mt-3 w-full"
            loading={busy === "premium"}
            disabled={data.gems < data.premiumPriceGems}
            onClick={() => {
              if (!window.confirm(tr("pass.confirmPremium", { n: data.premiumPriceGems }))) return;
              void act("premium", () => post("/pass/premium"), tr("pass.premiumUnlocked"));
            }}
          >
            <Crown className="size-4" aria-hidden />
            {tr("pass.unlockPremium", { n: data.premiumPriceGems })}
          </Button>
        )}
        {!data.premium && data.gems < data.premiumPriceGems && (
          <p className="mt-2 text-center text-xs text-muted">
            {tr("common.youHaveGems", { n: data.gems })} ·{" "}
            <a href="/shop/" className="text-gold hover:underline">
              {tr("common.getMore")}
            </a>
          </p>
        )}
        {data.premium && (
          <p className="mt-3 flex items-center gap-2 text-sm text-gold">
            <Crown className="size-4" aria-hidden /> {tr("pass.premiumActive")}
          </p>
        )}
      </Card>

      <SectionTitle>{tr("pass.rewards")}</SectionTitle>
      <div className="mb-2 grid grid-cols-[3rem_1fr_1fr] gap-2 px-1 text-[10px] uppercase tracking-wider text-muted">
        <span>{tr("pass.tier")}</span>
        <span>{tr("pass.free")}</span>
        <span className="flex items-center gap-1">
          <Crown className="size-3" aria-hidden /> {tr("pass.premium")}
        </span>
      </div>
      <div className="space-y-2">
        {data.tiers
          .filter((t) => t.free || t.premium)
          .map((t) => (
            <div key={t.tier} className="grid grid-cols-[3rem_1fr_1fr] items-stretch gap-2">
              <div
                className={`num grid place-items-center rounded-xl font-display text-lg font-bold ${t.tier <= data.tier ? "bg-gold/20 text-gold" : "bg-surface text-muted"}`}
              >
                {t.tier}
              </div>
              <RewardCell
                tier={t}
                track="FREE"
                reward={t.free}
                claimed={t.freeClaimed}
                reached={t.tier <= data.tier}
                eligible
                busy={busy === `${t.tier}:FREE`}
                onClaim={() =>
                  act(
                    `${t.tier}:FREE`,
                    () => post("/pass/claim", { tier: t.tier, track: "FREE" }),
                    tr("pass.claimed"),
                  )
                }
              />
              <RewardCell
                tier={t}
                track="PREMIUM"
                reward={t.premium}
                claimed={t.premiumClaimed}
                reached={t.tier <= data.tier}
                eligible={data.premium}
                busy={busy === `${t.tier}:PREMIUM`}
                onClaim={() =>
                  act(
                    `${t.tier}:PREMIUM`,
                    () => post("/pass/claim", { tier: t.tier, track: "PREMIUM" }),
                    tr("pass.claimed"),
                  )
                }
              />
            </div>
          ))}
      </div>
    </div>
  );
}

function RewardCell({
  tier,
  track,
  reward,
  claimed,
  reached,
  eligible,
  busy,
  onClaim,
}: {
  tier: PassTierDto;
  track: "FREE" | "PREMIUM";
  reward: PassRewardDto | null;
  claimed: boolean;
  reached: boolean;
  eligible: boolean;
  busy: boolean;
  onClaim: () => void;
}) {
  if (!reward) return <div className="rounded-xl border border-dashed border-line/40" aria-hidden />;
  const label = reward.silk
    ? tr("pass.silks", { name: titleCase(reward.silk) })
    : tr("pass.gems", { n: reward.gems ?? 0 });
  return (
    <Card className="flex flex-col items-center justify-center gap-1 p-2 text-center">
      {reward.silk ? (
        <Silk silks={{ pattern: reward.silk, primary: "gold", secondary: "black" }} size={32} title={label} />
      ) : (
        <Gem className="size-6 text-gold" aria-hidden />
      )}
      <span className="text-xs font-medium">{label}</span>
      {claimed ? (
        <Badge tone="good">
          <Check className="size-3" aria-hidden /> {tr("pass.claimedBadge")}
        </Badge>
      ) : reached && eligible ? (
        <Button
          className="min-h-9 w-full px-2 text-xs"
          loading={busy}
          onClick={onClaim}
          aria-label={tr("pass.claimTier", {
            tier: tier.tier,
            track: track === "FREE" ? tr("pass.free").toLowerCase() : tr("pass.premium").toLowerCase(),
          })}
        >
          {tr("common.claim")}
        </Button>
      ) : (
        <span className="flex items-center gap-1 text-[11px] text-muted">
          {!eligible ? <Ticket className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
          {!eligible ? tr("pass.premium") : `${tier.xpRequired} XP`}
        </span>
      )}
    </Card>
  );
}
