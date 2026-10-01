import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api, describeError } from "../api/client";
import type { Dtc, SafetyDecision } from "../api/types";
import { Banner, Card, ConfirmSheet, Empty, Evidence, KeyValue, Pill, Screen, Spinner } from "../components/ui";
import { SEVERITY_LABEL, dateTime, downloadText, dtcState, hex, severityTone, voltage } from "../format";
import { useSession } from "../state/session";
import { useAsync } from "../state/useAsync";
import { haptic } from "../telegram";
import { RequireVehicle } from "./RequireVehicle";

const STATES = [
  ["any", "All"],
  ["active", "Active"],
  ["confirmed", "Confirmed"],
  ["pending", "Pending"],
  ["history", "History"],
] as const;

export function Dtcs() {
  return <RequireVehicle>{(id) => <DtcsInner id={id} />}</RequireVehicle>;
}

interface ClearTarget {
  ecuId: string;
  ecuName: string;
  dtcs: Dtc[];
  softwareVersion: string | null;
  safety: SafetyDecision | null;
  safetyError: string | null;
}

function DtcsInner({ id }: { id: string }) {
  const { can, user } = useSession();
  const [params, setParams] = useSearchParams();
  const state = params.get("state") ?? "any";
  const [search, setSearch] = useState("");
  const [grouped, setGrouped] = useState(true);
  const list = useAsync(() => api.dtcs(id, { state, search }), [id, state, search]);
  const [target, setTarget] = useState<ClearTarget | null>(null);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, Dtc[]>();
    for (const d of list.data?.dtcs ?? []) {
      const key = grouped ? `${d.ecu_name}|${d.ecu_id}` : "all|";
      map.set(key, [...(map.get(key) ?? []), d]);
    }
    return [...map.entries()];
  }, [list.data, grouped]);

  async function prepareClear(ecuId: string, ecuName: string, dtcs: Dtc[]) {
    setNotice(null);
    const next: ClearTarget = { ecuId, ecuName, dtcs, softwareVersion: null, safety: null, safetyError: null };
    setTarget(next);
    try {
      const [{ decision }, ecus] = await Promise.all([api.safety(id, "clear_dtc", "LOW_RISK_WRITE"), api.ecus(id)]);
      const ecu = ecus.find((e) => e.ecu.id === ecuId);
      setTarget({ ...next, safety: decision, softwareVersion: ecu?.ecu.software_version ?? null });
    } catch (e) {
      setTarget({ ...next, safetyError: describeError(e) });
    }
  }

  async function confirmClear() {
    if (!target) return;
    setClearing(true);
    try {
      const result = await api.clearDtcs(id, target.ecuId);
      haptic("success");
      const after = result.result.dtcs_after.length;
      setNotice({
        tone: "ok",
        text: `Cleared ${target.ecuName}. ${after ? `${after} DTC(s) detected again immediately — the fault is still present.` : "No DTCs reported after clearing."} Audit #${result.audit_id}.`,
      });
      setTarget(null);
      list.reload();
    } catch (e) {
      haptic("error");
      setNotice({ tone: "bad", text: describeError(e) });
      setTarget(null);
    } finally {
      setClearing(false);
    }
  }

  async function exportCsv() {
    try {
      downloadText(`dtcs-${id}.csv`, await api.exportDtcsCsv(id));
    } catch (e) {
      setNotice({ tone: "bad", text: describeError(e) });
    }
  }

  const safety = target?.safety;
  return (
    <Screen
      title="Fault codes"
      subtitle={list.data?.read_at ? `From the scan of ${dateTime(list.data.read_at)}` : "From the latest scan"}
      actions={
        <button type="button" className="btn btn-small" onClick={exportCsv} disabled={!list.data?.total}>
          Export CSV
        </button>
      }
    >
      <div className="chips" role="tablist" aria-label="DTC state filter">
        {STATES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={state === value}
            className={`chip ${state === value ? "chip-active" : ""}`}
            onClick={() => setParams(value === "any" ? {} : { state: value })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input type="search" className="input" placeholder="Search code or description" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search DTCs" />
        <label className="toggle small">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> By ECU
        </label>
      </div>
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      {list.error ? <Banner onRetry={list.reload}>{list.error}</Banner> : null}
      {list.loading && !list.data ? <Spinner /> : null}
      {list.data && list.data.total === 0 ? <Empty>{list.data.session_id ? "No DTCs match." : "No scan yet. Run a full scan first."}</Empty> : null}

      {groups.map(([key, dtcs]) => {
        const [ecuName = "", ecuId = ""] = key.split("|");
        return (
          <Card
            key={key}
            title={grouped ? ecuName : `${dtcs.length} DTCs`}
            aside={
              grouped && can("dtc:clear") ? (
                <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => prepareClear(ecuId, ecuName, dtcs)}>
                  Clear…
                </button>
              ) : null
            }
          >
            <ul className="list compact">
              {dtcs.map((d) => (
                <DtcRow key={`${d.ecu_id}-${d.raw}`} dtc={d} pro={Boolean(user?.professional_mode)} />
              ))}
            </ul>
          </Card>
        );
      })}

      <ConfirmSheet
        open={target !== null}
        title="Clear diagnostic trouble codes?"
        busy={clearing}
        blocked={!safety?.allowed}
        confirmLabel="Clear DTCs"
        onCancel={() => setTarget(null)}
        onConfirm={confirmClear}
        rows={
          target
            ? [
                ["What", "Erase stored DTCs, freeze frames and status (UDS 0x14, all groups)"],
                ["ECU", `${target.ecuName} (${target.ecuId})`],
                ["Current", target.dtcs.map((d) => d.display).join(", ")],
                ["New", "No stored DTCs; faults still present will be detected again"],
                ["Risk", "Low — stored fault history is lost; monitors and readiness may reset"],
                ["Backup", "Not applicable: DTCs are recorded in the scan history and audit log"],
                ["ECU software", target.softwareVersion ?? "—"],
                ["Vehicle voltage", voltage(safety?.vehicle_voltage)],
                ["Safety check", safety ? <Pill tone={safety.allowed ? "ok" : "bad"}>{safety.verdict.replace(/_/g, " ")}</Pill> : target.safetyError ? "Failed" : "Checking…"],
              ]
            : []
        }
        warnings={[...(safety?.reasons ?? []), ...(target?.safetyError ? [target.safetyError] : [])]}
      />
    </Screen>
  );
}

