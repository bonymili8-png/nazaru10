/** Small, dependency-free SVG gauge and sparkline for live data. */

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <svg className="sparkline" viewBox="0 0 100 28" role="img" aria-label={`${label}: not enough samples`} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(26 - ((v - min) / span) * 24).toFixed(2)}`)
    .join(" ");
  const last = values[values.length - 1] ?? 0;
  return (
    <svg className="sparkline" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={`${label} trend, last ${last}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function Gauge({ value, min, max, unit, label }: { value: number | null; min: number; max: number; unit: string; label: string }) {
  const clamped = value === null ? min : Math.min(max, Math.max(min, value));
  const fraction = max > min ? (clamped - min) / (max - min) : 0;
  const angle = Math.PI * (1 - fraction);
  const x = 50 + 38 * Math.cos(angle);
  const y = 50 - 38 * Math.sin(angle);
  const large = fraction > 0.5 ? 1 : 0;
  return (
    <svg className="gauge" viewBox="0 0 100 62" role="img" aria-label={`${label}: ${value ?? "no value"} ${unit}`}>
      <path d="M12 50 A38 38 0 0 1 88 50" className="gauge-track" />
      {value !== null && fraction > 0 ? <path d={`M12 50 A38 38 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}`} className="gauge-fill" /> : null}
      <text x="50" y="47" textAnchor="middle" className="gauge-value">
        {value === null ? "—" : Math.abs(value) >= 1000 ? Math.round(value) : Number(value.toFixed(1))}
      </text>
      <text x="50" y="59" textAnchor="middle" className="gauge-unit">
        {unit}
      </text>
    </svg>
  );
}
