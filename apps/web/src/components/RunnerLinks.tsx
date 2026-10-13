"use client";
import type { RaceEntryDto } from "@thoroughline/contracts";
import Link from "next/link";
import { t } from "@/lib/i18n";

/** Real horses have uuid ids; showdown runners don't and have no page to open. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The runner's name, linking to its horse page. */
export function HorseLink({ e, className = "" }: { e: RaceEntryDto; className?: string }) {
  if (!UUID.test(e.horseId)) return <span className={className}>{e.horseName}</span>;
  return (
    <Link
      href={`/horse/?id=${e.horseId}`}
      className={`${className} underline-offset-2 hover:text-gold hover:underline`}
    >
      {e.horseName}
    </Link>
  );
}

/** The runner's owner, linking to their stable ("House" for house runners). */
export function OwnerLink({ e }: { e: RaceEntryDto }) {
  if (e.isHouse) return <>{t("common.house")}</>;
  if (!e.ownerId) return <>{e.ownerName}</>;
  return (
    <Link
      href={`/owner/?id=${e.ownerId}`}
      className="text-ink/80 underline underline-offset-2 hover:text-gold"
    >
      {e.ownerName ?? t("common.owner")}
    </Link>
  );
}
