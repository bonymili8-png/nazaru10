/**
 * Economy cohort simulation (docs/02-economy.md §K.4).
 *
 * Simulates P players for D days with a reasonable "median active owner" policy using the real
 * engine rules: training (costs, gains, fatigue, injuries), races against house fields of the
 * right class (entry fees, purses, placings), primary horse purchases, stable upgrades and the
 * onboarding quest rewards. Reports credit sources/sinks per player-day and wallet
 * distribution, and exits 1 if the balance targets are missed.
 *
 *   pnpm sim:economy [players=400] [days=28]
 */
import {
  defaultConfig as cfg,
  generateGenome,
  generateTrainer,
  maxTrainers,
  trainerEffect,
  trainerSalary,
  type TrainerProfile,
  horseValuation,
  initialAttributes,
  mean,
  projectCondition,
  raceAftermath,
  randomEntrant,
  resolveTraining,
  Rng,
  rollWeather,
  rollWetness,
  simulateRace,
  splitPurse,
  TRACKS,
  trainingBlockReason,
  trainingCost,
  type Attributes,
  type Condition,
  type Genome,
  type RaceClass,
  type RaceEntrant,
  type TrainingType,
} from "../src/index.js";

const PLAYERS = Number(process.argv[2] ?? 400);
const DAYS = Number(process.argv[3] ?? 28);
const SESSIONS = [9, 20]; // hours of day the owner plays
const DAY_MS = 86_400_000;

interface SimHorse {
  genome: Genome;
  attributes: Attributes;
  cond: Condition;
  condAt: number; // hours
  birthHours: number;
  wins: number;
  starts: number;
  injuredUntil: number;
  trainedToday: number;
  /** Owner's plan: next race no earlier than this (hours). */
  nextRaceAt: number;
}

interface Player {
  credits: number;
  horses: SimHorse[];
  level: number;
  quests: Set<string>;
  trainer: (TrainerProfile & { salary: number; paidUntil: number }) | null;
}

const ledger = { sources: new Map<string, number>(), sinks: new Map<string, number>() };
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const earn = (p: Player, k: string, v: number) => {
  p.credits += v;
  add(ledger.sources, k, v);
};
const spend = (p: Player, k: string, v: number) => {
  if (p.credits < v) return false;
  p.credits -= v;
  add(ledger.sinks, k, v);
  return true;
};
const QUEST: Record<string, number> = {
  CREATE_STABLE: 200,
  FIRST_HORSE: 200,
  FIRST_TRAINING: 300,
  FIRST_RACE: 500,
  FIRST_PODIUM: 800,
  FIRST_WIN: 1500,
  BUY_HORSE: 500,
  UPGRADE_STABLE: 1000,
};
const quest = (p: Player, q: string) => {
  if (p.quests.has(q)) return;
  p.quests.add(q);
  earn(p, "QUEST_REWARD", QUEST[q]!);
};

const yearsHours = (h: number) => h / (cfg.lifecycle.realDaysPerGameYear * 24);
const at = (h: number) => new Date(h * 3_600_000);

function newHorse(rng: Rng, quality: number, age: number, nowH: number, rarity?: Genome["rarity"]): SimHorse {
  const genome = generateGenome(rng, { quality, rarity }, cfg);
  return {
    genome,
    attributes: initialAttributes(genome, age, rng),
    cond: { fatigue: 0, health: 100, form: 0 },
    condAt: nowH,
    birthHours: nowH - age * cfg.lifecycle.realDaysPerGameYear * 24,
    wins: 0,
    starts: 0,
    injuredUntil: 0,
    trainedToday: 0,
    nextRaceAt: 0,
  };
}

function condition(h: SimHorse, nowH: number): Condition {
  return projectCondition({ ...h.cond, updatedAt: at(h.condAt) }, at(nowH), h.attributes.endurance, cfg);
}

function raceClassFor(h: SimHorse): RaceClass {
  if (h.wins === 0) return "MAIDEN";
  if (h.wins <= 2) return "CLASS_5";
  if (h.wins <= 5) return "CLASS_4";
  if (h.wins <= 9) return "CLASS_3";
  return "CLASS_2";
}

const TRAIN_ROTATION: TrainingType[] = [
  "SPEED",
  "STAMINA",
  "FINISHING",
  "ACCELERATION",
  "AGILITY",
  "STRENGTH",
];

