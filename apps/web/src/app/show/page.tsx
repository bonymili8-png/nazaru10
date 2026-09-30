"use client";
import type { ShowdownDto, ShowdownSummaryDto } from "@thoroughline/contracts";
import { SURFACES, type Surface } from "@thoroughline/engine";
import { Copy, MonitorPlay, Send, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CurrentRace, ModeBadge, PastRaces, Standings, Tactics } from "@/components/Showdown";
import { Badge, Button, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { errorMessage, titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { appLink, haptic, shareToTelegram } from "@/lib/telegram";

export default function ShowPageWrapper() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ShowPage />
    </Suspense>
  );
}

function ShowPage() {
  const code = useSearchParams().get("code")?.toUpperCase() ?? null;
  return code ? <ShowdownView code={code} /> : <ShowdownHome />;
}

const inputClass =
  "mt-1 min-h-11 w-full rounded-xl border border-line/60 bg-surface-2 px-3 text-base text-ink placeholder:text-muted focus:border-gold focus:outline-none";

/* ───────────────────────────── lobby: create, join, mine ───────────────────────────── */

function ShowdownHome() {
  const router = useRouter();
  const toast = useToast();
  const mine = useApi<ShowdownSummaryDto[]>("/showdowns");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ShowdownDto["mode"]>("NO_FATIGUE");
  const [fillField, setFillField] = useState(true);
  const [handle, setHandle] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const s = await post<ShowdownDto>("/showdowns", { name, mode, fillField, displayName: handle });
      haptic.success();
      invalidate("/showdowns");
      router.push(`/show/?code=${s.code}`);
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("showdown.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("showdown.lede")}</p>

      {mine.data && mine.data.length > 0 && (
        <>
          <SectionTitle>{t("showdown.mine")}</SectionTitle>
          <div className="space-y-2">
            {mine.data.map((s) => (
              <Link key={s.code} href={`/show/?code=${s.code}`} className="block">
                <Card className="flex items-center justify-between gap-3 transition-colors hover:border-gold">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="text-xs text-muted">
                      {s.code} · {t("showdown.playersN", { n: s.players })} ·{" "}
                      {t("showdown.racesN", { n: s.races })}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <ModeBadge mode={s.mode} />
                    {s.status === "FINISHED" && <Badge>{t("showdown.finished")}</Badge>}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionTitle>{t("showdown.join")}</SectionTitle>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c) router.push(`/show/?code=${c}`);
          }}
          className="flex gap-2"
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC234"
            aria-label={t("showdown.code")}
            autoCapitalize="characters"
            className={`${inputClass} mt-0 flex-1 font-mono tracking-[0.3em]`}
          />
          <Button type="submit" disabled={code.trim().length !== 6}>
            {t("showdown.open")}
          </Button>
        </form>
      </Card>

      <SectionTitle>{t("showdown.create")}</SectionTitle>
      <Card>
        <label className="block text-sm">
          {t("showdown.name")}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className={inputClass}
            placeholder="Friday Night Derby"
          />
        </label>
        <label className="mt-3 block text-sm">
          {t("showdown.yourName")}
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={24}
            className={inputClass}
            placeholder="@your_handle"
          />
        </label>
        <p className="mt-3 text-sm">{t("showdown.modeLabel")}</p>
        <div className="mt-1 space-y-2" role="radiogroup" aria-label={t("showdown.modeLabel")}>
          {(["NO_FATIGUE", "NORMAL"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors ${mode === m ? "border-gold bg-gold/10" : "border-line/60 bg-surface-2"}`}
            >
              <span className="block font-semibold">{t(`showdown.mode.${m}`)}</span>
              <span className="block text-xs text-muted">{t(`showdown.modeHint.${m}`)}</span>
            </button>
          ))}
        </div>
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={fillField}
            onChange={(e) => setFillField(e.target.checked)}
            className="size-5 accent-[var(--color-gold,#e0b43a)]"
          />
          {t("showdown.fillField")}
        </label>
        <Button
          className="mt-3 w-full"
          loading={busy}
          disabled={name.trim().length < 2 || handle.trim().length < 2}
          onClick={() => void create()}
        >
          {t("showdown.createBtn")}
        </Button>
        <p className="mt-2 text-xs text-muted">{t("showdown.noEconomy")}</p>
      </Card>
    </div>
  );
}

/* ───────────────────────────── one showdown ───────────────────────────── */

function ShowdownView({ code }: { code: string }) {
  const { data: s, error, reload } = useApi<ShowdownDto>(`/showdowns/${code}`, { refreshMs: 3000 });
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!s) return <Skeleton className="h-64" />;
  const me = s.players.find((p) => p.me);
  return (
    <div>
      <Card className="bg-gradient-to-br from-surface to-surface-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">{s.name}</h1>
            <p className="text-sm text-muted">{t("showdown.hostedBy", { name: s.hostName })}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ModeBadge mode={s.mode} />
            {s.status === "FINISHED" && <Badge>{t("showdown.finished")}</Badge>}
          </div>
        </div>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted">{t("showdown.code")}</p>
        <p className="num font-mono text-3xl font-bold tracking-[0.3em] text-gold">{s.code}</p>
        <ShareRow s={s} />
      </Card>

      {!s.joined && s.status === "OPEN" && <JoinCard s={s} />}
      {s.isHost && s.status === "OPEN" && <HostPanel s={s} />}

      <CurrentRace s={s} livePath={(id) => `/showdowns/${s.code}/races/${id}/live`} />
      <Tactics s={s} />

      {me && (
        <>
          <SectionTitle>{t("showdown.yourHorse")}</SectionTitle>
          <Card className="text-sm">
            <p className="font-display text-lg font-semibold">{me.horseName}</p>
            <p className="text-muted">
              {t("showdown.bestTrip", { n: me.optimalDistance })} ·{" "}
              {t("showdown.favSurface", { s: titleCase(me.favouriteSurface) })}
              {s.mode === "NORMAL" && ` · ${t("showdown.fatigue", { n: me.fatigue })}`}
            </p>
          </Card>
        </>
      )}

      <Standings s={s} />
      <PastRaces s={s} />
    </div>
  );
}

/** Invite players (Mini App link), and the broadcast link for streams and social networks. */
function ShareRow({ s }: { s: ShowdownDto }) {
  const toast = useToast();
  const invite = appLink(`show_${s.code}`) ?? `${window.location.origin}/show/?code=${s.code}`;
  const watch = `${window.location.origin}/watch/?code=${s.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(watch);
      toast(t("showdown.copied"));
    } catch {
      window.prompt(t("showdown.copyManually"), watch);
    }
  };
  const shareNative = async () => {
    try {
      await navigator.share({ title: s.name, text: t("showdown.shareText", { name: s.name }), url: watch });
    } catch {
      /* dismissed */
    }
  };
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Button
        variant="secondary"
        className="text-sm"
        onClick={() => shareToTelegram(t("showdown.inviteText", { name: s.name, code: s.code }), invite)}
      >
        <Send className="size-4" aria-hidden />
        {t("showdown.invite")}
      </Button>
      <a
        href={watch}
        target="_blank"
        rel="noopener"
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface-2 px-3 text-sm font-medium transition-colors hover:border-gold"
      >
        <MonitorPlay className="size-4" aria-hidden />
        {t("showdown.broadcast")}
      </a>
      <Button variant="ghost" className="text-sm" onClick={() => void copy()}>
        <Copy className="size-4" aria-hidden />
        {t("showdown.copyWatch")}
      </Button>
      {typeof navigator !== "undefined" && "share" in navigator && (
        <Button variant="ghost" className="text-sm" onClick={() => void shareNative()}>
          <Share2 className="size-4" aria-hidden />
          {t("showdown.shareSocial")}
        </Button>
      )}
    </div>
  );
}

function JoinCard({ s }: { s: ShowdownDto }) {
  const toast = useToast();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const full = s.players.length >= s.maxPlayers;
  const join = async () => {
    setBusy(true);
    try {
      await post(`/showdowns/${s.code}/join`, { displayName: handle });
      haptic.success();
      toast(t("showdown.joined"));
      invalidate(`/showdowns/${s.code}`, "/showdowns");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mt-4">
      <p className="font-semibold">{t("showdown.joinTitle")}</p>
      <p className="mt-1 text-sm text-muted">{full ? t("showdown.full") : t("showdown.joinHint")}</p>
      {!full && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={24}
            placeholder="@your_handle"
            aria-label={t("showdown.yourName")}
            className={`${inputClass} mt-0 flex-1`}
          />
          <Button type="submit" loading={busy} disabled={handle.trim().length < 2}>
            {t("showdown.joinBtn")}
          </Button>
        </form>
      )}
    </Card>
  );
}

/** The host calls races (a trip and surface, or chance) and ends the showdown. */
function HostPanel({ s }: { s: ShowdownDto }) {
  const toast = useToast();
  const [distance, setDistance] = useState<number | null>(null);
  const [surface, setSurface] = useState<Surface | null>(null);
  const [busy, setBusy] = useState<"call" | "finish" | null>(null);
  const busyRace = s.races[0] && (s.races[0].status === "CALLED" || s.races[0].status === "RUNNING");
  const act = async (what: "call" | "finish") => {
    if (what === "finish" && !window.confirm(t("showdown.finishConfirm"))) return;
    setBusy(what);
    try {
      if (what === "call") await post(`/showdowns/${s.code}/races`, { distance, surface });
      else await post(`/showdowns/${s.code}/finish`);
      haptic.success();
      invalidate(`/showdowns/${s.code}`, "/showdowns");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const chip = (on: boolean) =>
    `min-h-10 cursor-pointer rounded-full border px-3 text-sm transition-colors ${on ? "border-gold bg-gold/10 text-ink" : "border-line/60 bg-surface-2 text-muted"}`;
  return (
    <>
      <SectionTitle>{t("showdown.hostPanel")}</SectionTitle>
      <Card>
        <p className="text-xs uppercase tracking-wider text-muted">{t("showdown.distance")}</p>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={t("showdown.distance")}>
          {[null, ...s.distances].map((d) => (
            <button
              key={d ?? "any"}
              role="radio"
              aria-checked={distance === d}
              onClick={() => setDistance(d)}
              className={chip(distance === d)}
            >
              {d === null ? t("showdown.any") : t("unit.m", { n: d })}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted">{t("showdown.surface")}</p>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={t("showdown.surface")}>
          {[null, ...SURFACES].map((x) => (
            <button
              key={x ?? "any"}
              role="radio"
              aria-checked={surface === x}
              onClick={() => setSurface(x)}
              className={chip(surface === x)}
            >
              {x === null ? t("showdown.any") : titleCase(x)}
            </button>
          ))}
        </div>
        <Button
          className="mt-4 w-full"
          loading={busy === "call"}
          disabled={busy !== null || !!busyRace}
          onClick={() => void act("call")}
        >
          {busyRace ? t("showdown.raceOn") : t("showdown.callRace", { n: s.callSeconds })}
        </Button>
        <Button
          variant="ghost"
          className="mt-2 w-full text-sm"
          loading={busy === "finish"}
          disabled={busy !== null}
          onClick={() => void act("finish")}
        >
          {t("showdown.finish")}
        </Button>
      </Card>
    </>
  );
}
