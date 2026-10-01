import { api } from "../api/client";
import { Banner, Card, Empty, Pill, Screen, Spinner } from "../components/ui";
import { dateTime } from "../format";
import { useAsync } from "../state/useAsync";
import { RequireVehicle } from "./RequireVehicle";

const EVENT_TONE = { APPEARED: "bad", RESOLVED: "ok", STATUS_CHANGED: "warn", CLEARED: "info" } as const;

export function History() {
  return <RequireVehicle>{(id) => <HistoryInner id={id} />}</RequireVehicle>;
}

function HistoryInner({ id }: { id: string }) {
  const sessions = useAsync(() => api.sessions(id), [id]);
  const events = useAsync(() => api.dtcEvents(id), [id]);
  return (
    <Screen title="Vehicle history" subtitle="Scans and how fault codes changed over time">
      <Card title="Scans">
        {sessions.error ? <Banner onRetry={sessions.reload}>{sessions.error}</Banner> : null}
        {sessions.loading && !sessions.data ? <Spinner /> : null}
        {sessions.data?.length === 0 ? <Empty>No scans yet.</Empty> : null}
        <ul className="list compact">
          {sessions.data?.map((s) => (
            <li key={s.id} className="row">
              <span className="list-main">
                <strong>{dateTime(s.started_at)}</strong>
                <span className="muted small">
                  {s.ecu_count} ECUs · {s.dtc_count} DTCs · {s.duration_ms ?? "—"} ms
                </span>
              </span>
              <Pill tone={s.status === "completed" ? "ok" : "bad"}>{s.status}</Pill>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="DTC timeline">
        {events.error ? <Banner onRetry={events.reload}>{events.error}</Banner> : null}
        {events.data?.length === 0 ? <Empty>No changes recorded yet.</Empty> : null}
        <ul className="timeline">
          {events.data?.map((e) => (
            <li key={e.id}>
              <Pill tone={EVENT_TONE[e.event]}>{e.event.replace("_", " ").toLowerCase()}</Pill>{" "}
              <strong className="mono">{e.display === "*" ? "all DTCs" : e.display}</strong> <span className="muted">on {e.ecu_key}</span>
              <div className="muted small">{dateTime(e.occurred_at)}</div>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  );
}
