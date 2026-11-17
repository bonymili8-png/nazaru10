/** Whether `tz` is an IANA time zone this runtime knows (e.g. "Europe/Kyiv"). */
export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The local date (YYYY-MM-DD) and hour at `at` in `tz` (UTC when unknown). */
export function localTime(at: Date, tz: string | null | undefined): { date: string; hour: number } {
  const zone = tz && validTimezone(tz) ? tz : "UTC";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}
