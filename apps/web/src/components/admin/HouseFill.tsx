"use client";
import type { AdminSwitchDto } from "@thoroughline/contracts";
import { useState } from "react";
import { Badge, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";
import { SwitchHistory, Toggle } from "./Toggle";

const field =
  "mt-1 min-h-11 w-full rounded-xl border border-line/60 bg-surface-2 px-3 text-base text-ink placeholder:text-muted focus:border-gold focus:outline-none";

/**
 * Tournaments: run cups with a single entrant and fill every heat and the final with house
 * horses (races tab). Each cup keeps the rule it was drawn under.
 */
export function HouseFill() {
  const { data, error, reload } = useApi<AdminSwitchDto>("/admin/tournament-house-fill");
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="mt-3 h-32" />;

  const flip = async () => {
    const next = !data.enabled;
    const ask = next
      ? "Fill tournaments with house horses? Cups drawn from now on run with a single entrant, and their finals get a full field."
      : "Run tournaments with entrants only? Cups drawn from now on need two entrants, and their finals are the finalists alone.";
    if (!window.confirm(ask)) return;
    setBusy(true);
    try {
      await post("/admin/tournament-house-fill", { enabled: next, note: note.trim() || undefined });
      toast(next ? "House fill switched on" : "House fill switched off");
      setNote("");
      invalidate("/admin/tournament-house-fill", "/admin/audit", "/tournaments");
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Tournaments: house horses</SectionTitle>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">
              Fill with house horses{" "}
              <Badge tone={data.enabled ? "good" : "bad"}>{data.enabled ? "ON" : "OFF"}</Badge>
            </p>
            <p className="text-xs text-muted">
              {data.enabled
                ? "A cup runs even with one entrant; heats and the final are made up to a full field. The final's winner is champion, house horse or not."
                : "A cup needs two entrants or it is called off and refunded; the final is the finalists alone."}{" "}
              Applies from the next draw.
            </p>
          </div>
          <Toggle
            on={data.enabled}
            label="Fill tournaments with house horses"
            busy={busy}
            onFlip={() => void flip()}
          />
        </div>
        <label className="mt-3 block text-sm">
          Reason for the change (optional, kept in the audit log)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. Few players this week"
            className={field}
          />
        </label>
        <SwitchHistory history={data.history} />
      </Card>
    </>
  );
}
