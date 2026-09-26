"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { errorMessage } from "@/lib/format";
import { t } from "@/lib/i18n";

export function Card({
  children,
  className = "",
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
}) {
  const Tag = as;
  return (
    <Tag className={`rounded-[var(--radius-card)] border border-line/60 bg-surface p-4 ${className}`}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between">
      <h2 className="font-display text-xl font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void | Promise<void>;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
  "aria-label"?: string;
};

const VARIANTS = {
  primary: "bg-gold text-bg hover:bg-gold/90 font-semibold",
  secondary: "border border-gold/50 text-gold hover:bg-gold/10 font-medium",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "border border-bad/60 text-bad hover:bg-bad/10 font-medium",
};

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  loading,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      aria-label={rest["aria-label"]}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-[15px] transition-[transform,background-color,opacity] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof VARIANTS;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] transition-transform duration-150 active:scale-[0.97] ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "gold" | "good" | "warn" | "bad";
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    gold: "bg-gold/15 text-gold",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Labelled horizontal meter; value 0–100 (optional ceiling marker for revealed potential). */
export function Meter({
  label,
  value,
  max = 100,
  ceiling,
  tone = "gold",
  suffix,
}: {
  label: string;
  value: number;
  max?: number;
  ceiling?: number;
  tone?: "gold" | "good" | "warn" | "bad";
  suffix?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = { gold: "bg-gold", good: "bg-good", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <div className="py-1">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="num font-medium text-ink">
          {value.toFixed(1)}
          {suffix}
        </span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={`h-full rounded-full ${bar} transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
        {ceiling !== undefined && (
          <div
            className="absolute top-0 h-full w-0.5 bg-ink/70"
            style={{ left: `${Math.min(100, (ceiling / max) * 100)}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card className="text-center">
      <p className="font-display text-lg">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </Card>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <Card className="border-bad/40">
      <p className="text-sm text-bad" role="alert">
        {errorMessage(error)}
      </p>
      {retry && (
        <Button variant="ghost" onClick={retry} className="mt-2">
          {t("common.tryAgain")}
        </Button>
      )}
    </Card>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="text-gold" aria-label={`${n}/5`}>
      {"★".repeat(n)}
      <span className="text-line">{"★".repeat(5 - n)}</span>
    </span>
  );
}

/* ─────────────── toasts ─────────────── */

type Toast = { id: number; text: string; tone: "good" | "bad" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "good") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`max-w-sm rounded-xl border px-4 py-2.5 text-sm shadow-lg backdrop-blur ${t.tone === "good" ? "border-good/40 bg-surface/95 text-ink" : "border-bad/50 bg-surface/95 text-bad"}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
