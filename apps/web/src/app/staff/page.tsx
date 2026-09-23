"use client";
import type { StaffDto, TrainerDto } from "@thoroughline/contracts";
import { ShieldPlus, Sparkles, TrendingUp } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionTitle,
  Skeleton,
  useToast,
} from "@/components/ui";
import { del, post } from "@/lib/api";
import { countdown, fmt, TRAINING_INFO } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { haptic } from "@/lib/telegram";

export default function StaffPage() {
  const staff = useApi<StaffDto>("/staff");
  const pool = useApi<TrainerDto[]>("/staff/trainers", { refreshMs: 30_000 });
  const now = useNow(60_000);
  const s = staff.data;
  const full = !!s && s.contracts.length >= s.maxTrainers;

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Staff</h1>
      <Card className="mt-3 text-sm text-muted">
        Trainers supervise every session in your stable: bigger gains (more in their speciality) and fewer
        injuries. Salaries are paid weekly in advance; if a week can&apos;t be paid, the trainer leaves.
      </Card>

      <SectionTitle>Your team {s ? `(${s.contracts.length}/${s.maxTrainers})` : ""}</SectionTitle>
      {staff.error && <ErrorState error={staff.error} retry={staff.reload} />}
      {!s && !staff.error && <Skeleton className="h-24" />}
      {s && s.contracts.length === 0 && (
        <EmptyState title="No trainers yet" body="Hire one below — your horses train better under a pro." />
      )}
      {s && s.contracts.length > 0 && (
        <div className="space-y-2">
          {s.contracts.map((k) => (
            <TrainerCard key={k.id} t={k.trainer}>
              <div className="mt-3 flex items-center justify-between">
                <p className="num text-xs text-muted">
                  Week {k.periods} · next salary in {countdown(k.paidUntil, now)}
                </p>
                <Dismiss contractId={k.id} name={k.trainer.name} />
              </div>
            </TrainerCard>
          ))}
          <p className="num text-right text-sm text-muted">Weekly cost {fmt(s.weeklyCost)} cr</p>
        </div>
      )}

      <SectionTitle>Available trainers</SectionTitle>
      {full && (
        <p className="mb-2 text-sm text-muted">
          Your stable is at its staff limit — upgrade it to employ more trainers.
        </p>
      )}
      {pool.error && <ErrorState error={pool.error} retry={pool.reload} />}
      {!pool.data && !pool.error && <Skeleton className="h-40" />}
      <div className="space-y-2">
        {pool.data?.map((t) => (
          <TrainerCard key={t.id} t={t}>
            <Hire t={t} disabled={full} />
          </TrainerCard>
        ))}
      </div>
    </div>
  );
}

function TrainerCard({ t, children }: { t: TrainerDto; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold">{t.name}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={t.skill >= 80 ? "gold" : "neutral"}>Skill {t.skill}</Badge>
            {t.specialty && <Badge tone="good">{TRAINING_INFO[t.specialty]!.label} specialist</Badge>}
          </div>
        </div>
        <div className="text-right">
          <p className="num font-semibold">{fmt(t.salary)} cr</p>
          <p className="text-xs text-muted">per week</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <Stat icon={<TrendingUp className="size-3.5" aria-hidden />} k="Gains" v={`+${t.effect.gainPct}%`} />
        <Stat
          icon={<Sparkles className="size-3.5" aria-hidden />}
          k="Speciality"
          v={t.specialty ? `+${t.effect.specialtyGainPct}%` : "—"}
        />
        <Stat
          icon={<ShieldPlus className="size-3.5" aria-hidden />}
          k="Injury risk"
          v={`−${t.effect.injuryReductionPct}%`}
        />
      </dl>
      {children}
    </Card>
  );
}

const Stat = ({ icon, k, v }: { icon: React.ReactNode; k: string; v: string }) => (
  <div className="rounded-xl bg-bg/40 py-2">
    <dt className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-muted">
      {icon}
      {k}
    </dt>
    <dd className="num font-semibold">{v}</dd>
  </div>
);

function Hire({ t, disabled }: { t: TrainerDto; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      className="mt-3 w-full"
      variant="secondary"
      disabled={disabled}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await post("/staff/contracts", { trainerId: t.id });
          haptic.success();
          toast(`${t.name} joined your stable`);
          invalidate("/staff", "/wallet", "/home");
        } catch (e) {
          haptic.error();
          toast((e as Error).message, "bad");
        } finally {
          setBusy(false);
        }
      }}
    >
      Hire · {fmt(t.salary)} cr first week
    </Button>
  );
}

function Dismiss({ contractId, name }: { contractId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      className="min-h-9 px-2 text-xs"
      loading={busy}
      onClick={async () => {
        if (!window.confirm(`Dismiss ${name}? The current week is not refunded.`)) return;
        setBusy(true);
        try {
          await del(`/staff/contracts/${contractId}`);
          toast(`${name} has left`);
          invalidate("/staff");
        } catch (e) {
          toast((e as Error).message, "bad");
        } finally {
          setBusy(false);
        }
      }}
    >
      Dismiss
    </Button>
  );
}
