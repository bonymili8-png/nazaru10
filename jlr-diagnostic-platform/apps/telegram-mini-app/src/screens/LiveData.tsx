import { useEffect, useMemo, useRef, useState } from "react";

import { api, describeError } from "../api/client";
import type { LiveParameterDefinition, LiveParameterValue } from "../api/types";
import { Gauge, Sparkline } from "../components/charts";
import { Banner, Card, Empty, Evidence, Pill, Screen, Spinner } from "../components/ui";
import { downloadText, liveRecordingCsv, number } from "../format";
import { useAsync } from "../state/useAsync";
import { RequireVehicle } from "./RequireVehicle";

const HISTORY = 60;
const MAX_SELECTED = 12;
const MAX_RECORDING = 20_000;
type View = "cards" | "table" | "gauges";

export function LiveData() {
  return <RequireVehicle>{(id) => <LiveDataInner id={id} />}</RequireVehicle>;
}

function LiveDataInner({ id }: { id: string }) {
  const parameters = useAsync(() => api.liveParameters(id), [id]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [values, setValues] = useState<Record<string, LiveParameterValue>>({});
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [view, setView] = useState<View>("cards");
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const samples = useRef<LiveParameterValue[]>([]);
  const [sampleCount, setSampleCount] = useState(0);

  const definitions = useMemo(() => {
    const map = new Map<string, LiveParameterDefinition>();
    for (const p of parameters.data?.parameters ?? []) map.set(p.id, p);
    return map;
  }, [parameters.data]);

  // Until the user picks parameters, show the first eight discovered ones.
  const selected = useMemo(
    () => chosen ?? (parameters.data?.parameters.slice(0, 8).map((p) => p.id) ?? []),
    [chosen, parameters.data],
  );

  useEffect(() => {
    if (!streaming || selected.length === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const snapshot = await api.readLive(id, selected);
        if (cancelled) return;
        setError(null);
        setValues((prev) => ({ ...prev, ...Object.fromEntries(snapshot.values.map((v) => [v.id, v])) }));
        setHistory((prev) => {
          const next = { ...prev };
          for (const v of snapshot.values) {
            if (v.value !== null) next[v.id] = [...(prev[v.id] ?? []), v.value].slice(-HISTORY);
          }
          return next;
        });
        if (recording && samples.current.length < MAX_RECORDING) {
          samples.current.push(...snapshot.values);
          setSampleCount(samples.current.length);
        }
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      }
      if (!cancelled) timer = window.setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [streaming, recording, selected, id]);

  function toggle(paramId: string) {
    const s = selected;
    setChosen(s.includes(paramId) ? s.filter((x) => x !== paramId) : s.length >= MAX_SELECTED ? s : [...s, paramId]);
  }

  function toggleRecording() {
    if (!recording) {
      samples.current = [];
      setSampleCount(0);
    }
    setRecording(!recording);
    if (!streaming) setStreaming(true);
  }

  const rows = selected.map((pid) => ({ def: definitions.get(pid), value: values[pid], trend: history[pid] ?? [] }));

  return (
    <Screen
      title="Live data"
      subtitle={`${definitions.size} parameters available · ${selected.length} selected`}
      actions={
        <button type="button" className={`btn ${streaming ? "btn-danger" : "btn-primary"}`} onClick={() => setStreaming(!streaming)} disabled={!selected.length}>
          {streaming ? "Stop" : "Start"}
        </button>
      }
    >
      {parameters.error ? <Banner onRetry={parameters.reload}>{parameters.error}</Banner> : null}
      {error ? <Banner tone="warn">{error}</Banner> : null}
      {parameters.loading && !parameters.data ? <Spinner label="Discovering parameters…" /> : null}
      {parameters.data && definitions.size === 0 ? (
        <Empty>No live parameters were discovered. Only standard OBD-II PIDs and verified definitions are offered.</Empty>
      ) : null}

      {definitions.size ? (
        <div className="toolbar">
          <div className="chips" role="tablist" aria-label="View">
            {(["cards", "table", "gauges"] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={`chip ${view === v ? "chip-active" : ""}`} onClick={() => setView(v)}>
                {v[0]?.toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-small" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            Parameters
          </button>
        </div>
      ) : null}

      {picking ? (
        <Card title={`Select up to ${MAX_SELECTED}`}>
          <ul className="list compact">
            {[...definitions.values()].map((p) => (
              <li key={p.id} className="row">
                <label className="picker">
                  <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                  <span className="list-main">
                    <span>{p.name}</span>
                    <span className="muted small mono">
                      {p.ecu_id} · {p.access === "OBD_MODE_01" ? `PID ${p.identifier.toString(16).toUpperCase().padStart(2, "0")}` : `DID ${p.identifier.toString(16).toUpperCase()}`}
                    </span>
                  </span>
                  <Evidence source={p.source} />
                </label>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {definitions.size ? (
        <Card
          title={recording ? `Recording · ${sampleCount} samples` : "Recording"}
          aside={recording ? <Pill tone="bad">● REC</Pill> : null}
        >
          <div className="actions-grid">
            <button type="button" className="btn" onClick={toggleRecording}>
              {recording ? "Stop recording" : "Record"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!sampleCount || recording}
              onClick={() => downloadText(`live-${id}-${new Date().toISOString()}.csv`, liveRecordingCsv(samples.current))}
            >
              Export CSV
            </button>
          </div>
        </Card>
      ) : null}

      {view === "table" ? (
        <Card>
          <table className="table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th className="num">Value</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ def, value }) =>
                def ? (
                  <tr key={def.id}>
                    <td>
                      {def.name}
                      <div className="muted small">{def.ecu_id}</div>
                    </td>
                    <td className="num mono">{value ? (value.status === "OK" ? number(value.value) : value.status) : "—"}</td>
                    <td>{def.unit}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className={view === "gauges" ? "grid-gauges" : "grid-cards"}>
          {rows.map(({ def, value, trend }) =>
            def ? (
              <div key={def.id} className="metric">
                <div className="metric-name" title={def.name}>
                  {def.name}
                </div>
                {view === "gauges" ? (
                  <Gauge value={value?.value ?? null} min={def.min_value ?? 0} max={def.max_value ?? 100} unit={def.unit} label={def.name} />
                ) : (
                  <>
                    <div className="metric-value">
                      {value ? (value.status === "OK" ? number(value.value) : <Pill tone="warn">{value.status}</Pill>) : "—"} <span className="metric-unit">{def.unit}</span>
                    </div>
                    <Sparkline values={trend} label={def.name} />
                  </>
                )}
                <div className="muted small">{def.ecu_id}</div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </Screen>
  );
}
