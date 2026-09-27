"use client";
import { SILK_COLORS, type SilkColor } from "@thoroughline/contracts";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { titleCase } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Compact colour choice: a row showing the current colour; the palette opens on demand and closes
 * once a colour is picked. `blocked` colours are shown but cannot be chosen (e.g. the other slot's
 * colour); `lockedLabel` adds a reason to a colour's accessible name (e.g. members only).
 */
export function ColorPicker({
  label,
  value,
  colors,
  onChange,
  blocked,
  lockedLabel,
}: {
  label: string;
  value: SilkColor;
  colors: readonly SilkColor[];
  onChange: (c: SilkColor) => void;
  blocked?: (c: SilkColor) => boolean;
  lockedLabel?: (c: SilkColor) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${titleCase(value)}`}
        className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-line/60 bg-surface px-3 text-left transition-colors hover:border-gold/50"
      >
        <span
          className="size-7 shrink-0 rounded-full border-2 border-line/60"
          style={{ background: SILK_COLORS[value] }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted">{label}</span>
          <span className="block text-sm font-medium">{titleCase(value)}</span>
        </span>
        <span className="text-xs text-gold">{t("color.choose")}</span>
        <ChevronDown
          className={`size-4 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div id={id} className="mt-2 grid grid-cols-6 gap-2" role="radiogroup" aria-label={label}>
          {colors.map((c) => {
            const locked = lockedLabel?.(c) ?? null;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={value === c}
                aria-label={locked ? `${titleCase(c)} · ${locked}` : titleCase(c)}
                disabled={!!locked || !!blocked?.(c)}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className={`aspect-square min-h-11 cursor-pointer rounded-full border-2 transition-transform disabled:cursor-not-allowed disabled:opacity-30 ${value === c ? "scale-110 border-gold" : "border-line/60"}`}
                style={{ background: SILK_COLORS[c] }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
