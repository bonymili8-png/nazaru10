import { useState } from "react";

import { api } from "../api/client";
import type { EcuRecord } from "../api/types";
import { Banner, CapabilityBadge, Card, Empty, Evidence, KeyValue, Pill, Screen, Spinner } from "../components/ui";
import { dateTime, hex } from "../format";
import { useSession } from "../state/session";
import { useAsync } from "../state/useAsync";
import { RequireVehicle } from "./RequireVehicle";

export function Ecus() {
  return <RequireVehicle>{(id) => <EcusInner id={id} />}</RequireVehicle>;
}

function EcusInner({ id }: { id: string }) {
  const ecus = useAsync(() => api.ecus(id), [id]);
  return (
    <Screen title="ECUs" subtitle="Modules that answered on the bus during the last scans">
      {ecus.error ? <Banner onRetry={ecus.reload}>{ecus.error}</Banner> : null}
      {ecus.loading && !ecus.data ? <Spinner /> : null}
      {ecus.data?.length === 0 ? <Empty>No ECUs known yet. Run a full scan.</Empty> : null}
      {ecus.data?.map((record) => <EcuCard key={record.ecu.id} record={record} />)}
    </Screen>
  );
}

function EcuCard({ record }: { record: EcuRecord }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const { ecu } = record;
  const pro = Boolean(user?.professional_mode);
  const c = ecu.capabilities;
  return (
    <Card
      title={
        <button type="button" className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {ecu.name}
        </button>
      }
      aside={pro ? <span className="mono small">{ecu.id}</span> : <Evidence source={ecu.name_source} />}
    >
      <KeyValue
        rows={[
          ["Software", ecu.software_version],
          ["Hardware", ecu.hardware_version],
          ["Part number", ecu.part_number],
          ...(pro
            ? ([
                ["Request / response", `${hex(ecu.request_address)} / ${hex(ecu.response_address)}`],
                ["Protocol", ecu.protocol],
              ] as [string, string][])
            : []),
        ]}
      />
      <div className="capabilities">
        <CapabilityBadge label="Read DTC" capability={c.read_dtc} />
        <CapabilityBadge label="Clear DTC" capability={c.clear_dtc} />
        <CapabilityBadge label="Live data" capability={c.live_data} />
        <CapabilityBadge label="Freeze frames" capability={c.freeze_frames} />
        {open ? (
          <>
            <CapabilityBadge label="DTC severity" capability={c.dtc_severity} />
            <CapabilityBadge label="OBD-II" capability={c.obd} />
            <CapabilityBadge label="Security access" capability={c.security_access} />
            <CapabilityBadge label="Coding" capability={c.coding} />
            <CapabilityBadge label="Adaptation" capability={c.adaptation} />
            <CapabilityBadge label="Flashing" capability={c.flashing} />
          </>
        ) : null}
      </div>
      {open ? (
        <>
          <h3>Identification</h3>
          <table className="table small">
            <thead>
              <tr>
                {pro ? <th>DID</th> : null}
                <th>Item</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {ecu.identification.map((v) => (
                <tr key={v.did}>
                  {pro ? <td className="mono">{hex(v.did, 4)}</td> : null}
                  <td>{v.name}</td>
                  <td>
                    {v.status === "READ" ? (
                      <span className={v.text ? "" : "mono"}>{v.text ?? v.raw_hex}</span>
                    ) : (
                      <Pill tone={v.status === "OEM_AUTH_REQUIRED" ? "bad" : "muted"}>{v.status.replace(/_/g, " ").toLowerCase()}</Pill>
                    )}
                    {pro && v.status === "READ" && v.text ? <div className="mono muted">{v.raw_hex}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {record.software_history.length > 1 ? (
            <>
              <h3>Version history</h3>
              <ul className="plain small">
                {record.software_history.map((h) => (
                  <li key={h.recorded_at}>
                    {dateTime(h.recorded_at)} — SW {h.software_version ?? "?"}, HW {h.hardware_version ?? "?"}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="muted small">Capabilities are detected from ECU responses. Write capabilities are never probed — they stay Unknown until verified.</p>
        </>
      ) : null}
    </Card>
  );
}
