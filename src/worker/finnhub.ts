import { fetchBackupQuote, type BackupQuote } from "./backup";
import {
  addCalendarDays,
  formatEarningsSession,
  nyseDateString,
  nyseTimestamp,
  pickNextEarningsDate,
  type EarningsSession,
} from "./market-time";
import { resolvePeerSymbols } from "./peers";
import {
  buildReportSources,
  citationWithSources,
  type ReportSources,
} from "./sources";

export interface SymbolResult {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
}

export interface FundamentalsPayload {
  symbol: string;
  name: string;
  exchange: string | null;
  industry: string | null;
  asOf: string;
  /** NYSE session date (America/New_York) for the asOf instant. */
  asOfEt: string;
  dataAgeHours: number;
  quote: {
    price: number | null;
    changePct: number | null;
    marketCap: string | null;
  };
  valuation: Record<string, number | null>;
  margins: Record<string, number | null>;
  growth: Record<string, number | null>;
  cashFlow: Record<string, number | null>;
  insiders: {
    ownershipPct: number | null;
    recentTrades: Array<{
      name: string;
      transaction: string;
      date: string;
      shares: number | null;
    }>;
  };
  peers: Array<{ symbol: string; pe: number | null; ps: number | null }>;
  nextCatalysts: {
    /** Next earnings calendar date (YYYY-MM-DD), NYSE session day. */
    earningsDate: string | null;
    /** Finnhub hour code: bmo / amc / dmh */
    earningsSession: EarningsSession;
    /** Plain-English session in Eastern Time */
    earningsSessionEt: string | null;
    marketCalendar: "NYSE";
  };
  /** Public short-label links for clickable citations in the report. */
  sources: ReportSources;
  /** "degraded" means the backup feed supplied price only. */
  dataQuality: "full" | "degraded";
  source: "finnhub" | "yahoo";
  news: Array<{
    headline: string;
    date: string;
    source: string;
    url: string | null;
    /** Pre-built markdown short-link when url is present. */
    linkMd: string | null;
  }>;
  analystTrend: {
    period: string | null;
    strongBuy: number | null;
    buy: number | null;
    hold: number | null;
    sell: number | null;
    strongSell: number | null;
  };
  _citation: string;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(4) : null;
}

function fmtCap(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

/** Finnhub free tier allows ~60 req/min; a multi-ticker report bursts well past that. */
const MAX_ATTEMPTS = 4;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const header = Number(retryAfter);
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 6_000);
  const base = 350 * 2 ** (attempt - 1);
  return Math.min(base, 4_000) + Math.floor(Math.random() * 250);
}

/**
 * FINNHUB_API_KEY accepts a comma-separated pool. Each key carries its own
 * rate-limit budget, so a 429 can fail over instantly instead of sleeping.
 */
