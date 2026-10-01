import { useNavigate } from "react-router-dom";

import { api } from "../api/client";
import type { ProfileFact } from "../api/types";
import { Banner, Card, Empty, Evidence, KeyValue, Pill, Screen, Spinner } from "../components/ui";
import { dateTime, timeAgo, voltage } from "../format";
import { useSession } from "../state/session";
import { useAsync } from "../state/useAsync";
import { RequireVehicle } from "./RequireVehicle";

export function Vehicles() {
  const { activeVehicleId, setActiveVehicleId } = useSession();
  const navigate = useNavigate();
  const vehicles = useAsync(() => api.vehicles(), []);
  return (
    <Screen title="Vehicles" subtitle="Vehicles registered from a VIN read on the bus">
      {vehicles.error ? <Banner onRetry={vehicles.reload}>{vehicles.error}</Banner> : null}
      {vehicles.loading && !vehicles.data ? <Spinner /> : null}
      {vehicles.data?.length === 0 ? <Empty>No vehicles yet. Connect to a vehicle from the Dashboard.</Empty> : null}
      <ul className="list">
        {vehicles.data?.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              className={`list-item ${v.id === activeVehicleId ? "list-item-active" : ""}`}
              onClick={() => {
                setActiveVehicleId(v.id);
                navigate("/vehicle");
              }}
            >
              <span className="list-main">
                <strong>{v.display_name}</strong>
                <span className="mono small">{v.vin}</span>
              </span>
              <span className="list-side">
                {v.simulation ? <Pill tone="info">SIM</Pill> : null}
                <span className="muted small">{timeAgo(v.last_scan_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

const FACTS: [string, string][] = [
  ["make", "Make"],
  ["model", "Model"],
  ["model_year", "Model year"],
  ["engine", "Engine"],
  ["transmission", "Transmission"],
  ["market", "Market"],
];

function fact(profile: Record<string, unknown>, key: string): ProfileFact | null {
  const value = profile[key];
  return value && typeof value === "object" ? (value as ProfileFact) : null;
}

export function VehicleDetails() {
  return <RequireVehicle>{(id) => <VehicleDetailsInner id={id} />}</RequireVehicle>;
}

function VehicleDetailsInner({ id }: { id: string }) {
  const detail = useAsync(() => api.vehicle(id), [id]);
  const d = detail.data;
  return (
    <Screen title={d?.vehicle.display_name ?? "Vehicle"} subtitle={d ? <span className="mono">{d.vehicle.vin}</span> : null}>
      {detail.error ? <Banner onRetry={detail.reload}>{detail.error}</Banner> : null}
      {!d ? <Spinner /> : null}
      {d ? (
        <>
          <Card title="Vehicle profile" aside={<span className="muted small">{d.vehicle.profile_schema_version}</span>}>
            <dl className="kv">
              {FACTS.map(([key, label]) => {
                const f = fact(d.vehicle.profile, key);
                return (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {f?.value ?? <span className="muted">Unknown</span>} {f ? <Evidence source={f.source} /> : <Evidence source="NONE" />}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="muted small">
              Only facts with evidence are shown. Model, engine and market stay unknown until a verified source provides them.
            </p>
          </Card>
          <Card title="Connection">
            <KeyValue
              rows={[
                ["Gateway", d.connected ? "Connected to this vehicle" : d.gateway_vin ? `Connected to ${d.gateway_vin}` : "Not connected"],
                ["Interface", d.interface ? `${d.interface.kind.toUpperCase()} — ${d.interface.description}` : "—"],
                ["Battery", voltage(d.interface?.vehicle_voltage)],
                ["Last connected", dateTime(d.vehicle.last_connected_at)],
              ]}
            />
          </Card>
          <Card title="Last scan">
            {d.last_session ? (
              <KeyValue
                rows={[
                  ["When", dateTime(d.last_session.started_at)],
                  ["Duration", `${d.last_session.duration_ms ?? 0} ms`],
                  ["ECUs", d.last_session.ecu_count],
                  ["DTCs", `${d.dtc_count} (${d.active_dtc_count} active)`],
                ]}
              />
            ) : (
              <Empty>No scan yet.</Empty>
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
