"use client";

/** The console's on/off switch (green when on). The API decides who may flip it. */
export function Toggle({
  on,
  label,
  busy = false,
  onFlip,
}: {
  on: boolean;
  label: string;
  busy?: boolean;
  onFlip: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onFlip}
      className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full p-0 transition-colors disabled:opacity-60 ${on ? "bg-good" : "bg-surface-2 ring-1 ring-line"}`}
    >
      <span
        className={`absolute left-0 top-1 size-6 rounded-full bg-ink transition-transform ${on ? "translate-x-7" : "translate-x-1"}`}
      />
    </button>
  );
}

/** Recent switch changes, newest first. */
export function SwitchHistory({
  history,
}: {
  history: { enabled: boolean; at: string; by: string | null; note: string | null }[];
}) {
  if (!history.length) return null;
  return (
    <div className="mt-3 space-y-1 border-t border-line/40 pt-2 text-xs">
      <p className="uppercase tracking-wider text-muted">Switch history</p>
      {history.map((h) => (
        <p key={h.at}>
          <span className={h.enabled ? "text-good" : "text-bad"}>{h.enabled ? "ON" : "OFF"}</span>{" "}
          <span className="num text-muted">{new Date(h.at).toLocaleString()}</span>
          {h.by && ` · ${h.by}`}
          {h.note && ` · ${h.note}`}
        </p>
      ))}
    </div>
  );
}
