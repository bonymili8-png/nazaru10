/** Ledger idempotency key of an owner's daily race bonus: one per owner per UTC day of the race. */
export const dailyRaceBonusKey = (userId: string, day: Date): string =>
  `daily-race:${userId}:${day.toISOString().slice(0, 10)}`;
