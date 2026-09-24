"use client";
import { type Currency, RACE_CLASSES, type UserDto } from "@thoroughline/contracts";
import { TRACKS } from "@thoroughline/engine";
import { Search } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionTitle,
  Skeleton,
  useToast,
} from "@/components/ui";
import { ApiRequestError, post } from "@/lib/api";
import { CLASS_NAMES, fmt, titleCase } from "@/lib/format";
import { invalidate, useApi } from "@/lib/hooks";

/**
 * Operator console. The API enforces every permission; the role lists here only decide which
 * tabs are shown.
 */
type Tab = "economy" | "users" | "fraud" | "payments" | "races" | "audit" | "config";
const TAB_ROLES: Record<Tab, string[]> = {
  economy: ["ECONOMY_ADMIN", "FINANCE_ADMIN"],
  users: ["SUPPORT_ADMIN", "FINANCE_ADMIN", "ECONOMY_ADMIN", "FRAUD_ANALYST"],
  fraud: ["FRAUD_ANALYST"],
  payments: ["FINANCE_ADMIN"],
  races: ["GAME_ADMIN", "TOURNAMENT_ADMIN"],
  audit: ["SUPPORT_ADMIN", "FINANCE_ADMIN", "ECONOMY_ADMIN", "FRAUD_ANALYST"],
  config: ["ECONOMY_ADMIN", "GAME_ADMIN"],
};
const can = (role: string, tab: Tab) => role === "SUPER_ADMIN" || TAB_ROLES[tab].includes(role);

