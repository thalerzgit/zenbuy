import { cacheGet, fundCacheKey } from "./cache";
import type { FundamentalsPayload } from "./finnhub";
import { PEER_OVERRIDES } from "./peers";
import type { Scorecard } from "./parse";

const SCORE_KEYS: Array<keyof Scorecard> = [
  "growth",
  "moat",
  "management",
  "valuation",
  "balanceSheet",
  "catalysts",
  "overall",
];

/** Broader pool when peer overrides are thin. */
const UNIVERSE = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "META",
  "AMZN",
  "NVDA",
  "AMD",
  "AVGO",
  "INTC",
  "MRVL",
  "QCOM",
  "TSM",
  "ASML",
  "CRM",
  "NOW",
  "PANW",
  "CRWD",
  "NET",
  "PLTR",
  "SNOW",
  "UBER",
  "SHOP",
  "TSLA",
  "NFLX",
  "COST",
  "LLY",
  "UNH",
  "JPM",
  "V",
  "MA",
];

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

export async function findSimilarSymbols(
  env: Env,
  source: string,
  target: Scorecard,
  exclude: string[],
  limit = 3
): Promise<string[]> {
  const blocked = new Set(
    exclude.concat(source).map((s) => s.trim().toUpperCase()).filter(Boolean)
  );

  const sourceFund = await cacheGet<FundamentalsPayload>(
    env.CACHE,
    fundCacheKey(source)
  );
  const autoPeers = sourceFund?.peers?.map((p) => p.symbol) ?? [];
  const overridePeers = PEER_OVERRIDES[source.toUpperCase()] ?? [];

  const candidates = [
    ...new Set([...overridePeers, ...autoPeers, ...UNIVERSE]),
  ].filter((s) => !blocked.has(s.toUpperCase()));

  const targetVec = scoreVector(target);
  const ranked: Array<{ symbol: string; dist: number }> = [];

  for (const sym of candidates) {
    const cached = await cacheGet<FundamentalsPayload>(
      env.CACHE,
      fundCacheKey(sym)
    );
    const est: Scorecard = cached
      ? estimateScorecard(cached)
      : {
          growth: 5,
          moat: 5,
          management: 5,
          valuation: 5,
          balanceSheet: 5,
          catalysts: 5,
          overall: 5,
        };
    ranked.push({
      symbol: sym.toUpperCase(),
      dist: dist(scoreVector(est), targetVec),
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
