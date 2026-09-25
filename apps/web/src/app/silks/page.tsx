"use client";
import {
  type CosmeticsDto,
  SILK_COLORS,
  type SilkColor,
  type SilkPattern,
  type Silks,
} from "@thoroughline/contracts";
import { Gem, Lock } from "lucide-react";
import { useState } from "react";
import { Silk } from "@/components/Silk";
import { Button, Card, ErrorState, LinkButton, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post, put } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
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
    if (!window.confirm(`Unlock ${titleCase(pattern)} silks for ${price} gems?`)) return;
    setBusy(pattern);
    try {
      await post(`/cosmetics/silks/patterns/${pattern}/unlock`);
      haptic.success();
      toast(`${titleCase(pattern)} unlocked`);
      setDraft({ ...silks, pattern });
      invalidate("/cosmetics", "/wallet");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await put("/cosmetics/silks", silks);
      haptic.success();
      toast("Silks saved — they'll show on your next race cards");
      setDraft(null);
      invalidate("/cosmetics");
    } catch (e) {
      haptic.error();
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Racing silks</h1>
      <Card className="mt-3 flex flex-col items-center gap-3 bg-gradient-to-br from-surface to-surface-2 py-6">
        <Silk silks={silks} size={120} title="Your silks preview" />
        <p className="text-sm text-muted">
          Your colours on race cards and in the live viewer. Purely cosmetic — silks never affect results.
        </p>
      </Card>

      <SectionTitle>Pattern</SectionTitle>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Pattern">
        {data.patterns.map((p) => {
          const isOwned = owned.has(p.pattern);
          const selected = silks.pattern === p.pattern;
          return (
            <button
              key={p.pattern}
              role="radio"
              aria-checked={selected}
              onClick={() =>
                isOwned ? setDraft({ ...silks, pattern: p.pattern }) : void unlock(p.pattern, p.priceGems)
              }
              disabled={busy !== null}
              className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border p-2 transition-colors ${selected ? "border-gold bg-gold/10" : "border-line/60 bg-surface"}`}
            >
              <Silk silks={{ ...silks, pattern: p.pattern }} size={40} title={titleCase(p.pattern)} />
              <span className="text-xs font-medium">{titleCase(p.pattern)}</span>
              {!isOwned && (
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
        You have <span className="num text-ink">{data.gems}</span> gems ·{" "}
        <a href="/shop/" className="text-gold hover:underline">
          get more
        </a>
      </p>

      {(["primary", "secondary"] as const).map((slot) => (
        <div key={slot}>
          <SectionTitle>{slot === "primary" ? "Body colour" : "Pattern colour"}</SectionTitle>
          <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label={`${slot} colour`}>
            {COLORS.map((c) => {
              const other = slot === "primary" ? silks.secondary : silks.primary;
              return (
                <button
                  key={c}
                  role="radio"
                  aria-checked={silks[slot] === c}
                  aria-label={titleCase(c)}
                  disabled={c === other}
                  onClick={() => setDraft({ ...silks, [slot]: c })}
                  className={`aspect-square min-h-11 cursor-pointer rounded-full border-2 transition-transform disabled:cursor-not-allowed disabled:opacity-30 ${silks[slot] === c ? "scale-110 border-gold" : "border-line/60"}`}
                  style={{ background: SILK_COLORS[c] }}
                />
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <LinkButton href="/profile/">Back</LinkButton>
        <Button onClick={save} disabled={!changed} loading={busy === "save"}>
          Save silks
        </Button>
      </div>
    </div>
  );
}
