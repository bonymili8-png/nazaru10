import { defaultConfig, validateRaces } from "../src/index.js";

const n = Number(process.argv[2] ?? 10_000);
const seed = process.argv[3] ?? "sim";
const started = Date.now();
const r = validateRaces(n, seed, defaultConfig);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`races=${r.races} field=${r.fieldSize} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(
  `favourite win ${pct(r.favouriteWinRate)} | top3 ${pct(r.favouriteTop3Rate)} | weakest win ${pct(r.weakestWinRate)}`,
);
console.log(`spearman(ability, finish) ${r.meanSpearman.toFixed(3)}`);
console.log(`gate win share ${r.gateWinShare.map(pct).join(" ")} | bias ${r.gateBias.toFixed(2)}x`);
console.log(
  `strategy win share ${Object.entries(r.strategyWinShare)
    .map(([k, v]) => `${k}=${pct(v)}`)
    .join(" ")}`,
);
console.log(
  `winner speed ${r.meanWinnerSpeed.toFixed(2)} m/s | lead changes/race ${r.meanLeadChanges.toFixed(2)} | dead heats ${r.deadHeats}`,
);
console.log(
  `median margins: winner ${r.medianWinningMargin.toFixed(1)}L, last ${r.medianLastMargin.toFixed(1)}L`,
);

// Fail (exit 1) when any GDD §I.4 target is missed, so CI blocks an unbalanced engine.
const checks: [string, boolean][] = [
  ["favourite win 30–45%", r.favouriteWinRate >= 0.3 && r.favouriteWinRate <= 0.45],
  ["favourite top-3 60–80%", r.favouriteTop3Rate >= 0.6 && r.favouriteTop3Rate <= 0.8],
  ["spearman 0.45–0.80", r.meanSpearman >= 0.45 && r.meanSpearman <= 0.8],
  ["weakest wins 0–3%", r.weakestWinRate > 0 && r.weakestWinRate < 0.03],
  ["every strategy 8–30%", Object.values(r.strategyWinShare).every((s) => s >= 0.08 && s <= 0.3)],
  ["draw bias < 1.6x", r.gateBias < 1.6],
  ["median winning margin < 5L", r.medianWinningMargin < 5],
  ["median last margin < 35L", r.medianLastMargin < 35],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
