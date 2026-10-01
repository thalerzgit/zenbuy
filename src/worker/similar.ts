import { cacheGet, fundCacheKey } from "./cache";
import type { FundamentalsPayload } from "./finnhub";
import { PEER_OVERRIDES } from "./peers";
import type { Scorecard } from "./parse";
import { industriesSimilar } from "./similar-industry";

export { industriesSimilar, industryFamily, normalizeIndustry } from "./similar-industry";

const SCORE_KEYS: Array<keyof Scorecard> = [
  "growth",
  "moat",
  "management",
  "valuation",
  "balanceSheet",
  "catalysts",
  "overall",
];

/**
 * Modest multi-sector pool. Prefer Finnhub peers + PEER_OVERRIDES; this fills
 * gaps when cache is cold and keeps non-tech names in the candidate set.
 */
const UNIVERSE = [
  // Tech / semis / software (legacy core)
  "AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA", "AMD", "AVGO", "INTC",
  "MRVL", "QCOM", "TSM", "ASML", "CRM", "NOW", "ORCL", "PANW", "CRWD",
  "NET", "PLTR", "SNOW", "UBER", "SHOP", "TSLA", "NFLX",
  // Financials
  "JPM", "BAC", "WFC", "GS", "MS", "C", "USB", "PNC", "TFC", "BLK", "SCHW",
  "V", "MA", "AXP", "PYPL", "COF",
  // Healthcare
  "LLY", "UNH", "JNJ", "ABBV", "MRK", "NVO", "PFE", "AMGN", "ELV", "CI", "CVS",
  // Consumer / retail
  "COST", "WMT", "TGT", "HD", "NKE", "SBUX", "MCD", "BJ",
  // Energy / industrial
  "XOM", "CVX", "COP", "CAT", "GE", "HON",
];

export type SimilarOptions = {
  /** When true (default), prefer same/similar industry before score rank. */
  sector?: boolean;
  limit?: number;
};

export type SimilarResult = {
  symbols: string[];
  /** True when sector gate was skipped or yielded nothing usable. */
  widened: boolean;
};

function scoreVector(sc: Scorecard): number[] {
  return SCORE_KEYS.map((k) => sc[k] ?? 5);
}

function dist(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
}

/** Rough scorecard from fundamentals when we don't have an LLM report. */
export function estimateScorecard(f: FundamentalsPayload): Scorecard {
  const revYoY = f.growth?.revenueYoY ?? f.growth?.revenue3Y;
  const growth =
    revYoY != null
      ? Math.min(10, Math.max(1, Math.round(Math.min(revYoY, 80) / 8)))
      : 5;
  const gross = f.margins?.gross;
  const moat =
    gross != null
      ? Math.min(10, Math.max(1, Math.round(gross / 10)))
      : 5;
  const pe = f.valuation?.pe;
  const valuation =
    pe != null && pe > 0
      ? Math.min(10, Math.max(1, Math.round(11 - pe / 6)))
      : 5;
  const op = f.margins?.operating;
  const management =
    op != null
      ? Math.min(10, Math.max(1, Math.round(op / 8)))
      : 6;
  const balanceSheet = f.valuation?.pb != null && f.valuation.pb < 15 ? 8 : 6;
  const catalysts = f.nextCatalysts?.earningsDate ? 7 : 5;
  const overall = Math.round(
    (growth + moat + management + valuation + balanceSheet + catalysts) / 6
  );
  return {
    growth,
    moat,
    management,
    valuation,
    balanceSheet,
    catalysts,
    overall,
  };
}

function neutralScore(): Scorecard {
  return {
    growth: 5,
    moat: 5,
    management: 5,
    valuation: 5,
    balanceSheet: 5,
    catalysts: 5,
    overall: 5,
  };
}

async function rankCandidates(
  env: Env,
  candidates: string[],
  target: Scorecard,
  limit: number
): Promise<string[]> {
  const targetVec = scoreVector(target);
  const ranked: Array<{ symbol: string; dist: number }> = [];

  for (const sym of candidates) {
    const cached = await cacheGet<FundamentalsPayload>(
      env.CACHE,
      fundCacheKey(sym)
    );
    const est = cached ? estimateScorecard(cached) : neutralScore();
    // Light overall (verdict-ish) alignment: tiny tie-break when cheap.
    const overallDelta = Math.abs((est.overall ?? 5) - (target.overall ?? 5));
    ranked.push({
      symbol: sym.toUpperCase(),
      dist: dist(scoreVector(est), targetVec) + overallDelta * 0.05,
    });
  }

  ranked.sort((a, b) => a.dist - b.dist);
  const picked: string[] = [];
  for (const row of ranked) {
    if (picked.includes(row.symbol)) continue;
    picked.push(row.symbol);
    if (picked.length >= limit) break;
  }
  return picked;
}

export async function findSimilarSymbols(
  env: Env,
  source: string,
  target: Scorecard,
  exclude: string[],
  options: SimilarOptions = {}
): Promise<SimilarResult> {
  const useSector = options.sector !== false;
  const limit = options.limit ?? 3;
  const src = source.trim().toUpperCase();
  const blocked = new Set(
    exclude.concat(src).map((s) => s.trim().toUpperCase()).filter(Boolean)
  );

  const sourceFund = await cacheGet<FundamentalsPayload>(
    env.CACHE,
    fundCacheKey(src)
  );
  const autoPeers = sourceFund?.peers?.map((p) => p.symbol) ?? [];
  const overridePeers = PEER_OVERRIDES[src] ?? [];
  const trustedPeers = new Set(
    [...overridePeers, ...autoPeers].map((s) => s.toUpperCase())
  );
  const sourceIndustry = sourceFund?.industry ?? null;

  const allCandidates = [
    ...new Set([...overridePeers, ...autoPeers, ...UNIVERSE]),
  ]
    .map((s) => s.toUpperCase())
    .filter((s) => !blocked.has(s));

  if (!useSector) {
    const symbols = await rankCandidates(env, allCandidates, target, limit);
    return { symbols, widened: true };
  }

  // Sector path: prefer same/similar industry; trusted peers stay eligible
  // even when their fund cache (and thus industry) is cold.
  if (sourceIndustry) {
    const sectorPool: string[] = [];
    for (const sym of allCandidates) {
      if (trustedPeers.has(sym)) {
        sectorPool.push(sym);
        continue;
      }
      const cached = await cacheGet<FundamentalsPayload>(
        env.CACHE,
        fundCacheKey(sym)
      );
      if (cached?.industry && industriesSimilar(sourceIndustry, cached.industry)) {
        sectorPool.push(sym);
      }
    }
    const symbols = await rankCandidates(env, sectorPool, target, limit);
    if (symbols.length) return { symbols, widened: false };
    // Empty after sector gate → score-only escape; UI may skip Widen.
    const fallback = await rankCandidates(env, allCandidates, target, limit);
    return { symbols: fallback, widened: true };
  }

  // No source industry: peers + overrides only, then widen if empty.
  const peerOnly = allCandidates.filter((s) => trustedPeers.has(s));
  if (peerOnly.length) {
    const symbols = await rankCandidates(env, peerOnly, target, limit);
    if (symbols.length) return { symbols, widened: false };
  }
  const fallback = await rankCandidates(env, allCandidates, target, limit);
  return { symbols: fallback, widened: true };
}
