/** Multi-competitor Elo: every pair of finishers is a virtual head-to-head. */
export function updateRatings(
  field: readonly { id: string; rating: number; position: number }[],
  k: number,
): Map<string, number> {
  const n = field.length;
  const delta = new Map<string, number>(field.map((f) => [f.id, 0]));
  if (n < 2) return new Map(field.map((f) => [f.id, f.rating] as const));
  const kk = k / (n - 1);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = field[i]!;
      const b = field[j]!;
      const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      const score = a.position < b.position ? 1 : a.position === b.position ? 0.5 : 0;
      const d = kk * (score - expected);
      delta.set(a.id, delta.get(a.id)! + d);
      delta.set(b.id, delta.get(b.id)! - d);
    }
  }
  return new Map(field.map((f) => [f.id, Math.round(f.rating + delta.get(f.id)!)] as const));
}

/**
 * Split an integer purse across finishing positions. Dead heats share the combined
 * prize for the positions they occupy. Rounding remainder goes to the first prize.
 */
export function splitPurse(
  purse: number,
  positions: readonly { id: string; position: number }[],
  split: readonly number[],
): Map<string, number> {
  const out = new Map<string, number>();
  const byPos = new Map<number, string[]>();
  for (const p of positions) byPos.set(p.position, [...(byPos.get(p.position) ?? []), p.id]);
  let paid = 0;
  for (const [pos, ids] of [...byPos.entries()].sort((a, b) => a[0] - b[0])) {
    let share = 0;
    for (let k = 0; k < ids.length; k++) share += split[pos - 1 + k] ?? 0;
    const each = Math.floor((purse * share) / ids.length);
    for (const id of ids) {
      out.set(id, each);
      paid += each;
    }
  }
  const allocated = split.slice(0, positions.length).reduce((s, x) => s + x, 0);
  const target = Math.floor(purse * Math.min(1, allocated));
  const winner = positions.find((p) => p.position === 1);
  if (winner && target > paid) out.set(winner.id, (out.get(winner.id) ?? 0) + (target - paid));
  return out;
}
