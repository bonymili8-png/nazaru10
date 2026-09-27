"use client";
import type { ClubDetailDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Crest } from "@/components/Crest";
import { MemberBadge } from "@/components/MemberBadge";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LinkButton,
  SectionTitle,
  Skeleton,
  useToast,
} from "@/components/ui";
import { post } from "@/lib/api";
import { countdown, errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi, useNow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { haptic } from "@/lib/telegram";

export default function ClubPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ClubPage />
    </Suspense>
  );
}

function ClubPage() {
  const id = useSearchParams().get("id");
  const { data: k, error, reload } = useApi<ClubDetailDto>(id ? `/clubs/${id}` : null, { refreshMs: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const now = useNow(60_000);
  if (!id) return <ErrorState error={new Error(t("club.noneSelected"))} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!k) return <Skeleton className="h-64" />;
  const hours = defaultConfig.clubs.rejoinCooldownHours;

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      haptic.success();
      toast(ok);
      invalidate("/clubs");
      if (key !== "leave") reload();
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
      throw e;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <Card className="bg-gradient-to-br from-surface to-surface-2">
        <Badge tone="gold">{k.tag}</Badge>
        <h1 className="mt-2 font-display text-2xl font-bold">{k.name}</h1>
        {k.description && <p className="mt-1 text-sm text-muted">{k.description}</p>}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            [t("club.rank"), k.rank ?? "—"],
            [t("club.points", { n: k.season }), fmt(k.points)],
            [t("club.membersTitle"), `${k.members}/${k.maxMembers}`],
          ].map(([label, v]) => (
            <div key={String(label)} className="rounded-xl bg-bg/40 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{label}</dt>
              <dd className="num font-display text-xl font-bold text-gold">{v}</dd>
            </div>
          ))}
        </dl>
        {!k.myRole && k.joinBlocked === null && (
          <Button
            className="mt-4 w-full"
            loading={busy === "join"}
            onClick={() =>
              void act("join", () => post(`/clubs/${k.id}/join`), t("club.joined")).catch(() => undefined)
            }
          >
            {t("club.join")}
          </Button>
        )}
        {!k.myRole && k.joinBlocked && (
          <p className="mt-3 text-sm text-muted" role="status">
            {k.joinBlocked === "COOLDOWN" && k.cooldownUntil
              ? t("club.cooldown", { t: countdown(k.cooldownUntil, now) })
              : t(`club.blocked.${k.joinBlocked === "COOLDOWN" ? "FULL" : k.joinBlocked}`)}
          </p>
        )}
        {k.myRole && (
          <Button
            variant="ghost"
            className="mt-4 w-full"
            loading={busy === "leave"}
            onClick={() => {
              const msg = k.myRole === "OWNER" ? "club.confirmLeaveOwner" : "club.confirmLeave";
              if (!window.confirm(t(msg, { h: hours }))) return;
              void act("leave", () => post("/clubs/leave"), t("club.left")).then(
                () => {
                  // The club may have closed (last member out): go back to the club table.
                  window.location.href = "/rankings/?tab=clubs";
                },
                () => undefined,
              );
            }}
          >
            {t("club.leave")}
          </Button>
        )}
      </Card>

      <SectionTitle>{t("club.membersTitle")}</SectionTitle>
      <Card className="divide-y divide-line/40 p-0">
        {k.memberList.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 px-4 py-2.5">
            <Crest crest={m.crest} size={26} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate font-medium">
                {m.name}
                {m.member && <MemberBadge />}
                {m.role === "OWNER" && <Badge tone="gold">{t("club.owner")}</Badge>}
              </p>
              <p className="truncate text-xs text-muted">{m.stableName}</p>
            </div>
            <span className="num text-sm font-semibold">{t("club.pts", { n: fmt(m.points) })}</span>
            {k.myRole === "OWNER" && m.role !== "OWNER" && (
              <Button
                variant="ghost"
                className="min-h-9 px-2 text-xs"
                loading={busy === m.userId}
                onClick={() => {
                  if (!window.confirm(t("club.confirmKick", { name: m.name }))) return;
                  void act(
                    m.userId,
                    () => post(`/clubs/members/${m.userId}/kick`),
                    t("club.kicked", { name: m.name }),
                  ).catch(() => undefined);
                }}
              >
                {t("club.kick")}
              </Button>
            )}
          </div>
        ))}
      </Card>
      <LinkButton href="/rankings/" className="mt-4 w-full">
        {t("common.back")}
      </LinkButton>
    </div>
  );
}
