"use client";
import type { HomeDto, QuestDto, RacingPassDto, WalletDto } from "@thoroughline/contracts";
import { CheckCircle2, ChevronRight, Circle, Flag, Gift, Store, Ticket } from "lucide-react";
import { HorseCard } from "@/components/HorseCard";
import { RaceCard } from "@/components/RaceCard";
import { HorseIcon } from "@/components/icons";
import { Button, Card, ErrorState, LinkButton, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { fmt } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { haptic } from "@/lib/telegram";
import { useState } from "react";

export default function HomePage() {
  const { data, error, reload } = useApi<HomeDto>("/home", { refreshMs: 20_000 });
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  const idle = data.horses.filter((h) => h.status === "IDLE").length;

  return (
    <div>
      <Card className="bg-gradient-to-br from-surface to-surface-2">
        <p className="text-xs uppercase tracking-[0.25em] text-gold">Level {data.stable.level} stable</p>
        <h1 className="mt-1 font-display text-2xl font-bold">{data.stable.name}</h1>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Horses" value={`${data.stable.horseCount}/${data.stable.capacity}`} />
          <Stat label="Reputation" value={fmt(data.stable.reputation)} />
          <Stat label="Ready" value={String(idle)} />
        </dl>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <LinkButton href="/horses/" className="text-sm">
            <HorseIcon className="size-4" />
            Train
          </LinkButton>
          <LinkButton href="/races/" variant="primary" className="text-sm">
            <Flag className="size-4" />
            Race
          </LinkButton>
          <LinkButton href="/shop/" className="text-sm">
            <Store className="size-4" />
            Buy
          </LinkButton>
        </div>
      </Card>

      <Allowance />

      <PassTeaser />

      <Quests quests={data.quests} />

      {data.myUpcomingRaces.length > 0 && (
        <>
          <SectionTitle>Your races</SectionTitle>
          <div className="space-y-2">
            {data.myUpcomingRaces.map((r) => (
              <RaceCard key={r.id} race={r} />
            ))}
          </div>
        </>
      )}

      <SectionTitle
        action={
          <LinkButton href="/horses/" variant="ghost" className="min-h-9 text-sm">
            All
          </LinkButton>
        }
      >
        Your string
      </SectionTitle>
      <div className="space-y-2">
        {data.horses.map((h) => (
          <HorseCard key={h.id} horse={h} href={`/horse/?id=${h.id}`} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg/40 py-2">
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="num font-display text-xl font-bold">{value}</dd>
    </div>
  );
}

function Quests({ quests }: { quests: QuestDto[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const open = quests.filter((q) => !q.claimed).slice(0, 3);
  if (open.length === 0) return null;
  const claim = async (q: QuestDto) => {
    setBusy(q.code);
    try {
      await post(`/quests/${q.code}/claim`);
      haptic.success();
      toast(`Reward claimed: ${q.title}`);
      invalidate("/home", "/wallet");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <SectionTitle>Career path</SectionTitle>
      <Card className="divide-y divide-line/40 p-0">
        {open.map((q) => (
          <div key={q.code} className="flex items-center gap-3 px-4 py-3">
            {q.completed ? (
              <CheckCircle2 className="size-5 shrink-0 text-good" aria-label="Completed" />
            ) : (
              <Circle className="size-5 shrink-0 text-line" aria-label="Not completed" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{q.title}</p>
              <p className="text-sm text-muted">
                {q.description} ·{" "}
                <span className="num text-gold">
                  {[
                    q.reward.credits && `${fmt(q.reward.credits)} cr`,
                    q.reward.gems && `${q.reward.gems} gems`,
                    q.reward.reputation && `${q.reward.reputation} rep`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </p>
            </div>
            {q.completed && (
              <Button
                onClick={() => claim(q)}
                loading={busy === q.code}
                className="min-h-9 px-3 text-sm"
                aria-label={`Claim ${q.title}`}
              >
                <Gift className="size-4" aria-hidden />
                Claim
              </Button>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

function Allowance() {
  const wallet = useApi<WalletDto>("/wallet");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const a = wallet.data?.allowance;
  if (!a?.eligible) return null;
  return (
    <Card className="mt-4 flex items-center justify-between gap-3 border-gold/40">
      <p className="text-sm">
        Running low? Claim today&apos;s <span className="num text-gold">{fmt(a.amount)} cr</span> stable
        allowance.
      </p>
      <Button
        className="min-h-10 shrink-0 px-3 text-sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await post("/wallet/allowance");
            haptic.success();
            toast("Allowance added to your wallet");
            invalidate("/wallet", "/home");
          } catch (e) {
            toast((e as Error).message, "bad");
          } finally {
            setBusy(false);
          }
        }}
      >
        Claim
      </Button>
    </Card>
  );
}

function PassTeaser() {
  const { data } = useApi<RacingPassDto>("/pass", { refreshMs: 60_000 });
  if (!data) return null;
  const inTier = data.tier >= data.maxTier ? data.xpPerTier : data.xp - data.tier * data.xpPerTier;
  const open = data.tiers.filter(
    (t) =>
      t.tier <= data.tier && ((t.free && !t.freeClaimed) || (data.premium && t.premium && !t.premiumClaimed)),
  ).length;
  return (
    <a
      href="/pass/"
      className="mt-3 block rounded-[var(--radius-card)] border border-gold/40 bg-surface p-4 hover:border-gold"
    >
      <div className="flex items-center gap-3">
        <Ticket className="size-5 text-gold" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Racing Pass · tier {data.tier}/{data.maxTier}
            {open > 0 && (
              <span className="ml-2 rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-bg">
                {open} to claim
              </span>
            )}
          </p>
          <div className="mt-1.5 h-1.5 rounded-full bg-surface-2" aria-hidden>
            <div
              className="h-1.5 rounded-full bg-gold"
              style={{ width: `${(inTier / data.xpPerTier) * 100}%` }}
            />
          </div>
        </div>
        <ChevronRight className="size-4 text-muted" aria-hidden />
      </div>
    </a>
  );
}
