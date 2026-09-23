import {
  breed,
  defaultConfig,
  generateGenome,
  mean,
  Rng,
  slope,
  stdDev,
  TRAINABLE_ATTRIBUTES,
  type Genome,
} from "../src/index.js";

/** Random-mating population over several generations: checks heritability, drift and mutation rate. */
const n = Number(process.argv[2] ?? 10_000);
const generations = Number(process.argv[3] ?? 10);
const rng = new Rng("breeding-sim");
const avgCeiling = (g: Genome) => mean(TRAINABLE_ATTRIBUTES.map((a) => g.ceilings[a]));

let pop = Array.from({ length: 500 }, (_, i) => ({
  id: `g0-${i}`,
  genome: generateGenome(rng, { quality: rng.next() }, defaultConfig),
}));
for (let gen = 1; gen <= generations; gen++) {
  const mids: number[] = [];
  const kids: number[] = [];
  let mutations = 0;
  const next: typeof pop = [];
  for (let i = 0; i < n; i++) {
    const s = rng.pick(pop);
    let d = rng.pick(pop);
    while (d.id === s.id) d = rng.pick(pop);
    const out = breed(s, d, new Map(), rng, defaultConfig);
    if (out.mutation) mutations++;
    mids.push((avgCeiling(s.genome) + avgCeiling(d.genome)) / 2);
    kids.push(avgCeiling(out.genome));
    if (next.length < 500) next.push({ id: `g${gen}-${i}`, genome: out.genome });
  }
  console.log(
    `gen ${gen}: mean ${mean(kids).toFixed(2)} sd ${stdDev(kids).toFixed(2)} heritability ${slope(mids, kids).toFixed(3)} mutation ${((mutations / n) * 100).toFixed(2)}%`,
  );
  pop = next;
}
