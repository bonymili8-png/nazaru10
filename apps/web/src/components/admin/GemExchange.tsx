"use client";
import type { AdminGemExchangeDto } from "@thoroughline/contracts";
import { useState } from "react";
import { Badge, Card, ErrorState, SectionTitle, Skeleton, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { errorMessage, fmt } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";

const PERIOD_LABEL = { DAY: "24 hours", WEEK: "7 days", ALL: "All time" } as const;

const field =
  "mt-1 min-h-11 w-full rounded-xl border border-line/60 bg-surface-2 px-3 text-base text-ink placeholder:text-muted focus:border-gold focus:outline-none";

/**
 * The gems → credits exchange on the economy tab: the on/off switch (economy admins), the
 * bundles on offer and what the exchange has moved. Rates and the daily cap live in config.
 */
export function GemExchange({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useApi<AdminGemExchangeDto>("/admin/gem-exchange", {
    refreshMs: 60_000,
  });
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="mt-3 h-40" />;

  const flip = async () => {
    const next = !data.enabled;
    const ask = next
      ? "Switch the gems → credits exchange ON? Owners can buy credits with gems straight away."
      : "Switch the gems → credits exchange OFF? The shop hides it and the server refuses new exchanges.";
    if (!window.confirm(ask)) return;
    setBusy(true);
    try {
      await post("/admin/gem-exchange", { enabled: next, note: note.trim() || undefined });
      toast(next ? "Exchange switched on" : "Exchange switched off");
      setNote("");
      invalidate("/admin/gem-exchange", "/admin/config", "/admin/audit", "/wallet/exchange");
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Gems → credits exchange</SectionTitle>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">
              Status <Badge tone={data.enabled ? "good" : "bad"}>{data.enabled ? "ON" : "OFF"}</Badge>
            </p>
            <p className="text-xs text-muted">
              Daily cap {fmt(data.dailyCreditLimit)} cr per owner · bundles and cap are in config
            </p>
          </div>
          {canEdit && (
            <button
              role="switch"
              aria-checked={data.enabled}
              aria-label="Gems to credits exchange"
              disabled={busy}
              onClick={() => void flip()}
              className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-60 ${data.enabled ? "bg-good" : "bg-surface-2 ring-1 ring-line"}`}
            >
              <span
                className={`absolute top-1 size-6 rounded-full bg-ink transition-transform ${data.enabled ? "translate-x-7" : "translate-x-1"}`}
              />
            </button>
          )}
        </div>
        {canEdit && (
          <label className="mt-3 block text-sm">
            Reason for the change (optional, kept in the audit log)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. Weekend promotion"
              className={field}
            />
          </label>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {data.bundles.map((b) => (
            <span key={b.gems} className="num rounded-lg bg-surface-2 px-2.5 py-1 text-xs">
              {fmt(b.gems)} gems → {fmt(b.credits)} cr{b.bonusPct > 0 ? ` (+${b.bonusPct}%)` : ""}
            </span>
          ))}
        </div>
      </Card>
      <Card className="mt-2 overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted">
            <tr>
              {["Period", "Exchanges", "Owners", "Gems in", "Credits out"].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {data.stats.map((s) => (
              <tr key={s.period} className="border-t border-line/40">
                <td className="px-2 py-2 font-sans">{PERIOD_LABEL[s.period]}</td>
                <td className="px-2 py-2">{fmt(s.exchanges)}</td>
                <td className="px-2 py-2">{fmt(s.owners)}</td>
                <td className="px-2 py-2">{fmt(s.gems)}</td>
                <td className="px-2 py-2">{fmt(s.credits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {data.history.length > 0 && (
        <Card className="mt-2 space-y-1 text-xs">
          <p className="uppercase tracking-wider text-muted">Switch history</p>
          {data.history.map((h) => (
            <p key={h.at}>
              <span className={h.enabled ? "text-good" : "text-bad"}>{h.enabled ? "ON" : "OFF"}</span>{" "}
              <span className="num text-muted">{new Date(h.at).toLocaleString()}</span>
              {h.by && ` · ${h.by}`}
              {h.note && ` · ${h.note}`}
            </p>
          ))}
        </Card>
      )}
    </>
  );
}