function runRace(rng: Rng, p: Player, h: SimHorse, nowH: number, cond: Condition): void {
  const cls = raceClassFor(h);
  const cc = cfg.race.classes[cls];
  if (!spend(p, "RACE_ENTRY", cc.entryFee)) return;
  const track = rng.pick(TRACKS);
  const distance = rng.pick(track.distances);
  const weather = rollWeather(track, rng);
  const me: RaceEntrant = {
    id: "me",
    name: "me",
    attributes: h.attributes,
    traits: h.genome.traits,
    aptitudes: h.genome.aptitudes,
    raceIntelligence: h.genome.hidden.raceIntelligence,
    condition: cond,
    strategy: "MID_PACK",
    jockey: { id: "j", name: "j", skill: rng.float(...cc.houseJockeySkill) },
  };
  const field = [me];
  for (let i = 0; i < cfg.race.schedule.targetField - 1; i++) {
    const e = randomEntrant(rng, `h${i}`, rng.float(...cc.houseQuality), cfg);
    // House horses are generated at the class's age band (as the API does).
    const houseAge = rng.float(...cc.houseAge);
    const g = generateGenome(rng, { quality: rng.float(...cc.houseQuality) }, cfg);
    e.attributes = initialAttributes(g, houseAge, rng);
    e.traits = g.traits;
    e.aptitudes = g.aptitudes;
    e.aptitudes = { ...e.aptitudes, optimalDistance: Math.round(distance * Math.exp(rng.normal(0, 0.15))) };
    e.jockey.skill = rng.float(...cc.houseJockeySkill);
    field.push(e);
  }
  const res = simulateRace(
    rng.shuffle(field),
    { distance, track, weather, wetness: rollWetness(track, weather, rng) },
    `${rng.nextUint32()}`,
    cfg,
  );
  const pos = res.results.find((r) => r.entrantId === "me")!.position;
  const prizes = splitPurse(
    cc.purse,
    res.results.map((r) => ({ id: r.entrantId, position: r.position })),
    cfg.race.prizeSplit,
  );
  const prize = prizes.get("me") ?? 0;
  if (prize > 0) earn(p, "RACE_PRIZE", prize);
  h.starts++;
  if (pos === 1) h.wins++;
  quest(p, "FIRST_RACE");
  if (pos <= 3) quest(p, "FIRST_PODIUM");
  if (pos === 1) quest(p, "FIRST_WIN");
  const after = raceAftermath(
    cond,
    {
      distance,
      position: pos,
      expectedPosition: 4,
      fieldSize: field.length,
      endurance: h.attributes.endurance,
      susceptibility: h.genome.hidden.injurySusceptibility,
      strategy: "MID_PACK",
    },
    rng,
    cfg,
  );
  h.cond = after.condition;
  h.condAt = nowH + 0.05;
  if (after.injury) h.injuredUntil = nowH + after.injury.hours;
  stats.races++;
  stats.positions.push(pos);
}

const stats = {
  races: 0,
  trainings: 0,
  injuries: 0,
  purchases: 0,
  upgrades: 0,
  hires: 0,
  vet: 0,
  positions: [] as number[],
};

