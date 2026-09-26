import type { SponsorGoalDto } from "@thoroughline/contracts";
import { titleCase } from "@/lib/format";
import { t } from "@/lib/i18n";

/** "Place top 3 in 2 races · on turf · 1,200 m or shorter". */
export function sponsorGoalText(g: SponsorGoalDto): string {
  const parts = [t(`sponsor.goal.${g.result}`, { n: g.count })];
  if (g.surface) parts.push(t("sponsor.on", { surface: titleCase(g.surface).toLowerCase() }));
  if (g.maxDistance) parts.push(t("sponsor.maxDistance", { m: g.maxDistance }));
  if (g.minDistance) parts.push(t("sponsor.minDistance", { m: g.minDistance }));
  if (g.minWetness) parts.push(t("sponsor.wet"));
  return parts.join(" · ");
}
