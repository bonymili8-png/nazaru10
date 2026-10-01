import { useState, type ReactNode } from "react";

import { api } from "../api/client";
import { Banner, Card, Empty, KeyValue, Pill, Screen, Spinner } from "../components/ui";
import { dateTime } from "../format";
import { useSession } from "../state/session";
import { useAsync } from "../state/useAsync";

const RESULT_TONE = { SUCCESS: "ok", FAILED: "bad", BLOCKED: "warn" } as const;

export function Logs() {
  const [tab, setTab] = useState<"audit" | "operations">("audit");
  const { user } = useSession();
  const audit = useAsync(() => api.audit(), []);
  const operations = useAsync(() => api.operations(), []);
  return (
    <Screen title="Logs" subtitle="Append-only audit of every change, plus every diagnostic operation">
      <div className="chips" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "audit"} className={`chip ${tab === "audit" ? "chip-active" : ""}`} onClick={() => setTab("audit")}>
          Audit log
        </button>
        <button type="button" role="tab" aria-selected={tab === "operations"} className={`chip ${tab === "operations" ? "chip-active" : ""}`} onClick={() => setTab("operations")}>
          Operations
        </button>
      </div>
      {tab === "audit" ? (
        <>
          {audit.error ? <Banner onRetry={audit.reload}>{audit.error}</Banner> : null}
          {audit.loading && !audit.data ? <Spinner /> : null}
          {audit.data?.length === 0 ? <Empty>No changes have been made to any vehicle.</Empty> : null}
          {audit.data?.map((a) => (
            <Card key={a.id} title={`#${a.id} ${a.operation}`} aside={<Pill tone={RESULT_TONE[a.result]}>{a.result}</Pill>}>
              <KeyValue
                rows={[
                  ["When", dateTime(a.timestamp)],
                  ["VIN", <span key="v" className="mono">{a.vin}</span>],
                  ["ECU", a.ecu],
                  ["Before", a.old_value ? JSON.stringify(a.old_value) : "—"],
                  ["After", a.new_value ? JSON.stringify(a.new_value) : "—"],
                  ["Error", a.error?.message ?? "—"],
                  ...(user?.professional_mode
                    ? ([
                        ["ECU software", a.software_version ?? "—"],
                        ["Correlation", <span key="c" className="mono small">{a.correlation_id}</span>],
                      ] as [string, ReactNode][])
                    : []),
                ]}
              />
            </Card>
          ))}
        </>
      ) : (
        <Card>
          {operations.error ? <Banner onRetry={operations.reload}>{operations.error}</Banner> : null}
          {operations.loading && !operations.data ? <Spinner /> : null}
          <ul className="list compact">
            {operations.data?.map((o) => (
              <li key={o.id} className="row">
                <span className="list-main">
                  <strong>{o.operation}</strong>
                  <span className="muted small">
                    {dateTime(o.started_at)} · {o.duration_ms ?? "—"} ms{o.ecu_key ? ` · ${o.ecu_key}` : ""}
                  </span>
                  {o.error ? <span className="small tone-bad">{o.error.code}: {o.error.message}</span> : null}
                  {user?.professional_mode ? <span className="mono muted small">{o.correlation_id}</span> : null}
                </span>
                <Pill tone={o.status === "completed" ? "ok" : o.status === "failed" ? "bad" : "warn"}>{o.status}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Screen>
  );
}