function session(rng: Rng, p: Player, nowH: number): void {
  for (const h of p.horses) {
    if (nowH < h.injuredUntil) {
      // Serious owners call the vet when they can afford it comfortably.
      const cost = cfg.economy.vetCost.MINOR;
      if (p.credits > cost * 4 && spend(p, "VET", cost)) {
        h.injuredUntil = nowH;
        stats.vet++;
      } else continue;
    }
    const cond = condition(h, nowH);
    const age = yearsHours(nowH - h.birthHours);
    const canRace =
      nowH >= h.nextRaceAt &&
      age >= cfg.lifecycle.minRacingAge &&
      cond.fatigue <= 35 &&
      cond.health >= cfg.condition.minHealthToRace;
    if (canRace && p.credits >= cfg.race.classes[raceClassFor(h)].entryFee) {
      runRace(rng, p, h, nowH, cond);
      h.nextRaceAt = nowH + 40; // race roughly every other day
      continue;
    }
    // Train once a day on non-race days, as long as the horse is not too tired.
    const type = TRAIN_ROTATION[(h.starts + Math.floor(nowH / 24)) % TRAIN_ROTATION.length]!;
    const block = trainingBlockReason(cond, age, type, cfg);
    const cost = trainingCost(type, "NORMAL", cfg);
    if (block || h.trainedToday > 0 || cond.fatigue > 40 || p.credits < cost + 300) continue;
    spend(p, "TRAINING", cost);
    const effect = p.trainer ? trainerEffect(p.trainer, type, cfg) : null;
    const out = resolveTraining(
      {
        type,
        intensity: "NORMAL",
        attributes: h.attributes,
        genome: h.genome,
        condition: cond,
        age,
        sessionsLast24h: h.trainedToday,
        trainerMultiplier: effect?.gainMultiplier,
        trainerInjuryMultiplier: effect?.injuryMultiplier,
      },
      rng,
      cfg,
    );
    h.attributes = out.attributes;
    h.cond = { ...cond, fatigue: out.fatigue, health: out.health };
    h.condAt = nowH + 1;
    h.trainedToday++;
    if (out.injury) {
      h.injuredUntil = nowH + out.injury.hours;
      stats.injuries++;
    }
    stats.trainings++;
    quest(p, "FIRST_TRAINING");
  }
  // Staff: renew the weekly contract while comfortably solvent, otherwise let the trainer go.
  const week = cfg.staff.contractDays * 24;
  if (p.trainer && nowH >= p.trainer.paidUntil) {
    if (p.credits >= p.trainer.salary + 1500 && spend(p, "STAFF_SALARY", p.trainer.salary))
      p.trainer.paidUntil += week;
    else p.trainer = null;
  }
  // A full stable saves for the next upgrade first.
  const full = p.horses.length >= cfg.economy.stableCapacity[p.level - 1]!;
  const saving = full ? (cfg.economy.stableUpgradeCost[p.level - 1] ?? 0) : 0;
  if (!p.trainer && p.horses.length >= 2 && maxTrainers(p.level, cfg) > 0) {
    // Interview three candidates; hire the most skilled one the owner can carry for a month.
    const best = [0, 1, 2]
      .map(() => generateTrainer(rng, cfg))
      .map((t) => ({ ...t, salary: trainerSalary(t.skill, cfg) }))
      .filter((t) => p.credits >= 4 * t.salary + 2500 + saving)
      .sort((a, b) => b.skill - a.skill)[0];
    if (best && spend(p, "STAFF_SALARY", best.salary)) {
      p.trainer = { ...best, paidUntil: nowH + week };
      stats.hires++;
    }
  }
  // Growth decisions at the end of the session.
  const capacity = cfg.economy.stableCapacity[p.level - 1]!;
  const reserve = 1500 + p.horses.reduce((sum, h) => sum + 3 * cfg.race.classes[raceClassFor(h)].entryFee, 0);
  if (p.horses.length < capacity) {
    const age = rng.float(2, 4.5);
    const candidate = newHorse(rng, rng.float(0.2, 0.75), age, nowH);
    const price = horseValuation(candidate.genome, candidate.attributes, age);
    if (p.credits >= price + reserve && spend(p, "HORSE_SALES", price)) {
      p.horses.push(candidate);
      stats.purchases++;
      quest(p, "BUY_HORSE");
    }
  } else {
    const cost = cfg.economy.stableUpgradeCost[p.level - 1];
    if (cost !== undefined && p.credits >= cost + reserve && spend(p, "STABLE_UPGRADE", cost)) {
      p.level++;
      stats.upgrades++;
      quest(p, "UPGRADE_STABLE");
    }
  }
}

const rng = new Rng("economy-sim");
const players: Player[] = Array.from({ length: PLAYERS }, () => {
  const p: Player = { credits: 0, horses: [], level: 1, quests: new Set(), trainer: null };
  earn(p, "STARTER_GRANT", cfg.economy.startingCredits);
  p.horses.push(newHorse(rng, 0.42, 2.3, 0, "UNCOMMON"));
  quest(p, "CREATE_STABLE");
  quest(p, "FIRST_HORSE");
  return p;
});

const snapshots: { day: number; median: number; p90: number; horses: number; broke: number }[] = [];
const quantile = (xs: number[], q: number) =>
  [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] ?? 0;
for (let day = 0; day < DAYS; day++) {
  for (const p of players) {
    for (const h of p.horses) h.trainedToday = 0;
    if (p.credits < cfg.economy.allowance.threshold) earn(p, "DAILY_ALLOWANCE", cfg.economy.allowance.amount);
  }
  for (const hour of SESSIONS) for (const p of players) session(rng, p, day * 24 + hour);
  if ([0, 6, 13, 20, 27].includes(day) || day === DAYS - 1) {
    const w = players.map((p) => p.credits);
    snapshots.push({
      day: day + 1,
      median: quantile(w, 0.5),
      p90: quantile(w, 0.9),
      horses: mean(players.map((p) => p.horses.length)),
      broke: players.filter((p) => p.credits < cfg.race.classes.MAIDEN.entryFee).length / PLAYERS,
    });
  }
}