export function parseKeyPool(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

let keyCursor = 0;

async function finnhub<T>(
  apiKey: string,
  path: string,
  optional = false
): Promise<T | null> {
  const keys = parseKeyPool(apiKey);
  if (!keys.length) {
    if (optional) return null;
    throw new Error("Finnhub key not configured");
  }

  const budget = MAX_ATTEMPTS + keys.length - 1;
  let lastStatus = 0;
  let keysBurned = 0;

  for (let attempt = 1; attempt <= budget; attempt++) {
    const key = keys[keyCursor % keys.length];
    const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${key}`;

    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      if (attempt === budget) break;
      await sleep(backoffMs(attempt, null));
      continue;
    }

    if (res.ok) return (await res.json()) as T;

    lastStatus = res.status;
    if (!RETRY_STATUSES.has(res.status) || attempt === budget) break;

    // A fresh key has its own budget, so swapping beats waiting.
    if ((res.status === 429 || res.status === 403) && keysBurned + 1 < keys.length) {
      keyCursor++;
      keysBurned++;
      continue;
    }
    await sleep(backoffMs(attempt, res.headers.get("Retry-After")));
  }

  if (optional) return null;
  throw new Error(
    lastStatus
      ? `Finnhub ${lastStatus} on ${path.split("?")[0]}`
      : `Finnhub unreachable on ${path.split("?")[0]}`
  );
}

export async function searchSymbols(
  apiKey: string,
  query: string
): Promise<SymbolResult[]> {
  if (!query.trim()) return [];
  const data = await finnhub<{ result?: Array<Record<string, string>> }>(
    apiKey,
    `/search?q=${encodeURIComponent(query.trim())}`
  );
  const results = data?.result ?? [];
  const seen = new Set<string>();
  const out: SymbolResult[] = [];

  for (const row of results) {
    const symbol = row.symbol?.toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      name: row.description || symbol,
      exchange: row.displaySymbol?.split(":")[0] || row.type,
      type: row.type,
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** Price-only shape for when the backup feed is all we have. */
function degradedPayload(
  sym: string,
  backup: BackupQuote,
  asOf: Date
): FundamentalsPayload {
  const empty = { pe: null, forwardPe: null, evEbitda: null, ps: null, pb: null };
  const asOfEt = nyseDateString(asOf);
  const sources = buildReportSources(sym);
  return {
    symbol: sym,
    name: backup.name ?? sym,
    exchange: backup.exchange,
    industry: null,
    asOf: asOf.toISOString(),
    asOfEt,
    dataAgeHours: 0,
    dataQuality: "degraded",
    source: "yahoo",
    quote: {
      price: backup.price,
      changePct: backup.changePct,
      marketCap: null,
    },
    valuation: empty,
    margins: { gross: null, operating: null, net: null },
    growth: { revenueYoY: null, epsYoY: null },
    cashFlow: { fcfPerShare: null, fcfMargin: null },
    insiders: { ownershipPct: null, recentTrades: [] },
    peers: [],
    nextCatalysts: {
      earningsDate: null,
      earningsSession: null,
      earningsSessionEt: null,
      marketCalendar: "NYSE",
    },
    sources,
    news: [],
    analystTrend: {
      period: null,
      strongBuy: null,
      buy: null,
      hold: null,
      sell: null,
      strongSell: null,
    },
    _citation: citationWithSources("Yahoo Finance", asOfEt, sources),
  };
}

function emptyCatalysts(): FundamentalsPayload["nextCatalysts"] {
  return {
    earningsDate: null,
    earningsSession: null,
    earningsSessionEt: null,
    marketCalendar: "NYSE",
  };
}

function catalystsFromCalendar(
  earningsRaw: {
    earningsCalendar?: Array<{ date?: string; hour?: string; symbol?: string }>;
  } | null,
  sym: string,
  asOfEt: string
): FundamentalsPayload["nextCatalysts"] {
  const next = pickNextEarningsDate(
    earningsRaw?.earningsCalendar ?? [],
    sym,
    asOfEt
  );
  if (!next) return emptyCatalysts();
  return {
    earningsDate: next.date,
    earningsSession: next.hour,
    earningsSessionEt: formatEarningsSession(next.hour),
    marketCalendar: "NYSE",
  };
}

export async function fetchFundamentals(
  apiKey: string,
  symbol: string
): Promise<FundamentalsPayload> {
  const sym = symbol.toUpperCase();
  const asOf = new Date();
  // All calendar windows are NYSE session dates — never UTC midnight.
  const asOfEt = nyseDateString(asOf);
  const fromDate = addCalendarDays(asOfEt, -30);
  const earningsFrom = addCalendarDays(asOfEt, -1);
  const earningsTo = addCalendarDays(asOfEt, 120);

  const [profile, quote, metricsRaw, insiderRaw, peersRaw, earningsRaw, newsRaw, recRaw] =
    await Promise.all([
      // Optional so a throttled feed falls through to the backup instead of
      // throwing; a missing identity is caught below.
      finnhub<Record<string, unknown>>(apiKey, `/stock/profile2?symbol=${sym}`, true),
      finnhub<Record<string, number>>(apiKey, `/quote?symbol=${sym}`, true),
      // Metrics enrich the report but must not sink it when the tier throttles.
      finnhub<{ metric?: Record<string, number> }>(
        apiKey,
        `/stock/metric?symbol=${sym}&metric=all`,
        true
      ),
      finnhub<{ data?: Array<Record<string, unknown>> }>(
        apiKey,
        `/stock/insider-transactions?symbol=${sym}`,
        true
      ),
      finnhub<Array<{ symbol?: string; price?: number; pe?: number }>>(
        apiKey,
        `/stock/peers?symbol=${sym}`,
        true
      ),
      finnhub<{
        earningsCalendar?: Array<{ date?: string; hour?: string; symbol?: string }>;
      }>(
        apiKey,
        `/calendar/earnings?from=${earningsFrom}&to=${earningsTo}&symbol=${sym}`,
        true
      ),
      finnhub<Array<{ headline?: string; datetime?: number; source?: string; url?: string }>>(
        apiKey,
        `/company-news?symbol=${sym}&from=${fromDate}&to=${asOfEt}`,
        true
      ),
      finnhub<Array<Record<string, number | string>>>(
        apiKey,
        `/stock/recommendation?symbol=${sym}`,
        true
      ),
    ]);

  const hasProfile = Boolean(profile?.name || profile?.ticker);
  const hasQuote = num(quote?.c) != null;
  if (!hasProfile && !hasQuote) {
    const backup = await fetchBackupQuote(sym);
    if (!backup) throw new Error(`Unknown symbol: ${sym}`);
    return degradedPayload(sym, backup, asOf);
  }

  const m = metricsRaw?.metric ?? {};
  const autoPeerSymbols = Array.isArray(peersRaw)
    ? peersRaw.map((p) => p.symbol).filter(Boolean) as string[]
    : [];
  // Each peer costs another metric call; keep the burst small to avoid throttling.
  const peerSymbols = resolvePeerSymbols(sym, autoPeerSymbols).slice(0, 3);

  const peerMetrics = await Promise.all(
    peerSymbols.map((ps) =>
      finnhub<{ metric?: Record<string, number> }>(
        apiKey,
        `/stock/metric?symbol=${ps}&metric=all`,
        true
      )
    )
  );
  const peers: FundamentalsPayload["peers"] = peerSymbols.map((ps, i) => ({
    symbol: ps,
    pe: num(peerMetrics[i]?.metric?.peBasicExclExtraTTM ?? peerMetrics[i]?.metric?.peTTM),
    ps: num(peerMetrics[i]?.metric?.psTTM),
  }));

  const insiderRows = (insiderRaw?.data ?? []).slice(0, 10).map((row) => ({
    name: String(row.name ?? "Unknown"),
    transaction: String(row.transactionCode ?? row.transactionType ?? "—"),
    date: String(row.transactionDate ?? row.filingDate ?? "—"),
    shares: num(row.share),
  }));

  const nextCatalysts = catalystsFromCalendar(earningsRaw, sym, asOfEt);
  const sources = buildReportSources(
    sym,
    (profile?.weburl as string | undefined) ?? null
  );

  const news = (newsRaw ?? []).slice(0, 15).map((n) => {
    const sourceName = String(n.source ?? "News").trim() || "News";
    const shortLabel =
      sourceName.length > 18 ? sourceName.slice(0, 16) + "…" : sourceName;
    const url =
      typeof n.url === "string" && /^https?:\/\//i.test(n.url) ? n.url : null;
    return {
      headline: String(n.headline ?? ""),
      date: n.datetime
        ? nyseDateString(new Date(n.datetime * 1000))
        : asOfEt,
      source: sourceName,
      url,
      linkMd: url ? `[${shortLabel}](${url})` : null,
    };
  });

  const latestRec = Array.isArray(recRaw) && recRaw.length ? recRaw[0] : null;

  const marketCapRaw = num(profile?.marketCapitalization as number);
  const marketCap = marketCapRaw != null ? fmtCap(marketCapRaw * 1e6) : null;

  return {
    symbol: sym,
    name: String(profile?.name ?? sym),
    exchange: (profile?.exchange as string) ?? null,
    industry: (profile?.finnhubIndustry as string) ?? null,
    asOf: asOf.toISOString(),
    asOfEt,
    dataAgeHours: 0,
    dataQuality: "full",
    source: "finnhub",
    quote: {
      price: num(quote?.c),
      changePct: num(quote?.dp),
      marketCap,
    },
    valuation: {
      pe: num(m.peBasicExclExtraTTM ?? m.peTTM),
      forwardPe: num(m.peNormalizedAnnual),
      evEbitda: num(m.enterpriseValueOverEBITDA),
      ps: num(m.psTTM),
      pb: num(m.pbAnnual),
    },
    margins: {
      gross: num(m.grossMarginTTM),
      operating: num(m.operatingMarginTTM),
      net: num(m.netProfitMarginTTM),
    },
    growth: {
      revenueYoY: num(m.revenueGrowthQuarterlyYoy ?? m.revenueGrowth3Y),
      epsYoY: num(m.epsGrowthQuarterlyYoy ?? m.epsGrowth3Y),
    },
    cashFlow: {
      fcfPerShare: num(m.fcfPerShareTTM),
      fcfMargin: num(m.fcfMarginTTM),
    },
    insiders: {
      ownershipPct: null,
      recentTrades: insiderRows,
    },
    peers,
    nextCatalysts,
    sources,
    news,
    analystTrend: {
      period: latestRec?.period ? String(latestRec.period) : null,
      strongBuy: num(latestRec?.strongBuy),
      buy: num(latestRec?.buy),
      hold: num(latestRec?.hold),
      sell: num(latestRec?.sell),
      strongSell: num(latestRec?.strongSell),
    },
    _citation: citationWithSources(
      "Finnhub",
      asOfEt,
      sources,
      nyseTimestamp(asOf)
    ),
  };
}

function earningsNeedsRefresh(
  cached: FundamentalsPayload,
  asOfEt: string
): boolean {
  const date = cached.nextCatalysts?.earningsDate;
  // Legacy cache rows predate NYSE-localized catalysts — always re-check.
  if (!cached.nextCatalysts?.marketCalendar) return true;
  if (!date) return true;
  // Stale once the NYSE session day has moved past the print.
  if (date < asOfEt) return true;
  // A print more than ~5 weeks out often means we missed a nearer confirmed
  // date (e.g. NVDA tomorrow vs a November estimate still in the window).
  if (date > addCalendarDays(asOfEt, 35)) return true;
  return false;
}

export async function getFundamentalsCached(
  cache: KVNamespace,
  apiKey: string,
  symbol: string,
  ttlSeconds: number
): Promise<FundamentalsPayload> {
  const key = `fund:${symbol.toUpperCase()}`;
  const cached = await cache.get<FundamentalsPayload>(key, "json");
  if (cached) {
    const ageMs = Date.now() - new Date(cached.asOf).getTime();
    const asOfEt = nyseDateString();
    let nextCatalysts = cached.nextCatalysts ?? emptyCatalysts();

    // Earnings dates go stale overnight; refresh just the calendar when needed
    // so a warm fundamentals cache does not keep last quarter's November print.
    if (earningsNeedsRefresh(cached, asOfEt)) {
      const earningsFrom = addCalendarDays(asOfEt, -1);
      const earningsTo = addCalendarDays(asOfEt, 120);
      const earningsRaw = await finnhub<{
        earningsCalendar?: Array<{ date?: string; hour?: string; symbol?: string }>;
      }>(
        apiKey,
        `/calendar/earnings?from=${earningsFrom}&to=${earningsTo}&symbol=${symbol.toUpperCase()}`,
        true
      );
      if (earningsRaw) {
        nextCatalysts = catalystsFromCalendar(
          earningsRaw,
          symbol.toUpperCase(),
          asOfEt
        );
        const patched: FundamentalsPayload = {
          ...cached,
          asOfEt,
          nextCatalysts,
          dataAgeHours: Math.floor(ageMs / 3_600_000),
        };
        await cache
          .put(key, JSON.stringify({ ...patched, dataAgeHours: 0 }), {
            expirationTtl: ttlSeconds,
          })
          .catch(() => {});
        return patched;
      }
    }

    return {
      ...cached,
      asOfEt: cached.asOfEt ?? asOfEt,
      nextCatalysts,
      sources: cached.sources ?? buildReportSources(symbol.toUpperCase()),
      dataAgeHours: Math.floor(ageMs / 3_600_000),
    };
  }
  const fresh = await fetchFundamentals(apiKey, symbol);
  await cache.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
  return fresh;
}

export function isStalePayload(payloads: FundamentalsPayload[]): boolean {
  return payloads.some((p) => p.dataAgeHours >= 24);
}

export function oldestAsOf(payloads: FundamentalsPayload[]): string {
  // Prefer NYSE session date for the UI “as of” line.
  const withEt = payloads.map((p) => p.asOfEt).filter(Boolean);
  if (withEt.length) return withEt.reduce((a, b) => (a < b ? a : b));
  return payloads.reduce((a, b) => (a.asOf < b.asOf ? a : b)).asOf;
}
