import { resolvePeerSymbols } from "./peers";

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
  nextCatalysts: { earningsDate: string | null };
  news: Array<{ headline: string; date: string; source: string; url: string | null }>;
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

async function finnhub<T>(
  apiKey: string,
  path: string,
  optional = false
): Promise<T | null> {
  const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (optional) return null;
    throw new Error(`Finnhub ${res.status} on ${path.split("?")[0]}`);
  }
  return res.json() as Promise<T>;
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

export async function fetchFundamentals(
  apiKey: string,
  symbol: string
): Promise<FundamentalsPayload> {
  const sym = symbol.toUpperCase();
  const asOf = new Date();
  const fromDate = new Date(asOf.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const toDate = asOf.toISOString().slice(0, 10);

  const [profile, quote, metricsRaw, insiderRaw, peersRaw, earningsRaw, newsRaw, recRaw] =
    await Promise.all([
      finnhub<Record<string, unknown>>(apiKey, `/stock/profile2?symbol=${sym}`),
      finnhub<Record<string, number>>(apiKey, `/quote?symbol=${sym}`),
      finnhub<{ metric?: Record<string, number> }>(
        apiKey,
        `/stock/metric?symbol=${sym}&metric=all`
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
      finnhub<{ earningsCalendar?: Array<{ date?: string; symbol?: string }> }>(
        apiKey,
        `/calendar/earnings?from=${toDate}&to=${new Date(asOf.getTime() + 120 * 864e5).toISOString().slice(0, 10)}&symbol=${sym}`,
        true
      ),
      finnhub<Array<{ headline?: string; datetime?: number; source?: string; url?: string }>>(
        apiKey,
        `/company-news?symbol=${sym}&from=${fromDate}&to=${toDate}`,
        true
      ),
      finnhub<Array<Record<string, number | string>>>(
        apiKey,
        `/stock/recommendation?symbol=${sym}`,
        true
      ),
    ]);

  if (!profile?.name && !profile?.ticker) {
    throw new Error(`Unknown symbol: ${sym}`);
  }

  const m = metricsRaw?.metric ?? {};
  const autoPeerSymbols = Array.isArray(peersRaw)
    ? peersRaw.map((p) => p.symbol).filter(Boolean) as string[]
    : [];
  const peerSymbols = resolvePeerSymbols(sym, autoPeerSymbols);

  const peers: FundamentalsPayload["peers"] = [];
  for (const ps of peerSymbols) {
    const pm = await finnhub<{ metric?: Record<string, number> }>(
      apiKey,
      `/stock/metric?symbol=${ps}&metric=all`,
      true
    );
    peers.push({
      symbol: ps,
      pe: num(pm?.metric?.peBasicExclExtraTTM ?? pm?.metric?.peTTM),
      ps: num(pm?.metric?.psTTM),
    });
  }

  const insiderRows = (insiderRaw?.data ?? []).slice(0, 10).map((row) => ({
    name: String(row.name ?? "Unknown"),
    transaction: String(row.transactionCode ?? row.transactionType ?? "—"),
    date: String(row.transactionDate ?? row.filingDate ?? "—"),
    shares: num(row.share),
  }));

  const earningsDate =
    earningsRaw?.earningsCalendar?.find((e) => e.symbol === sym)?.date ?? null;

  const news = (newsRaw ?? []).slice(0, 15).map((n) => ({
    headline: String(n.headline ?? ""),
    date: n.datetime
      ? new Date(n.datetime * 1000).toISOString().slice(0, 10)
      : toDate,
    source: String(n.source ?? "Finnhub"),
    url: n.url ?? null,
  }));

  const latestRec = Array.isArray(recRaw) && recRaw.length ? recRaw[0] : null;

  const marketCapRaw = num(profile.marketCapitalization as number);
  const marketCap = marketCapRaw != null ? fmtCap(marketCapRaw * 1e6) : null;

  return {
    symbol: sym,
    name: String(profile.name ?? sym),
    exchange: (profile.exchange as string) ?? null,
    industry: (profile.finnhubIndustry as string) ?? null,
    asOf: asOf.toISOString(),
    dataAgeHours: 0,
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
    nextCatalysts: { earningsDate },
    news,
    analystTrend: {
      period: latestRec?.period ? String(latestRec.period) : null,
      strongBuy: num(latestRec?.strongBuy),
      buy: num(latestRec?.buy),
      hold: num(latestRec?.hold),
      sell: num(latestRec?.sell),
      strongSell: num(latestRec?.strongSell),
    },
    _citation: `Fact · Finnhub · ${asOf.toISOString().slice(0, 10)}`,
  };
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
    return {
      ...cached,
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
  return payloads.reduce((a, b) => (a.asOf < b.asOf ? a : b)).asOf;
}
