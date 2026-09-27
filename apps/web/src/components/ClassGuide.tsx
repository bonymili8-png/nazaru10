import { defaultConfig, RACE_CLASSES } from "@thoroughline/engine";
import { Info } from "lucide-react";
import { bandText, CLASS_NAMES } from "@/lib/format";
import { t } from "@/lib/i18n";

/** Collapsible explainer: strength vs race rating, and the race-rating band of every class. */
export function ClassGuide({ highlight = [] }: { highlight?: readonly string[] }) {
  return (
    <details className="group rounded-2xl border border-line/60 bg-surface p-3 text-sm">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 font-semibold">
        <Info size={16} className="text-gold" aria-hidden />
        {t("guide.title")}
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed text-muted">
        <p>
          <span className="font-semibold text-ink">{t("common.strength")}.</span> {t("guide.strength")}
        </p>
        <p>
          <span className="font-semibold text-ink">{t("horse.mark")}.</span> {t("guide.rating")}
        </p>
        <p>{t("guide.bands")}</p>
      </div>
      <table className="mt-3 w-full text-left">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-muted">
            <th className="py-1 font-medium">{t("guide.class")}</th>
            <th className="py-1 font-medium">{t("guide.band")}</th>
          </tr>
        </thead>
        <tbody>
          {RACE_CLASSES.map((c) => {
            const cc = defaultConfig.race.classes[c];
            const on = highlight.includes(c);
            return (
              <tr key={c} className={`border-t border-line/40 ${on ? "text-gold" : ""}`}>
                <td className="py-1.5 font-semibold">{CLASS_NAMES[c]}</td>
                <td className="num py-1.5">{bandText(cc.minRating, cc.maxRating)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
