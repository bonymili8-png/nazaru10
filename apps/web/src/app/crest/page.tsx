"use client";
import Link from "next/link";
import {
  type CosmeticsDto,
  type Crest as CrestSpec,
  CREST_SHAPES,
  type CrestIcon,
  SILK_COLORS,
  type SilkColor,
} from "@thoroughline/contracts";
import { Gem, Lock } from "lucide-react";
import { useState } from "react";
import { ColorPicker } from "@/components/ColorPicker";
import { Crest } from "@/components/Crest";
import { Button, Card, ErrorState, LinkButton, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post, put } from "@/lib/api";
import { errorMessage, titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { memberLocked } from "@/lib/member";
import { haptic } from "@/lib/telegram";

const COLORS = Object.keys(SILK_COLORS) as SilkColor[];

export default function CrestPage() {
  const { data, error, reload } = useApi<CosmeticsDto>("/cosmetics");
  const [draft, setDraft] = useState<CrestSpec | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  const crest = draft ?? data.crest;
  const changed = JSON.stringify(crest) !== JSON.stringify(data.crest);

  const unlock = async (icon: CrestIcon, price: number) => {
    if (!window.confirm(t("crest.confirmUnlock", { name: titleCase(icon), n: price }))) return;
    setBusy(icon);
    try {
      await post(`/cosmetics/crest/icons/${icon}/unlock`);
      haptic.success();
      toast(t("silks.unlocked", { name: titleCase(icon) }));
      setDraft({ ...crest, icon });
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
      await put("/cosmetics/crest", crest);
      haptic.success();
      toast(t("crest.saved"));
      setDraft(null);
      invalidate("/cosmetics", "/stable", "/home", "/leaderboard", "/seasons");
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  const option = (selected: boolean) =>
    `flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border p-2 transition-colors disabled:cursor-not-allowed ${selected ? "border-gold bg-gold/10" : "border-line/60 bg-surface"}`;

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("crest.title")}</h1>
      <Card className="mt-3 flex flex-col items-center gap-3 bg-gradient-to-br from-surface to-surface-2 py-6">
        <Crest crest={crest} size={96} title={t("crest.preview")} />
        <p className="text-center text-sm text-muted">{t("crest.intro")}</p>
      </Card>

      <SectionTitle>{t("crest.shape")}</SectionTitle>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t("crest.shape")}>
        {CREST_SHAPES.map((shape) => (
          <button
            key={shape}
            role="radio"
            aria-checked={crest.shape === shape}
            aria-label={titleCase(shape)}
            onClick={() => setDraft({ ...crest, shape })}
            className={`${option(crest.shape === shape)} min-h-20`}
          >
            <Crest crest={{ ...crest, shape }} size={36} />
          </button>
        ))}
      </div>

      <SectionTitle>{t("crest.emblem")}</SectionTitle>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t("crest.emblem")}>
        {data.crestIcons.map((i) => (
          <button
            key={i.icon}
            role="radio"
            aria-checked={crest.icon === i.icon}
            onClick={() =>
              i.owned ? setDraft({ ...crest, icon: i.icon }) : void unlock(i.icon, i.priceGems)
            }
            disabled={busy !== null}
            className={`${option(crest.icon === i.icon)} min-h-24`}
          >
            <Crest crest={{ ...crest, icon: i.icon }} size={34} />
            <span className="text-[11px] font-medium">{titleCase(i.icon)}</span>
            {!i.owned && (
              <span className="num flex items-center gap-1 text-[11px] text-gold">
                <Lock className="size-3" aria-hidden />
                {i.priceGems}
                <Gem className="size-3" aria-hidden />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-2 text-right text-xs text-muted">
        {t("common.youHaveGems", { n: data.gems })} ·{" "}
        <Link href="/shop/" className="text-gold hover:underline">
          {t("common.getMore")}
        </Link>
      </p>

      <SectionTitle>{t("silks.colours")}</SectionTitle>
      {(["field", "charge"] as const).map((slot) => (
        <ColorPicker
          key={slot}
          label={slot === "field" ? t("crest.fieldColour") : t("crest.emblemColour")}
          value={crest[slot]}
          colors={COLORS}
          onChange={(c) => setDraft({ ...crest, [slot]: c })}
          blocked={(c) => c === (slot === "field" ? crest.charge : crest.field)}
          lockedLabel={(c) => (memberLocked(c, data.member) ? t("circle.memberColour") : null)}
        />
      ))}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <LinkButton href="/profile/">{t("common.back")}</LinkButton>
        <Button onClick={save} disabled={!changed} loading={busy === "save"}>
          {t("crest.save")}
        </Button>
      </div>
    </div>
  );
}