function DtcRow({ dtc, pro }: { dtc: Dtc; pro: boolean }) {
  const [open, setOpen] = useState(false);
  const state = dtcState(dtc);
  return (
    <li className="row">
      <button type="button" className="row-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="list-main">
          <strong className="mono">{dtc.display}</strong>
          <span className="small">{dtc.description ?? "No verified description for this code"}</span>
        </span>
        <span className="list-side">
          <Pill tone={state.tone}>{state.label}</Pill>
          <Pill tone={severityTone(dtc.severity)}>{SEVERITY_LABEL[dtc.severity]}</Pill>
        </span>
      </button>
      {open ? (
        <div className="row-detail">
          <KeyValue
            rows={[
              ["Description source", <Evidence key="s" source={dtc.description_source} />],
              ["Failure type", dtc.failure_type_description ?? (dtc.failure_type !== null ? hex(dtc.failure_type, 2) : "—")],
              ["Occurrences", dtc.occurrence_count ?? "—"],
              ["Warning lamp", dtc.status.warning_indicator_requested ? "Requested" : "No"],
              ["Status byte", pro ? `${hex(dtc.status_byte, 2)} (${dtc.status_byte.toString(2).padStart(8, "0")})` : hex(dtc.status_byte, 2)],
              ["Read", dateTime(dtc.read_at)],
            ]}
          />
          {dtc.freeze_frames.length ? (
            <>
              <h3>Freeze frame</h3>
              {dtc.freeze_frames.map((f) => (
                <div key={f.record_number} className="small">
                  Record {f.record_number}:{" "}
                  {f.identifiers.length ? f.identifiers.map((i) => `${i.did} = ${i.data_hex}`).join(", ") : <span className="mono">{f.raw_hex}</span>}
                  {f.note ? <div className="muted">{f.note}</div> : null}
                </div>
              ))}
              <p className="muted small">Freeze-frame values are shown raw: decoding them needs the ECU's data definitions.</p>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
