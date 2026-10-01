import { useEffect, useId, type ReactNode } from "react";
import { Link } from "react-router-dom";

import type { Capability, EvidenceSource } from "../api/types";
import { CAPABILITY_LABEL, SOURCE_LABEL, capabilityTone, type Tone } from "../format";

export function Screen({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="screen">
      <header className="screen-header">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="screen-actions">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}

export function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title || aside ? (
        <div className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Pill({ tone = "muted", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Evidence({ source }: { source: EvidenceSource }) {
  const tone: Tone = source === "SIMULATION" ? "info" : source === "NONE" ? "muted" : "ok";
  return (
    <span className={`evidence evidence-${tone}`} title="Where this information comes from">
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function CapabilityBadge({ label, capability }: { label: string; capability: Capability }) {
  return (
    <div className="capability" title={capability.evidence}>
      <span>{label}</span>
      <Pill tone={capabilityTone(capability.status)}>{CAPABILITY_LABEL[capability.status]}</Pill>
    </div>
  );
}

export function Stat({ label, value, tone, to }: { label: string; value: ReactNode; tone?: Tone; to?: string }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</span>
    </>
  );
  return to ? (
    <Link className="stat stat-link" to={to}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Banner({ tone = "bad", children, onRetry }: { tone?: Tone; children: ReactNode; onRetry?: () => void }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <span>{children}</span>
      {onRetry ? (
        <button type="button" className="btn btn-small btn-ghost" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner-dot" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function SimulationNotice() {
  return (
    <div className="sim-notice" role="note">
      Simulation — data comes from a simulated vehicle profile, not a real car.
    </div>
  );
}

/**
 * Confirmation sheet for operations that change vehicle state. Shows WHAT / CURRENT / NEW / ECU / RISK /
 * BACKUP / VOLTAGE before anything is sent, as required for every critical operation.
 */
export function ConfirmSheet({
  open,
  title,
  rows,
  warnings,
  blocked,
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  rows: [string, ReactNode][];
  warnings: string[];
  blocked: boolean;
  busy: boolean;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        <KeyValue rows={rows} />
        {warnings.length ? (
          <ul className="sheet-warnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={blocked || busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
