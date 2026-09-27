import { Crown } from "lucide-react";
import { t } from "@/lib/i18n";

/** Small crown marking an Owners' Circle member. */
export function MemberBadge() {
  return (
    <Crown className="size-3.5 shrink-0 text-gold" role="img" aria-label={t("circle.member")}>
      <title>{t("circle.member")}</title>
    </Crown>
  );
}
