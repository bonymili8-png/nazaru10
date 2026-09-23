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
