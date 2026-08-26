/** NYSE / U.S. equity market clock — America/New_York (ET). */

export const NYSE_TZ = "America/New_York";

const etDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: NYSE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const etStampFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: NYSE_TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** Calendar date on the NYSE tape: YYYY-MM-DD. */
export function nyseDateString(d: Date = new Date()): string {
  // en-CA yields YYYY-MM-DD
  return etDateFmt.format(d);
}

/** Human stamp in Eastern, e.g. "Aug 25, 2026, 9:36 PM EDT". */
export function nyseTimestamp(d: Date = new Date()): string {
  return etStampFmt.format(d);
}

/** Add calendar days to a YYYY-MM-DD string (UTC noon anchor avoids DST edge cases). */
export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export type EarningsSession = "bmo" | "amc" | "dmh" | null;

export interface EarningsEvent {
  date: string;
  hour: EarningsSession;
  symbol?: string;
}

/**
 * Next report date on or after the NYSE session day.
 * Prefers the soonest date; ignores blank/invalid rows.
 */
export function pickNextEarningsDate(
  events: Array<{ date?: string; hour?: string; symbol?: string }>,
  symbol: string,
  asOfEt: string = nyseDateString()
): EarningsEvent | null {
  const sym = symbol.toUpperCase();
  const ranked = events
    .filter((e) => {
      const s = (e.symbol ?? sym).toUpperCase();
      return s === sym && Boolean(e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    })
    .map((e) => ({
      date: e.date as string,
      hour: normalizeHour(e.hour),
      symbol: sym,
    }))
    .filter((e) => e.date >= asOfEt)
    .sort((a, b) => a.date.localeCompare(b.date) || sessionRank(a.hour) - sessionRank(b.hour));

  return ranked[0] ?? null;
}

function normalizeHour(hour: string | undefined): EarningsSession {
  const h = (hour ?? "").toLowerCase();
  if (h === "bmo" || h === "amc" || h === "dmh") return h;
  return null;
}

function sessionRank(hour: EarningsSession): number {
  if (hour === "bmo") return 0;
  if (hour === "dmh") return 1;
  if (hour === "amc") return 2;
  return 3;
}

export function formatEarningsSession(hour: EarningsSession): string | null {
  if (hour === "bmo") return "before the open (ET)";
  if (hour === "amc") return "after the close (ET)";
  if (hour === "dmh") return "during market hours (ET)";
  return null;
}
