import { useState } from "react";

import { api, describeError } from "../api/client";
import { Banner, Card, KeyValue, Pill, Screen } from "../components/ui";
import { useSession } from "../state/session";
import { useAsync } from "../state/useAsync";

// Shown so users know what exists and what does not. These are NOT implemented features.
const ROADMAP: [string, string][] = [
  ["Configuration & coding (read → validate → backup → write → verify)", "Milestone 2"],
  ["Backups & restore with compatibility checks", "Milestone 2"],
  ["Feature discovery with evidence", "Milestone 3"],
  ["Service functions / routines", "Milestone 3"],
  ["J2534 PassThru adapters", "Milestone 3"],
  ["AI-assisted diagnostics (facts vs. hypotheses)", "Milestone 4"],
];

export function Settings() {
  const { user, setProfessionalMode } = useSession();
  const gateway = useAsync(() => api.gatewayStatus(), []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function toggle(enabled: boolean) {
    setSaving(true);
    setError(null);
    try {
      await setProfessionalMode(enabled);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title="Settings">
      {error ? <Banner>{error}</Banner> : null}
      <Card title="Account">
        <KeyValue
          rows={[
            ["User", user ? `${user.first_name ?? ""} ${user.username ? `@${user.username}` : ""}`.trim() : "—"],
            ["Role", user ? <Pill key="r" tone="info">{user.role}</Pill> : "—"],
            ["Permissions", user?.permissions.join(", ") ?? "—"],
          ]}
        />
      </Card>
      <Card title="Professional mode">
        <label className="toggle">
          <input type="checkbox" checked={Boolean(user?.professional_mode)} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
          Show ECU addresses, protocols, DIDs, raw request/response traces and timing
        </label>
      </Card>
      <Card title="Diagnostic gateway">
        {gateway.data ? (
          <KeyValue
            rows={[
              ["Reachable", gateway.data.reachable ? "Yes" : "No"],
              ["Interface", gateway.data.interface ? `${gateway.data.interface.kind} — ${gateway.data.interface.description}` : "—"],
              ["Simulation", gateway.data.simulation ? "Yes" : "No"],
              ["Definition catalogs", gateway.data.catalogs.map((c) => `${c.name} (${c.source})`).join("; ") || "—"],
              ...Object.entries(gateway.data.protocols).map(([k, v]) => [k.toUpperCase(), v] as [string, string]),
            ]}
          />
        ) : gateway.error ? (
          <Banner onRetry={gateway.reload}>{gateway.error}</Banner>
        ) : null}
      </Card>
      <Card title="Not available yet">
        <ul className="plain small">
          {ROADMAP.map(([feature, milestone]) => (
            <li key={feature}>
              {feature} <Pill tone="muted">{milestone}</Pill>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  );
}
