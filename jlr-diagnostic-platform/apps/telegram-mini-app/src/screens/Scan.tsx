import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api, describeError } from "../api/client";
import type { ScanResult } from "../api/types";
import { Banner, Card, Pill, Screen, SimulationNotice, Stat } from "../components/ui";
import { SEVERITY_LABEL, dtcState, severityTone } from "../format";
import { useSession } from "../state/session";
import { haptic } from "../telegram";
import { RequireVehicle } from "./RequireVehicle";

export function Scan() {
  return <RequireVehicle>{(id) => <ScanInner id={id} />}</RequireVehicle>;
}

function ScanInner({ id }: { id: string }) {
  const { user, can } = useSession();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 100) / 10), 100);
    return () => window.clearInterval(timer);
  }, [running]);

  async function run() {
    setRunning(true);
    setError(null);
    setElapsed(0);
    try {
      setResult(await api.scan(id));
      haptic("success");
    } catch (e) {
      haptic("error");
      setError(describeError(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Screen
      title="Full scan"
      subtitle="Discovers ECUs, reads identification, DTCs and capabilities"
      actions={
        <button type="button" className="btn btn-primary" onClick={run} disabled={running || !can("diagnostic:scan")}>
          {running ? `Scanning… ${elapsed.toFixed(1)} s` : result ? "Scan again" : "Start scan"}
        </button>
      }
    >
      {error ? <Banner>{error}</Banner> : null}
      {running ? (
        <Card>
          <div className="progress" role="progressbar" aria-label="Scan in progress">
            <span className="progress-bar" />
          </div>
          <p className="muted small">Probing addresses with bounded concurrency so the vehicle bus is never flooded.</p>
        </Card>
      ) : null}
      {result ? (
        <>
          {result.interface.simulation ? <SimulationNotice /> : null}
          <Card title="Result" aside={<span className="muted small">{result.duration_ms} ms</span>}>
            <div className="stats">
              <Stat label="ECUs" value={result.ecus.length} to="/ecus" />
              <Stat label="DTCs" value={result.dtcs.length} tone={result.dtcs.some((d) => d.status.test_failed) ? "bad" : result.dtcs.length ? "warn" : "ok"} to="/dtcs" />
              <Stat label="Probed" value={result.probed_addresses} />
            </div>
            {result.comparison.appeared.length || result.comparison.resolved.length ? (
              <p className="small">
                Since last scan: <strong>{result.comparison.appeared.length}</strong> new, <strong>{result.comparison.resolved.length}</strong> resolved.
              </p>
            ) : null}
            {!result.vehicle.identity.consistent ? <Banner tone="warn">ECUs report different VINs — see warnings.</Banner> : null}
          </Card>
          {result.warnings.length ? (
            <Card title={`Warnings (${result.warnings.length})`}>
              <ul className="plain small">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card title="Fault codes" aside={<Link to="/dtcs">All DTCs →</Link>}>
            {result.dtcs.length === 0 ? <p className="tone-ok">No DTCs stored.</p> : null}
            <ul className="list compact">
              {result.dtcs.map((d) => {
                const state = dtcState(d);
                return (
                  <li key={`${d.ecu_id}-${d.raw}`} className="row">
                    <span className="list-main">
                      <strong className="mono">{d.display}</strong>
                      <span className="small">{d.description ?? "No verified description"}</span>
                      <span className="muted small">{d.ecu_name}</span>
                    </span>
                    <span className="list-side">
                      <Pill tone={state.tone}>{state.label}</Pill>
                      <Pill tone={severityTone(d.severity)}>{SEVERITY_LABEL[d.severity]}</Pill>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
          {user?.professional_mode && result.trace ? (
            <Card title={`Raw trace (${result.trace.length})`} aside={<Pill tone="info">PRO</Pill>}>
              <pre className="trace">
                {result.trace
                  .slice(0, 400)
                  .map((t) => `${t.elapsed_ms.toFixed(1).padStart(7)}ms ${t.ecu} ${t.direction} ${t.hex}`)
                  .join("\n")}
              </pre>
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
