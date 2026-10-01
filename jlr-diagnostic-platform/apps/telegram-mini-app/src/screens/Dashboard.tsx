import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, describeError } from "../api/client";
import type { VehicleDetail } from "../api/types";
import { Banner, Card, Empty, Pill, Screen, SimulationNotice, Spinner, Stat } from "../components/ui";
import { timeAgo, voltage, voltageTone } from "../format";
import { useSession } from "../state/session";
import { useAsync } from "../state/useAsync";
import { haptic } from "../telegram";

export function Dashboard() {
  const { activeVehicleId, setActiveVehicleId, can } = useSession();
  const navigate = useNavigate();
  const gateway = useAsync(() => api.gatewayStatus(), []);
  const detail = useAsync<VehicleDetail | null>(
    () => (activeVehicleId ? api.vehicle(activeVehicleId) : Promise.resolve(null)),
    [activeVehicleId],
  );
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const result = await api.connect();
      setActiveVehicleId(result.vehicle.id);
      haptic("success");
      gateway.reload();
      detail.reload();
    } catch (e) {
      haptic("error");
      setConnectError(describeError(e));
    } finally {
      setConnecting(false);
    }
  }

  const iface = gateway.data?.interface ?? null;
  const vehicle = detail.data;
  const connected = Boolean(iface?.connected);

  return (
    <Screen title="Dashboard" subtitle="JLR Diagnostic Platform">
      {gateway.data?.simulation ? <SimulationNotice /> : null}
      {gateway.error ? <Banner onRetry={gateway.reload}>{gateway.error}</Banner> : null}
      {connectError ? <Banner>{connectError}</Banner> : null}

      <Card
        title="Connection"
        aside={
          gateway.loading && !gateway.data ? null : (
            <Pill tone={!gateway.data?.reachable ? "bad" : connected ? "ok" : "warn"}>
              {!gateway.data?.reachable ? "Gateway offline" : connected ? "Connected" : "Not connected"}
            </Pill>
          )
        }
      >
        <div className="stats">
          <Stat label="Battery" value={voltage(iface?.vehicle_voltage)} tone={voltageTone(iface?.vehicle_voltage)} />
          <Stat label="Ignition" value={iface?.ignition ?? "—"} tone={iface?.ignition === "ON" ? "ok" : "muted"} />
          <Stat label="Interface" value={iface ? iface.kind.toUpperCase() : "—"} />
        </div>
        {can("vehicle:connect") ? (
          <button type="button" className="btn btn-primary btn-block" onClick={connect} disabled={connecting || !gateway.data?.reachable}>
            {connecting ? "Connecting… reading VIN" : connected ? "Reconnect & identify" : "Connect to vehicle"}
          </button>
        ) : (
          <p className="muted small">Your role can view vehicles but not connect to them.</p>
        )}
      </Card>

      {detail.loading && !vehicle ? <Spinner /> : null}
      {vehicle ? (
        <Card
          title={vehicle.vehicle.display_name}
          aside={<Pill tone={vehicle.connected ? "ok" : "muted"}>{vehicle.connected ? "On gateway" : "Offline"}</Pill>}
        >
          <p className="vin" aria-label="VIN">
            {vehicle.vehicle.vin}
          </p>
          <div className="stats">
            <Stat label="DTCs" value={vehicle.dtc_count} tone={vehicle.active_dtc_count ? "bad" : vehicle.dtc_count ? "warn" : "ok"} to="/dtcs" />
            <Stat label="Active" value={vehicle.active_dtc_count} tone={vehicle.active_dtc_count ? "bad" : "ok"} to="/dtcs?state=active" />
            <Stat label="ECUs" value={vehicle.ecu_count} to="/ecus" />
          </div>
          <p className="muted small">Last scan: {timeAgo(vehicle.vehicle.last_scan_at)}</p>
          <div className="actions-grid">
            <button type="button" className="btn btn-primary" onClick={() => navigate("/scan")} disabled={!vehicle.connected || !can("diagnostic:scan")}>
              Full scan
            </button>
            <button type="button" className="btn" onClick={() => navigate("/live")} disabled={!vehicle.connected || !can("live_data:read")}>
              Live data
            </button>
            <Link className="btn" to="/vehicle">
              Details
            </Link>
            <Link className="btn" to="/history">
              History
            </Link>
          </div>
        </Card>
      ) : !detail.loading ? (
        <Card>
          <Empty>No vehicle selected. Connect to read the VIN and register the vehicle, or pick one from Vehicles.</Empty>
        </Card>
      ) : null}
      {detail.error ? <Banner onRetry={detail.reload}>{detail.error}</Banner> : null}
    </Screen>
  );
}
