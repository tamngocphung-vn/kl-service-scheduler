// Timezone helpers built on Intl so we don't need a date library.
// Dealership opening hours are defined in local wall-clock time; everything is stored in UTC.

const MINUTE_MS = 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (local - UTC) in ms for the given instant in the given zone. */
function offsetMs(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** True for a real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-30). */
export function isValidLocalDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Converts a local date ("YYYY-MM-DD") + minute-of-day in `timeZone` to a UTC epoch ms. */
export function localToUtc(date: string, minuteOfDay: number, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  // Two passes resolve the offset correctly across DST transitions.
  let utc = wallClockAsUtc - offsetMs(wallClockAsUtc, timeZone);
  const corrected = offsetMs(utc, timeZone);
  if (wallClockAsUtc - utc !== corrected) utc = wallClockAsUtc - corrected;
  return utc;
}

/** Local calendar date and minute-of-day of a UTC instant in `timeZone`. */
export function utcToLocal(utcMs: number, timeZone: string): { date: string; minuteOfDay: number } {
  const p = zonedParts(utcMs, timeZone);
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { date, minuteOfDay: p.hour * 60 + p.minute };
}

export const minutesToMs = (minutes: number) => minutes * MINUTE_MS;
