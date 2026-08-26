/** Public, human-readable source URLs for report citations. */

export interface SourceLink {
  /** Short label shown in the report, e.g. "Yahoo" */
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

export function buildReportSources(
  symbol: string,
  companyWebUrl?: string | null
): ReportSources {
  const sym = symbol.toUpperCase();
  const sources: ReportSources = {
    quote: {
      label: "Yahoo",
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`,
    },
    earnings: {
      label: "Earnings",
      url: `https://finance.yahoo.com/calendar/earnings?symbol=${encodeURIComponent(sym)}`,
    },
    filings: {
      label: "SEC",
      url: `https://www.sec.gov/edgar/search/#/category=custom&entityName=${encodeURIComponent(sym)}`,
    },
    stats: {
      label: "Stats",
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/key-statistics`,
    },
  };

  const site = httpsUrl(companyWebUrl);
  if (site) {
    sources.company = { label: "Site", url: site };
  }

  return sources;
}

/** Markdown short-link: [Yahoo](https://…) */
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
