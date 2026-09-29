"use client";
import Link from "next/link";
import {
  type CosmeticsDto,
  type FinishEffect as Effect,
  SILK_COLORS,
  type SilkColor,
  type SilkPattern,
  type Silks,
} from "@thoroughline/contracts";
import { Gem, Lock, Play, Ticket } from "lucide-react";
import { useState } from "react";
import { ColorPicker } from "@/components/ColorPicker";
import { FinishEffect } from "@/components/FinishEffect";
import { Silk } from "@/components/Silk";
import { Button, Card, ErrorState, LinkButton, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post, put } from "@/lib/api";
import { errorMessage, titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import { memberLocked } from "@/lib/member";
import { haptic } from "@/lib/telegram";

const COLORS = Object.keys(SILK_COLORS) as SilkColor[];

export default function SilksPage() {
  const { data, error, reload } = useApi<CosmeticsDto>("/cosmetics");
  const [draft, setDraft] = useState<Silks | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  const silks = draft ?? data.silks;
  const owned = new Set(data.patterns.filter((p) => p.owned).map((p) => p.pattern));
  const changed = JSON.stringify(silks) !== JSON.stringify(data.silks);

  const unlock = async (pattern: SilkPattern, price: number) => {
    if (!window.confirm(t("silks.confirmUnlock", { name: titleCase(pattern), n: price }))) return;
    setBusy(pattern);
    try {
      await post(`/cosmetics/silks/patterns/${pattern}/unlock`);
      haptic.success();
      toast(t("silks.unlocked", { name: titleCase(pattern) }));
      setDraft({ ...silks, pattern });
      invalidate("/cosmetics", "/wallet");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await put("/cosmetics/silks", silks);
      haptic.success();
      toast(t("silks.saved"));
      setDraft(null);
      invalidate("/cosmetics");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("silks.title")}</h1>
      <Card className="mt-3 flex flex-col items-center gap-3 bg-gradient-to-br from-surface to-surface-2 py-6">
        <Silk silks={silks} size={120} title={t("silks.preview")} />
        <p className="text-sm text-muted">{t("silks.intro")}</p>
      </Card>

      <SectionTitle>{t("silks.pattern")}</SectionTitle>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("silks.pattern")}>
        {data.patterns.map((p) => {
          const isOwned = owned.has(p.pattern);
          const selected = silks.pattern === p.pattern;
          return (
            <button
              key={p.pattern}
              role="radio"
              aria-checked={selected}
              onClick={() =>
                isOwned
                  ? setDraft({ ...silks, pattern: p.pattern })
                  : p.priceGems === null
                    ? (window.location.href = "/pass/")
                    : void unlock(p.pattern, p.priceGems)
              }
              disabled={busy !== null}
              className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border p-2 transition-colors ${selected ? "border-gold bg-gold/10" : "border-line/60 bg-surface"}`}
            >
              <Silk silks={{ ...silks, pattern: p.pattern }} size={40} title={titleCase(p.pattern)} />
              <span className="text-xs font-medium">{titleCase(p.pattern)}</span>
              {!isOwned && p.priceGems === null && (
                <span className="flex items-center gap-1 text-[11px] text-gold">
                  <Ticket className="size-3" aria-hidden />
                  {t("pass.title")}
                </span>
              )}
              {!isOwned && p.priceGems !== null && (
                <span className="num flex items-center gap-1 text-[11px] text-gold">
                  <Lock className="size-3" aria-hidden />
                  {p.priceGems}
                  <Gem className="size-3" aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-right text-xs text-muted">
        {t("common.youHaveGems", { n: data.gems })} ·{" "}
        <Link href="/shop/" className="text-gold hover:underline">
          {t("common.getMore")}
        </Link>
      </p>

      <SectionTitle>{t("silks.colours")}</SectionTitle>
      {(["primary", "secondary"] as const).map((slot) => (
        <ColorPicker
          key={slot}
          label={slot === "primary" ? t("silks.body") : t("silks.patternColour")}
          value={silks[slot]}
          colors={COLORS}
          onChange={(c) => setDraft({ ...silks, [slot]: c })}
          blocked={(c) => c === (slot === "primary" ? silks.secondary : silks.primary)}
          lockedLabel={(c) => (memberLocked(c, data.member) ? t("circle.memberColour") : null)}
        />
      ))}

      <FinishEffects data={data} />

      <div className="mt-5 grid grid-cols-2 gap-2">
        <LinkButton href="/profile/">{t("common.back")}</LinkButton>
        <Button onClick={save} disabled={!changed} loading={busy === "save"}>
          {t("silks.save")}
        </Button>
      </div>
    </div>
  );
}

/** The stable's winner celebration: pick, unlock for gems and preview. */
function FinishEffects({ data }: { data: CosmeticsDto }) {
  const toast = useToast();
  const [busy, setBusy] = useState<Effect | null>(null);
  const [preview, setPreview] = useState<{ effect: Effect; n: number } | null>(null);
  const name = (e: Effect) => t(`finish.${e}` as MessageKey);
  const choose = async (f: CosmeticsDto["finishEffects"][number]) => {
    if (f.effect === data.finishEffect) return;
    setBusy(f.effect);
    try {
      if (!f.owned) {
        if (!window.confirm(t("finish.confirmUnlock", { name: name(f.effect), n: f.priceGems }))) return;
        await post(`/cosmetics/finish/${f.effect}/unlock`);
        toast(t("finish.unlocked", { name: name(f.effect) }));
      }
      await put("/cosmetics/finish", { effect: f.effect });
      haptic.success();
      toast(t("finish.saved", { name: name(f.effect) }));
      setPreview((p) => ({ effect: f.effect, n: (p?.n ?? 0) + 1 }));
      invalidate("/cosmetics", "/wallet");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const shown = preview?.effect ?? data.finishEffect;
  return (
    <>
      <SectionTitle
        action={
          <Button
            variant="ghost"
            className="min-h-9 text-sm"
            onClick={() => setPreview((p) => ({ effect: shown, n: (p?.n ?? 0) + 1 }))}
          >
            <Play className="size-4" aria-hidden />
            {t("finish.preview")}
          </Button>
        }
      >
        {t("finish.title")}
      </SectionTitle>
      <Card className="relative min-h-28 overflow-hidden bg-gradient-to-br from-surface to-surface-2">
        {preview && <FinishEffect key={preview.n} effect={preview.effect} />}
        <p className="relative text-sm text-muted">{t("finish.hint")}</p>
        <div
          className="relative mt-3 grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label={t("finish.title")}
        >
          {data.finishEffects.map((f) => (
            <button
              key={f.effect}
              role="radio"
              aria-checked={data.finishEffect === f.effect}
              disabled={busy !== null}
              onClick={() => void choose(f)}
              className={`flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border p-2 text-center transition-colors ${data.finishEffect === f.effect ? "border-gold bg-gold/10" : "border-line/60 bg-surface"}`}
            >
              <span className="text-xs font-medium">{name(f.effect)}</span>
              {!f.owned && (
                <span className="num flex items-center gap-1 text-[11px] text-gold">
                  <Lock className="size-3" aria-hidden />
                  {f.priceGems}
                  <Gem className="size-3" aria-hidden />
                </span>
              )}
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}
