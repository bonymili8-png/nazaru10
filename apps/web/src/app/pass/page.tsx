"use client";
import type { PassRewardDto, PassTierDto, RacingPassDto } from "@thoroughline/contracts";
import { Check, Crown, Gem, Lock, Ticket } from "lucide-react";
import { useState } from "react";
import { Silk } from "@/components/Silk";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, titleCase } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
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
      <h1 className="font-display text-3xl font-bold">Racing Pass</h1>
      <Card className="mt-3 bg-gradient-to-br from-surface to-surface-2">
        <div className="flex items-center justify-between">
          <p className="font-display text-2xl font-bold">Season {data.season}</p>
          <p className="num text-sm text-muted">ends in {countdown(data.endsAt, now)}</p>
        </div>
        <p className="num mt-2 text-sm">
          Tier <span className="font-semibold text-gold">{data.tier}</span> / {data.maxTier} · {data.xp} XP
        </p>
        <div
          className="mt-2 h-2 rounded-full bg-bg/60"
          role="progressbar"
          aria-valuenow={inTier}
          aria-valuemax={data.xpPerTier}
          aria-label="Progress to next tier"
        >
          <div
            className="h-2 rounded-full bg-gold"
            style={{ width: `${(inTier / data.xpPerTier) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          Earn XP by playing: {data.xpRules.raceRun} per race run, +{data.xpRules.win} for a win, +
          {data.xpRules.second} for 2nd, +{data.xpRules.third} for 3rd, {data.xpRules.training} per training
          session. Rewards are gems and exclusive silks — never an advantage on the track.
        </p>
        {!data.premium && (
          <Button
            className="mt-3 w-full"
            loading={busy === "premium"}
            disabled={data.gems < data.premiumPriceGems}
            onClick={() => {
              if (!window.confirm(`Unlock the premium track for ${data.premiumPriceGems} gems?`)) return;
              void act("premium", () => post("/pass/premium"), "Premium track unlocked");
            }}
          >
            <Crown className="size-4" aria-hidden />
            Unlock premium · {data.premiumPriceGems} gems
          </Button>
        )}
        {!data.premium && data.gems < data.premiumPriceGems && (
          <p className="mt-2 text-center text-xs text-muted">
            You have {data.gems} gems ·{" "}
            <a href="/shop/" className="text-gold hover:underline">
              get more
            </a>
          </p>
        )}
        {data.premium && (
          <p className="mt-3 flex items-center gap-2 text-sm text-gold">
            <Crown className="size-4" aria-hidden /> Premium track active this season
          </p>
        )}
      </Card>

      <SectionTitle>Rewards</SectionTitle>
      <div className="mb-2 grid grid-cols-[3rem_1fr_1fr] gap-2 px-1 text-[10px] uppercase tracking-wider text-muted">
        <span>Tier</span>
        <span>Free</span>
        <span className="flex items-center gap-1">
          <Crown className="size-3" aria-hidden /> Premium
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
                    "Reward claimed",
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
                    "Reward claimed",
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
  const label = reward.silk ? `${titleCase(reward.silk)} silks` : `${reward.gems} gems`;
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
          <Check className="size-3" aria-hidden /> Claimed
        </Badge>
      ) : reached && eligible ? (
        <Button
          className="min-h-9 w-full px-2 text-xs"
          loading={busy}
          onClick={onClaim}
          aria-label={`Claim tier ${tier.tier} ${track.toLowerCase()} reward`}
        >
          Claim
        </Button>
      ) : (
        <span className="flex items-center gap-1 text-[11px] text-muted">
          {!eligible ? <Ticket className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
          {!eligible ? "Premium" : `${tier.xpRequired} XP`}
        </span>
      )}
    </Card>
  );
}
