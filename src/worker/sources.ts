/** Public, human-readable source URLs for report citations. */

export interface SourceLink {
  /** Short label shown in the report, e.g. "AAPL-Yahoo" */
  label: string;
  url: string;
}

export interface ReportSources {
  quote: SourceLink;
  earnings: SourceLink;
  filings: SourceLink;
  stats: SourceLink;
  company?: SourceLink;
}

function httpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Ticker-prefix a short source label: "Yahoo" → "AAPL-Yahoo". Every link in
 * `ReportSources` is symbol-specific, so a comparative report would otherwise
 * render three identical "Yahoo" chips with no way to tell them apart.
 */
export function tickerSourceLabel(symbol: string, label: string): string {
  const sym = symbol.trim().toUpperCase();
  const short = label.trim();
  if (!sym || !short) return short;
  return short.startsWith(`${sym}-`) ? short : `${sym}-${short}`;
}

export function buildReportSources(
  symbol: string,
  companyWebUrl?: string | null
): ReportSources {
  const sym = symbol.toUpperCase();
  const label = (short: string) => tickerSourceLabel(sym, short);
  const sources: ReportSources = {
    quote: {
      label: label("Yahoo"),
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`,
    },
    earnings: {
      label: label("Earnings"),
      url: `https://finance.yahoo.com/calendar/earnings?symbol=${encodeURIComponent(sym)}`,
    },
    filings: {
      label: label("SEC"),
      url: `https://www.sec.gov/edgar/search/#/category=custom&entityName=${encodeURIComponent(sym)}`,
    },
    stats: {
      label: label("Stats"),
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/key-statistics`,
    },
  };

  const site = httpsUrl(companyWebUrl);
  if (site) {
    sources.company = { label: label("Site"), url: site };
  }

  return sources;
}

/** Warm cache rows written before prefixes still carry bare labels. */
export function withTickerSourceLabels(
  symbol: string,
  sources: ReportSources
): ReportSources {
  const relabel = (link: SourceLink): SourceLink => ({
    ...link,
    label: tickerSourceLabel(symbol, link.label),
  });
  const upgraded: ReportSources = {
    quote: relabel(sources.quote),
    earnings: relabel(sources.earnings),
    filings: relabel(sources.filings),
    stats: relabel(sources.stats),
  };
  if (sources.company) upgraded.company = relabel(sources.company);
  return upgraded;
}

/** Same upgrade for the `_citation` string cached alongside those sources. */
export function withTickerCitationLabels(
  symbol: string,
  citation: string
): string {
  return citation.replace(
    /\[([^\]\n]+)\]\(/g,
    (_m, label: string) => `[${tickerSourceLabel(symbol, label)}](`
  );
}

/** Markdown short-link: [AAPL-Yahoo](https://…) */
export function mdSourceLink(link: SourceLink): string {
  return `[${link.label}](${link.url})`;
}

export function citationWithSources(
  _feed: "Finnhub" | "Yahoo Finance",
  asOfEt: string,
  sources: ReportSources,
  stamp?: string
): string {
  const when = stamp ? `${asOfEt} ET (${stamp})` : `${asOfEt} ET`;
  return `Fact · ${mdSourceLink(sources.quote)} · ${when}`;
}