export default function AdminPage() {
  const me = useApi<UserDto>("/me");
  const [tab, setTab] = useState<Tab | null>(null);
  if (me.error) return <ErrorState error={me.error} retry={me.reload} />;
  if (!me.data) return <Skeleton className="h-40" />;
  const role = me.data.role;
  const tabs = (["economy", "users", "fraud", "payments", "races", "audit", "config"] as Tab[]).filter((t) =>
    can(role, t),
  );
  if (tabs.length === 0)
    return <EmptyState title="No console access" body="This area is for the operations team." />;
  const active = tab && tabs.includes(tab) ? tab : tabs[0]!;
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Admin console</h1>
      <p className="text-sm text-muted">Signed in as {titleCase(role)} · every action is audited</p>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={active === t}
            onClick={() => setTab(t)}
            className={`min-h-10 shrink-0 cursor-pointer rounded-full border px-4 text-sm font-medium capitalize ${active === t ? "border-gold bg-gold text-bg" : "border-line/60 text-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {active === "economy" && <Economy />}
      {active === "users" && <Users role={role} />}
      {active === "fraud" && <Fraud />}
      {active === "payments" && <Payments />}
      {active === "races" && <Races />}
      {active === "audit" && <Audit />}
      {active === "config" && <Config canEdit={role === "SUPER_ADMIN" || role === "ECONOMY_ADMIN"} />}
    </div>
  );
}

/* ───────────────────────────── economy ───────────────────────────── */

interface EconomyDto {
  byReason: { code: string; currency: string; net: number }[];
  supply: { currency: string; circulating: number; holders: number; p50: number; p90: number }[];
  daily: { day: string; currency: string; minted: number; burned: number }[];
}

function Economy() {
  const { data, error, reload } = useApi<EconomyDto>("/admin/economy", { refreshMs: 60_000 });
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="mt-3 h-64" />;
  const credits = data.byReason.filter((r) => r.currency === "CREDITS" && r.net !== 0);
  const sources = credits.filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const sinks = credits.filter((r) => r.net < 0).sort((a, b) => a.net - b.net);
  const max = Math.max(1, ...credits.map((r) => Math.abs(r.net)));
  const days = data.daily.filter((d) => d.currency === "CREDITS");
  const dayMax = Math.max(1, ...days.flatMap((d) => [Number(d.minted), Number(d.burned)]));
  return (
    <>
      <SectionTitle>Supply</SectionTitle>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted">
            <tr>
              {["Currency", "Circulating", "Holders", "P50", "P90"].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {data.supply.map((s) => (
              <tr key={s.currency} className="border-t border-line/40">
                <td className="px-2 py-2 font-sans">{titleCase(s.currency)}</td>
                <td className="px-2 py-2">{fmt(Number(s.circulating))}</td>
                <td className="px-2 py-2">{fmt(s.holders)}</td>
                <td className="px-2 py-2">{fmt(Number(s.p50))}</td>
                <td className="px-2 py-2">{fmt(Number(s.p90))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <SectionTitle>Credits by reason (all time)</SectionTitle>
      <Card className="space-y-3">
        {[
          ["Minted (sources)", sources, "bg-good"],
          ["Burned (sinks)", sinks, "bg-bad"],
        ].map(([label, list, color]) => (
          <div key={label as string}>
            <p className="text-xs uppercase tracking-wider text-muted">{label as string}</p>
            {(list as typeof credits).map((r) => (
              <div key={r.code} className="mt-1.5">
                <div className="flex justify-between text-xs">
                  <span>{titleCase(r.code)}</span>
                  <span className="num">{fmt(Math.abs(r.net))}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-surface-2">
                  <div
                    className={`h-1.5 rounded-full ${color as string}`}
                    style={{ width: `${(Math.abs(r.net) / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
      </Card>
      <SectionTitle>Credits per day (14 days)</SectionTitle>
      <Card className="space-y-2">
        {days.length === 0 && <p className="text-sm text-muted">No activity yet.</p>}
        {days.map((d) => (
          <div key={d.day} className="grid grid-cols-[5.5rem_1fr] items-center gap-2 text-xs">
            <span className="num text-muted">{d.day.slice(5)}</span>
            <div className="space-y-0.5">
              <div
                className="h-1.5 rounded-full bg-good"
                style={{ width: `${(Number(d.minted) / dayMax) * 100}%` }}
                title={`minted ${fmt(Number(d.minted))}`}
              />
              <div
                className="h-1.5 rounded-full bg-bad"
                style={{ width: `${(Number(d.burned) / dayMax) * 100}%` }}
                title={`burned ${fmt(Number(d.burned))}`}
              />
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">
          <span className="text-good">■</span> minted · <span className="text-bad">■</span> burned
        </p>
      </Card>
    </>
  );
}

/* ───────────────────────────── users ───────────────────────────── */

interface UserRow {
  id: string;
  telegram_id: number | null;
  username: string | null;
  first_name: string | null;
  role: string;
  status: string;
  stable_name: string | null;
}

interface UserDetail {
  user: UserRow & { trust_score: number; created_at: string; last_seen_at: string | null };
  balances: Record<Currency, number>;
  ledger: {
    id: number;
    type: string;
    amount: number;
    currency: string;
    reason: string | null;
    created_at: string;
  }[];
  payments: {
    id: string;
    product_id: string;
    amount: number;
    currency: string;
    status: string;
    created_at: string;
  }[];
}

function Users({ role }: { role: string }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const results = useApi<UserRow[]>(query ? `/admin/users?q=${encodeURIComponent(query)}` : null);
  return (
    <>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) {
            setQuery(q.trim());
            setSelected(null);
          }
        }}
      >
        <label htmlFor="user-q" className="sr-only">
          Search users
        </label>
        <input
          id="user-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Username, Telegram id, stable or user id"
          className="min-h-11 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-ink"
        />
        <Button type="submit" aria-label="Search">
          <Search className="size-4" aria-hidden />
        </Button>
      </form>
      {results.error && <ErrorState error={results.error} retry={results.reload} />}
      {results.data && results.data.length === 0 && (
        <p className="mt-3 text-sm text-muted">No users match “{query}”.</p>
      )}
      {!!results.data?.length && !selected && (
        <Card className="mt-3 divide-y divide-line/40 p-0">
          {results.data.map((u) => (
            <button
              key={u.id}
              onClick={() => setSelected(u.id)}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.username ?? u.first_name ?? u.id}</p>
                <p className="num truncate text-xs text-muted">
                  tg {u.telegram_id ?? "—"} · {u.stable_name ?? "no stable"}
                </p>
              </div>
              <Badge tone={u.status === "ACTIVE" ? "good" : "bad"}>{titleCase(u.status)}</Badge>
            </button>
          ))}
        </Card>
      )}
      {selected && <UserPanel id={selected} role={role} onBack={() => setSelected(null)} />}
    </>
  );
}

function UserPanel({ id, role, onBack }: { id: string; role: string; onBack: () => void }) {
  const { data, error, reload } = useApi<UserDetail>(`/admin/users/${id}`);
  const isSuper = role === "SUPER_ADMIN";
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="mt-3 h-64" />;
  const u = data.user;
  return (
    <>
      <Button variant="ghost" className="mt-3 px-0 text-sm" onClick={onBack}>
        ← Results
      </Button>
      <Card>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-bold">{u.username ?? u.first_name ?? "User"}</p>
            <p className="num break-all text-xs text-muted">{u.id}</p>
            <p className="num text-xs text-muted">
              tg {u.telegram_id ?? "—"} · trust {u.trust_score} · joined{" "}
              {new Date(u.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge tone={u.status === "ACTIVE" ? "good" : "bad"}>{titleCase(u.status)}</Badge>
            <Badge>{titleCase(u.role)}</Badge>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
          {(Object.entries(data.balances) as [Currency, number][]).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-bg/40 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted">{k.slice(0, 4)}</dt>
              <dd className="num text-sm font-semibold">{fmt(v)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {(isSuper || role === "ECONOMY_ADMIN") && <Adjust id={id} onDone={reload} />}
      {(isSuper || role === "SUPPORT_ADMIN" || role === "FRAUD_ANALYST") && (
        <StatusAction
          id={id}
          status={u.status}
          canReinstate={isSuper || role === "SUPPORT_ADMIN"}
          onDone={reload}
        />
      )}
      <SectionTitle>Recent ledger</SectionTitle>
      <Card className="divide-y divide-line/40 p-0 text-sm">
        {data.ledger.length === 0 && <p className="p-4 text-muted">No transactions.</p>}
        {data.ledger.map((l) => (
          <div key={`${l.id}-${l.currency}`} className="flex items-center justify-between gap-2 px-4 py-2">
            <div className="min-w-0">
              <p className="truncate">{l.reason ?? titleCase(l.type)}</p>
              <p className="num text-xs text-muted">{new Date(l.created_at).toLocaleString()}</p>
            </div>
            <span className={`num shrink-0 ${l.amount >= 0 ? "text-good" : "text-bad"}`}>
              {l.amount >= 0 ? "+" : ""}
              {fmt(l.amount)} {l.currency.slice(0, 3)}
            </span>
          </div>
        ))}
      </Card>
      {data.payments.length > 0 && (
        <>
          <SectionTitle>Payments</SectionTitle>
          <Card className="divide-y divide-line/40 p-0 text-sm">
            {data.payments.map((p) => (
              <div key={p.id} className="flex justify-between px-4 py-2">
                <span>{p.product_id}</span>
                <span className="num">
                  {p.amount} {p.currency} · {titleCase(p.status)}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

function Adjust({ id, onDone }: { id: string; onDone: () => void }) {
  const [currency, setCurrency] = useState<"CREDITS" | "GEMS" | "REPUTATION">("CREDITS");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const n = Number(amount);
  const valid = Number.isInteger(n) && n !== 0 && reason.trim().length >= 5;
  return (
    <>
      <SectionTitle>Adjust balance</SectionTitle>
      <Card className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            Currency
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as typeof currency)}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
            >
              <option value="CREDITS">Credits</option>
              <option value="GEMS">Gems</option>
              <option value="REPUTATION">Reputation</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            Amount (negative to remove)
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
            />
          </label>
        </div>
        <label className="block text-xs text-muted">
          Reason (required, audited)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
          />
        </label>
        <Button
          className="w-full"
          disabled={!valid}
          loading={busy}
          onClick={async () => {
            if (
              !window.confirm(`${n > 0 ? "Credit" : "Debit"} ${fmt(Math.abs(n))} ${currency.toLowerCase()}?`)
            )
              return;
            setBusy(true);
            try {
              await post(`/admin/users/${id}/adjust`, { currency, amount: n, reason });
              toast("Balance adjusted");
              setAmount("");
              setReason("");
              onDone();
            } catch (e) {
              toast((e as Error).message, "bad");
            } finally {
              setBusy(false);
            }
          }}
        >
          Apply adjustment
        </Button>
      </Card>
    </>
  );
}

function StatusAction({
  id,
  status,
  canReinstate,
  onDone,
}: {
  id: string;
  status: string;
  canReinstate: boolean;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const suspend = status === "ACTIVE";
  if (!suspend && !canReinstate) return null;
  return (
    <>
      <SectionTitle>{suspend ? "Suspend account" : "Reinstate account"}</SectionTitle>
      <Card className="space-y-2">
        <label className="block text-xs text-muted">
          Reason (required, audited)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
          />
        </label>
        <Button
          variant={suspend ? "danger" : "secondary"}
          className="w-full"
          disabled={reason.trim().length < 5}
          loading={busy}
          onClick={async () => {
            if (suspend && !window.confirm("Suspend this account? The user is signed out immediately."))
              return;
            setBusy(true);
            try {
              await post(`/admin/users/${id}/${suspend ? "suspend" : "reinstate"}`, { reason });
              toast(suspend ? "Account suspended" : "Account reinstated");
              setReason("");
              onDone();
            } catch (e) {
              toast((e as Error).message, "bad");
            } finally {
              setBusy(false);
            }
          }}
        >
          {suspend ? "Suspend" : "Reinstate"}
        </Button>
      </Card>
    </>
  );
}

/* ───────────────────────────── audit ───────────────────────────── */

interface AuditRow {
  id: number;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
}

function Audit() {
  const { data, error, reload } = useApi<AuditRow[]>("/admin/audit?limit=100", { refreshMs: 30_000 });
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="mt-3 h-64" />;
  if (data.length === 0)
    return (
      <div className="mt-3">
        <EmptyState title="Nothing audited yet" body="Admin actions will appear here." />
      </div>
    );
  return (
    <Card className="mt-3 divide-y divide-line/40 p-0 text-sm">
      {data.map((a) => (
        <div key={a.id} className="px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{titleCase(a.action)}</span>
            <span className="num text-xs text-muted">{new Date(a.created_at).toLocaleString()}</span>
          </div>
          <p className="num truncate text-xs text-muted">
            {a.actor_name ?? "system"} → {a.target_type} {a.target_id ?? ""}
          </p>
          {a.reason && <p className="text-xs">“{a.reason}”</p>}
        </div>
      ))}
    </Card>
  );
}

/* ───────────────────────────── config ───────────────────────────── */

interface ConfigDto {
  version: number;
  override: Record<string, unknown>;
  history: { version: number; note: string | null; created_at: string; author: string | null }[];
}

function Config({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useApi<ConfigDto>("/admin/config");
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Skeleton className="mt-3 h-64" />;
  const text = draft ?? JSON.stringify(data.override, null, 2);

  const publish = async () => {
    let override: unknown;
    try {
      override = JSON.parse(text);
    } catch (e) {
      setProblems([`Not valid JSON: ${(e as Error).message}`]);
      return;
    }
    if (!window.confirm("Publish this override to the live game?")) return;
    setBusy(true);
    try {
      const r = await post<{ version: number }>("/admin/config", { override, note });
      toast(`Config v${r.version} is live`);
      setProblems([]);
      setDraft(null);
      setNote("");
      invalidate("/admin/config");
    } catch (e) {
      const d = e instanceof ApiRequestError ? e.details : undefined;
      setProblems(Array.isArray(d) ? d.map(String) : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Live override · v{data.version}</SectionTitle>
      <Card className="space-y-2">
        <p className="text-xs text-muted">
          Only the settings that differ from the built-in defaults. Each publish replaces the whole override,
          is validated against the defaults and is written to the audit log. Publish {"{}"} to return to the
          defaults.
        </p>
        <label htmlFor="cfg" className="sr-only">
          Override JSON
        </label>
        <textarea
          id="cfg"
          value={text}
          readOnly={!canEdit}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          rows={12}
          className="num w-full rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink"
        />
        {problems.length > 0 && (
          <ul role="alert" className="space-y-0.5 text-xs text-bad">
            {problems.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        )}
        {canEdit && (
          <>
            <label className="block text-xs text-muted">
              Change note (required)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
              />
            </label>
            <Button className="w-full" disabled={note.trim().length < 5} loading={busy} onClick={publish}>
              Publish
            </Button>
          </>
        )}
      </Card>
      <SectionTitle>History</SectionTitle>
      <Card className="divide-y divide-line/40 p-0 text-sm">
        {data.history.length === 0 && <p className="p-4 text-muted">Running on defaults.</p>}
        {data.history.map((h) => (
          <div key={h.version} className="px-4 py-2.5">
            <div className="flex justify-between">
              <span className="font-medium">v{h.version}</span>
              <span className="num text-xs text-muted">{new Date(h.created_at).toLocaleString()}</span>
            </div>
            <p className="text-xs text-muted">
              {h.author ?? "—"}: {h.note ?? ""}
            </p>
          </div>
        ))}
      </Card>
    </>
  );
}

/* ───────────────────────────── payments ───────────────────────────── */

interface PaymentRow {
  id: string;
  user_name: string | null;
  product_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

function Payments() {
  const [status, setStatus] = useState<"COMPLETED" | "REFUNDED" | "FAILED" | "ALL">("COMPLETED");
  const path = `/admin/payments?limit=100${status === "ALL" ? "" : `&status=${status}`}`;
  const { data, error, reload } = useApi<PaymentRow[]>(path);
  return (
    <>
      <div className="mt-3 flex gap-2">
        {(["COMPLETED", "REFUNDED", "FAILED", "ALL"] as const).map((s) => (
          <button
            key={s}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs ${status === s ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {titleCase(s)}
          </button>
        ))}
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      {!data && !error && <Skeleton className="mt-3 h-40" />}
      {data?.length === 0 && <p className="mt-3 text-sm text-muted">No payments.</p>}
      <div className="mt-3 space-y-2">
        {data?.map((p) => (
          <Card key={p.id} className="text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.product_id}</p>
                <p className="num truncate text-xs text-muted">
                  {p.user_name ?? "—"} · {new Date(p.created_at).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="num font-semibold">
                  {p.amount} {p.currency}
                </p>
                <Badge
                  tone={p.status === "COMPLETED" ? "good" : p.status === "REFUNDED" ? "warn" : "neutral"}
                >
                  {titleCase(p.status)}
                </Badge>
              </div>
            </div>
            {p.status === "COMPLETED" && <Refund id={p.id} onDone={reload} />}
          </Card>
        ))}
      </div>
    </>
  );
}

function Refund({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!open)
    return (
      <Button variant="ghost" className="mt-2 min-h-9 px-0 text-xs" onClick={() => setOpen(true)}>
        Refund…
      </Button>
    );
  return (
    <div className="mt-2 space-y-2">
      <label className="block text-xs text-muted">
        Refund reason (required, audited)
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
        />
      </label>
      <p className="text-xs text-muted">
        Stars go back to the buyer through Telegram and the granted gems are removed. If the buyer has already
        spent the gems, the refund is refused.
      </p>
      <Button
        variant="danger"
        className="w-full"
        disabled={reason.trim().length < 5}
        loading={busy}
        onClick={async () => {
          if (!window.confirm("Refund this payment through Telegram?")) return;
          setBusy(true);
          try {
            await post(`/admin/payments/${id}/refund`, { reason });
            toast("Payment refunded");
            onDone();
          } catch (e) {
            toast((e as Error).message, "bad");
          } finally {
            setBusy(false);
          }
        }}
      >
        Refund payment
      </Button>
    </div>
  );
}

/* ───────────────────────────── races ───────────────────────────── */

interface AdminRaceRow {
  id: string;
  name: string;
  class: string;
  distance: number;
  status: string;
  entry_fee: number;
  purse: number;
  starts_at: string;
  is_special: boolean;
  stage: string | null;
  players: number;
}

function Races() {
  const [scope, setScope] = useState<"upcoming" | "live" | "recent">("upcoming");
  const { data, error, reload } = useApi<AdminRaceRow[]>(`/admin/races?scope=${scope}`, {
    refreshMs: 20_000,
  });
  return (
    <>
      <CreateRace onDone={reload} />
      <SectionTitle>Races</SectionTitle>
      <div className="flex gap-2">
        {(["upcoming", "live", "recent"] as const).map((s) => (
          <button
            key={s}
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
            className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs capitalize ${scope === s ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      {!data && !error && <Skeleton className="mt-3 h-40" />}
      <div className="mt-3 space-y-2">
        {data?.map((r) => (
          <div key={r.id} data-race-id={r.id}>
            <Card className="text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <a href={`/race/?id=${r.id}`} className="block truncate font-medium hover:text-gold">
                    {r.name}
                  </a>
                  <p className="num text-xs text-muted">
                    {CLASS_NAMES[r.class]} · {r.distance}m · {new Date(r.starts_at).toLocaleString()}
                  </p>
                  <p className="num text-xs text-muted">
                    {r.players} players · purse {fmt(r.purse)} · fee {fmt(r.entry_fee)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge>{titleCase(r.status)}</Badge>
                  {r.is_special && <Badge tone="gold">{r.stage ? titleCase(r.stage) : "Special"}</Badge>}
                </div>
              </div>
              {(r.status === "OPEN" || r.status === "LOCKED") && <CancelRace id={r.id} onDone={reload} />}
            </Card>
          </div>
        ))}
      </div>
    </>
  );
}

function CancelRace({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!open)
    return (
      <Button variant="ghost" className="mt-2 min-h-9 px-0 text-xs" onClick={() => setOpen(true)}>
        Cancel race…
      </Button>
    );
  return (
    <div className="mt-2 space-y-2">
      <label className="block text-xs text-muted">
        Cancellation reason (required, audited)
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
        />
      </label>
      <Button
        variant="danger"
        className="w-full"
        disabled={reason.trim().length < 5}
        loading={busy}
        onClick={async () => {
          if (!window.confirm("Cancel this race? Entry fees are refunded and horses released.")) return;
          setBusy(true);
          try {
            await post(`/admin/races/${id}/cancel`, { reason });
            toast("Race cancelled");
            onDone();
          } catch (e) {
            toast((e as Error).message, "bad");
          } finally {
            setBusy(false);
          }
        }}
      >
        Cancel race
      </Button>
    </div>
  );
}

function CreateRace({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [cls, setCls] = useState<string>("MAIDEN");
  const [trackCode, setTrackCode] = useState(TRACKS[0]!.code);
  const track = TRACKS.find((t) => t.code === trackCode)!;
  const [distance, setDistance] = useState<number>(track.distances[0]!);
  const [startsAt, setStartsAt] = useState("");
  const [purse, setPurse] = useState("");
  const [entryFee, setEntryFee] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const input = "mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink";
  const valid = name.trim().length >= 3 && startsAt !== "" && track.distances.includes(distance);
  return (
    <>
      <SectionTitle>Create a special race</SectionTitle>
      <Card className="space-y-2 text-xs text-muted">
        <label className="block">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            Class
            <select value={cls} onChange={(e) => setCls(e.target.value)} className={input}>
              {RACE_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {CLASS_NAMES[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Track
            <select
              value={trackCode}
              onChange={(e) => {
                const t = TRACKS.find((x) => x.code === e.target.value)!;
                setTrackCode(t.code);
                setDistance(t.distances[0]!);
              }}
              className={input}
            >
              {TRACKS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Distance
            <select value={distance} onChange={(e) => setDistance(Number(e.target.value))} className={input}>
              {track.distances.map((d) => (
                <option key={d} value={d}>
                  {d} m
                </option>
              ))}
            </select>
          </label>
          <label>
            Starts (local time)
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={input}
            />
          </label>
          <label>
            Purse (default by class)
            <input
              inputMode="numeric"
              value={purse}
              onChange={(e) => setPurse(e.target.value)}
              className={`num ${input}`}
            />
          </label>
          <label>
            Entry fee (default by class)
            <input
              inputMode="numeric"
              value={entryFee}
              onChange={(e) => setEntryFee(e.target.value)}
              className={`num ${input}`}
            />
          </label>
        </div>
        <Button
          className="w-full"
          disabled={!valid}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post("/admin/races", {
                name: name.trim(),
                class: cls,
                trackCode,
                distance,
                startsAt: new Date(startsAt).toISOString(),
                ...(purse ? { purse: Number(purse) } : {}),
                ...(entryFee ? { entryFee: Number(entryFee) } : {}),
              });
              toast("Special race scheduled");
              setName("");
              onDone();
            } catch (e) {
              toast((e as Error).message, "bad");
            } finally {
              setBusy(false);
            }
          }}
        >
          Schedule race
        </Button>
      </Card>
    </>
  );
}

/* ───────────────────────────── fraud ───────────────────────────── */

interface FlagRow {
  id: number;
  user_id: string;
  user_name: string | null;
  user_status: string;
  trust_score: number;
  kind: string;
  severity: 1 | 2 | 3;
  details: Record<string, unknown>;
  status: string;
  created_at: string;
  review_note: string | null;
  reviewer: string | null;
}

const FLAG_INFO: Record<string, string> = {
  SHARED_IP: "Several accounts signed in from one address this week",
  CIRCULAR_TRADE: "A horse was sold to another account and back within two weeks",
  TRADE_FUNNEL: "Three or more sales to the same buyer in a week",
  REFERRAL_CLUSTER: "Invitees sign in from the referrer's address",
  INCOME_SPIKE: "Yesterday's income above 10× the 90th percentile",
};

function Fraud() {
  const [status, setStatus] = useState<"OPEN" | "CONFIRMED" | "DISMISSED">("OPEN");
  const { data, error, reload } = useApi<FlagRow[]>(`/admin/fraud/flags?status=${status}`, {
    refreshMs: 60_000,
  });
  return (
    <>
      <p className="mt-3 text-xs text-muted">
        Signals never act on their own: review each flag, then suspend from the Users tab if needed. Open and
        confirmed flags lower the account&apos;s trust score, which gates referral rewards.
      </p>
      <div className="mt-2 flex gap-2">
        {(["OPEN", "CONFIRMED", "DISMISSED"] as const).map((s) => (
          <button
            key={s}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs ${status === s ? "border-gold bg-gold/15 text-gold" : "border-line/60 text-muted"}`}
          >
            {titleCase(s)}
          </button>
        ))}
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      {!data && !error && <Skeleton className="mt-3 h-40" />}
      {data?.length === 0 && <p className="mt-3 text-sm text-muted">No {status.toLowerCase()} flags.</p>}
      <div className="mt-3 space-y-2">
        {data?.map((f) => (
          <Card key={f.id} className="text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{titleCase(f.kind)}</p>
                <p className="text-xs text-muted">{FLAG_INFO[f.kind] ?? ""}</p>
              </div>
              <Badge tone={f.severity === 3 ? "bad" : f.severity === 2 ? "warn" : "neutral"}>
                {["", "Low", "Medium", "High"][f.severity]}
              </Badge>
            </div>
            <p className="num mt-2 text-xs text-muted">
              {f.user_name ?? "—"} · trust {f.trust_score} · {titleCase(f.user_status)} ·{" "}
              {new Date(f.created_at).toLocaleString()}
            </p>
            <p className="num break-all text-xs text-muted">user {f.user_id}</p>
            <pre className="num mt-1 max-h-24 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] text-muted">
              {JSON.stringify(f.details, null, 1)}
            </pre>
            {f.review_note && (
              <p className="mt-1 text-xs">
                {f.reviewer ?? "—"}: “{f.review_note}”
              </p>
            )}
            {f.status === "OPEN" && <ReviewFlag id={f.id} onDone={reload} />}
          </Card>
        ))}
      </div>
    </>
  );
}

function ReviewFlag({ id, onDone }: { id: number; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const decide = async (decision: "DISMISSED" | "CONFIRMED") => {
    setBusy(decision);
    try {
      await post(`/admin/fraud/flags/${id}/review`, { decision, note });
      toast(decision === "CONFIRMED" ? "Flag confirmed" : "Flag dismissed");
      onDone();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const ok = note.trim().length >= 5;
  return (
    <div className="mt-2 space-y-2">
      <label className="block text-xs text-muted">
        Review note (required, audited)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          disabled={!ok}
          loading={busy === "DISMISSED"}
          onClick={() => decide("DISMISSED")}
        >
          Dismiss
        </Button>
        <Button
          variant="danger"
          disabled={!ok}
          loading={busy === "CONFIRMED"}
          onClick={() => decide("CONFIRMED")}
        >
          Confirm
        </Button>
      </div>
    </div>
  );
}