const perPlayerDay = (m: Map<string, number>, excludeOneOff: boolean) => {
  let total = 0;
  for (const [k, v] of m)
    if (!excludeOneOff || (k !== "STARTER_GRANT" && k !== "QUEST_REWARD" && k !== "DAILY_ALLOWANCE"))
      total += v;
  return total / (PLAYERS * DAYS);
};
const fmt = (n: number) => Math.round(n).toLocaleString("en");
console.log(
  `players=${PLAYERS} days=${DAYS} races=${stats.races} trainings=${stats.trainings} purchases=${stats.purchases} upgrades=${stats.upgrades} hires=${stats.hires} injuries=${stats.injuries} vet=${stats.vet}`,
);
console.log(
  "sources per player-day:",
  [...ledger.sources].map(([k, v]) => `${k}=${fmt(v / (PLAYERS * DAYS))}`).join(" "),
);
console.log(
  "sinks   per player-day:",
  [...ledger.sinks].map(([k, v]) => `${k}=${fmt(v / (PLAYERS * DAYS))}`).join(" "),
);
const income = perPlayerDay(ledger.sources, true);
const operating =
  ((ledger.sinks.get("RACE_ENTRY") ?? 0) +
    (ledger.sinks.get("TRAINING") ?? 0) +
    (ledger.sinks.get("VET") ?? 0)) /
  (PLAYERS * DAYS);
const allSinks = perPlayerDay(ledger.sinks, false);
const allSources = perPlayerDay(ledger.sources, false);
console.log(
  `recurring income ${fmt(income)}/day | operating spend ${fmt(operating)}/day | all sources ${fmt(allSources)} vs all sinks ${fmt(allSinks)} per player-day`,
);
for (const s of snapshots) {
  console.log(
    `day ${String(s.day).padStart(2)}: median wallet ${fmt(s.median)} | p90 ${fmt(s.p90)} | avg horses ${s.horses.toFixed(2)} | broke ${(s.broke * 100).toFixed(1)}%`,
  );
}
const winRate = stats.positions.filter((x) => x === 1).length / Math.max(1, stats.positions.length);
console.log(
  `player win rate ${(winRate * 100).toFixed(1)}% | top-3 ${((stats.positions.filter((x) => x <= 3).length / Math.max(1, stats.positions.length)) * 100).toFixed(1)}%`,
);

// Targets from docs/02-economy.md §K.4 (set after the first simulation runs).
const last = snapshots[snapshots.length - 1]!;
const twoWeeksAgo = snapshots.find((x) => x.day >= last.day - 14) ?? snapshots[0]!;
const upgraded = players.filter((p) => p.level > 1).length / PLAYERS;
const allowanceShare = (ledger.sources.get("DAILY_ALLOWANCE") ?? 0) / (PLAYERS * DAYS) / Math.max(1, income);
const employing = players.filter((p) => p.trainer).length / PLAYERS;
const salaryShare = (ledger.sinks.get("STAFF_SALARY") ?? 0) / (PLAYERS * DAYS) / Math.max(1, income);
console.log(
  `employing a trainer at season end ${(employing * 100).toFixed(1)}% | salaries ${(salaryShare * 100).toFixed(1)}% of income`,
);
const checks: [string, boolean][] = [
  ["recurring income 400–1,200 per player-day", income >= 400 && income <= 1200],
  [
    "no inflation: median wallet grows ≤ 25% over the last two weeks",
    last.median <= 1.25 * twoWeeksAgo.median,
  ],
  ["no runaway top: p90 wallet grows ≤ 50% over the last two weeks", last.p90 <= 1.5 * twoWeeksAgo.p90],
  ["fewer than 5% of owners below the cheapest entry fee at season end", last.broke < 0.05],
  ["owners grow their string (avg ≥ 2 horses by season end)", last.horses >= 2],
  // The simulated owner is conservative (upgrades only when full and keeping an entry-fee reserve).
  ["≥ 15% of owners upgrade their stable within a season", upgraded >= 0.15],
  ["player in-class win rate 10–25%", winRate >= 0.1 && winRate <= 0.25],
  ["allowance is a safety net, not an income (< 10% of income)", allowanceShare < 0.1],
  // Staff is an optional sink: attractive (the eager simulated owner hires whenever it can carry
  // a month of salary) but not universal, and never the main cost.
  ["20–85% of owners employ a trainer at season end", employing >= 0.2 && employing <= 0.85],
  ["salaries are 3–25% of recurring income", salaryShare >= 0.03 && salaryShare <= 0.25],
];
console.log(
  `stable upgraded by ${(upgraded * 100).toFixed(1)}% | allowance ${(allowanceShare * 100).toFixed(1)}% of income`,
);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
void DAY_MS;
