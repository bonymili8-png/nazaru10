"use client";
import type { AnnouncementDto } from "@thoroughline/contracts";
import { useState } from "react";
import { Badge, Button, Card, SectionTitle, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";

const PATH = "/admin/announcements";

/** "Tell every player in the bot" — the checkbox under the shop-drop and special-race forms. */
export function NotifyAll({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 cursor-pointer accent-[var(--color-gold,#e0b43a)]"
      />
      <span>
        Notify all players in the bot
        <span className="block text-xs text-muted">
          One message a minute later (several created together go out as one), in each player&apos;s language.
        </span>
      </span>
    </label>
  );
}

const TONE = { WAITING: "neutral", SENDING: "gold", SENT: "good", STOPPED: "bad" } as const;

/** Messages to every player: what went out, to how many, and a stop button while sending. */
export function Announcements() {
  const { data } = useApi<AnnouncementDto[]>(PATH, { refreshMs: 10_000 });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data?.length) return null;
  return (
    <>
      <SectionTitle>Player announcements</SectionTitle>
      <Card className="divide-y divide-line/40 py-1 text-sm">
        {data.slice(0, 8).map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="font-medium">
                {a.kind === "SHOP_HORSES" ? "Shop" : "Special race"}: {a.items.join(", ")}{" "}
                <Badge tone={TONE[a.status]}>{a.status.toLowerCase()}</Badge>
              </p>
              <p className="num text-xs text-muted">
                {new Date(a.createdAt).toLocaleString()} · sent {a.sent} of {a.players}
                {a.skipped ? ` · ${a.skipped} turned off` : ""}
                {a.failed ? ` · ${a.failed} not delivered` : ""}
              </p>
            </div>
            {(a.status === "WAITING" || a.status === "SENDING") && (
              <Button
                variant="ghost"
                className="min-h-9 shrink-0 px-2 text-xs text-bad"
                loading={busy === a.id}
                onClick={async () => {
                  if (!window.confirm("Stop this announcement? Players not yet messaged will not get it."))
                    return;
                  setBusy(a.id);
                  try {
                    await post(`${PATH}/${a.id}/cancel`, {});
                    invalidate(PATH);
                  } catch (e) {
                    toast(errorMessage(e), "bad");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Stop
              </Button>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
