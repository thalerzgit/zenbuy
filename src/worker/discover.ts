import { cacheGet, cacheSet, fundCacheKey } from "./cache";
import type { InvestmentDirectiveId } from "../lib/investment-directives";
import { getInvestmentDirective } from "../lib/investment-directives";
import {
  getFundamentalsCached,
  type FundamentalsPayload,
} from "./finnhub";

export interface DiscoverPick {
  symbol: string;
  name: string;
  fitScore: number;
  reason: string;
  profitHorizonYears: number;
  snapshot: {
    price: number | null;
    pe: number | null;
    revenueYoY: number | null;
    dividendYieldPct: number | null;
  };
}

const DISCOVER_CACHE_TTL = 43_200; // 12h

const POOLS: Record<InvestmentDirectiveId, string[]> = {
  aggressive_growth: [
    "NVDA",
    "AMD",
    "PLTR",
    "SNOW",
    "NET",
    "CRWD",
    "PANW",
    "MRVL",
    "AVGO",
    "TSLA",
    "UBER",
    "SHOP",
    "SNOW",
    "NOW",
  ],
  growth: [
    "AAPL",
    "MSFT",
    "GOOGL",
    "META",
    "AMZN",
    "CRM",
    "NOW",
    "NVDA",
    "LLY",
    "NFLX",
    "UBER",
    "SHOP",
    "AVGO",
    "COST",
  ],
  growth_income: [
    "AAPL",
    "MSFT",
    "JPM",
    "V",
    "MA",
    "AVGO",
    "COST",
    "UNH",
    "HD",
    "KO",
    "PEP",
    "MCD",
    "TXN",
    "IBM",
  ],
  value_income: [
    "JNJ",
    "PG",
    "KO",
    "PEP",
    "T",
    "VZ",
    "IBM",
    "CVX",
    "XOM",
    "MO",
    "BMY",
    "GILD",
    "CSCO",
    "INTC",
  ],
  conservative: [
    "JNJ",
    "PG",
    "KO",
    "WMT",
    "PEP",
    "MCD",
    "COST",
    "V",
    "JPM",
    "UNH",
    "BRK.B",
    "MSFT",
    "AAPL",
    "NEE",
  ],
};

function horizonWeights(years: number): {
  growth: number;
  income: number;
  value: number;
  stability: number;
} {
  if (years <= 3) return { growth: 0.15, income: 0.35, value: 0.3, stability: 0.2 };
  if (years <= 5) return { growth: 0.25, income: 0.35, value: 0.25, stability: 0.15 };
  if (years <= 10) return { growth: 0.4, income: 0.25, value: 0.2, stability: 0.15 };
  if (years <= 15) return { growth: 0.55, income: 0.2, value: 0.15, stability: 0.1 };
  return { growth: 0.7, income: 0.12, value: 0.1, stability: 0.08 };
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, n));
}

function normGrowth(yoy: number | null | undefined): number {
  if (yoy == null) return 40;
  return clamp(Math.round(Math.min(yoy, 60) / 60 * 100));
}

function normIncome(yieldPct: number | null | undefined): number {
  if (yieldPct == null || yieldPct <= 0) return 15;
  return clamp(Math.round(Math.min(yieldPct, 6) / 6 * 100));
}

function normValue(pe: number | null | undefined): number {
  if (pe == null || pe <= 0) return 45;
  if (pe <= 12) return 95;
  if (pe <= 18) return 80;
  if (pe <= 25) return 60;
  if (pe <= 35) return 40;
  return 20;
}

function normStability(f: FundamentalsPayload): number {
  const op = f.margins?.operating;
  const gross = f.margins?.gross;
  const chg = Math.abs(f.quote?.changePct ?? 0);
  let score = 50;
  if (op != null) score += clamp(op / 2, 0, 25);
  if (gross != null) score += clamp(gross / 4, 0, 15);
  score -= clamp(chg, 0, 20);
  return clamp(score);
}

function directiveBias(
  directive: InvestmentDirectiveId,
  f: FundamentalsPayload
): number {
  const rev = f.growth?.revenueYoY;
  const pe = f.valuation?.pe;
  const div = f.capitalReturn?.dividendYieldPct;
  switch (directive) {
    case "aggressive_growth":
      return clamp(normGrowth(rev) * 0.7 + (pe != null && pe > 25 ? 20 : 0));
    case "growth":
      return clamp(normGrowth(rev) * 0.55 + normValue(pe) * 0.25 + 20);
    case "growth_income":
      return clamp(normGrowth(rev) * 0.35 + normIncome(div) * 0.45 + 15);
    case "value_income":
      return clamp(normValue(pe) * 0.45 + normIncome(div) * 0.45);
    case "conservative":
      return clamp(normStability(f) * 0.5 + normIncome(div) * 0.3 + normValue(pe) * 0.2);
    default:
      return 50;
  }
}

function buildReason(
  directive: InvestmentDirectiveId,
  f: FundamentalsPayload,
  profitYears: number
): string {
  const parts: string[] = [];
  const rev = f.growth?.revenueYoY;
  const pe = f.valuation?.pe;
  const div = f.capitalReturn?.dividendYieldPct;
  const label = getInvestmentDirective(directive).label;

  if (rev != null && rev >= 15) parts.push(`${rev.toFixed(0)}% revenue growth`);
  else if (rev != null && rev >= 5) parts.push(`steady ${rev.toFixed(0)}% growth`);
  if (div != null && div >= 1.5) parts.push(`${div.toFixed(1)}% yield`);
  if (pe != null && pe > 0 && pe <= 18) parts.push(`P/E ${pe.toFixed(0)}`);
  if (f.industry) parts.push(f.industry);

  const window =
    profitYears <= 3
      ? "short-term"
      : profitYears <= 5
        ? "near-term"
        : profitYears <= 10
          ? "medium-term"
          : "long-term";
  const core = parts.length ? parts.slice(0, 3).join(" · ") : "quality fundamentals";
  return `Fits ${label} (${window} ~${profitYears}y): ${core}.`;
}

function scoreFundamental(
  f: FundamentalsPayload,
  directive: InvestmentDirectiveId,
  profitYears: number
): number {
  const w = horizonWeights(profitYears);
  const blended =
    normGrowth(f.growth?.revenueYoY) * w.growth +
    normIncome(f.capitalReturn?.dividendYieldPct) * w.income +
    normValue(f.valuation?.pe) * w.value +
    normStability(f) * w.stability;
  const bias = directiveBias(directive, f);
  return Math.round(clamp(blended * 0.55 + bias * 0.45));
}

async function loadFundamental(
  env: Env,
  symbol: string,
  ttl: number
): Promise<FundamentalsPayload | null> {
  const cached = await cacheGet<FundamentalsPayload>(
    env.CACHE,
    fundCacheKey(symbol)
  );
  if (cached?.dataQuality === "full") return cached;

  if (!env.FINNHUB_API_KEY) return cached;

  try {
    return await getFundamentalsCached(
      env.CACHE,
      env.FINNHUB_API_KEY,
      symbol,
      ttl
    );
  } catch {
    return cached;
  }
}

export async function discoverPicksForGoal(
  env: Env,
  directive: InvestmentDirectiveId,
  profitHorizonYears: number,
  limit = 4
): Promise<DiscoverPick[]> {
  const cacheKey = `discover:${directive}:h${profitHorizonYears}:${limit}`;
  const cached = await cacheGet<DiscoverPick[]>(env.CACHE, cacheKey);
  if (cached?.length) return cached;

  const pool = [...new Set(POOLS[directive] ?? POOLS.growth)];
  const ttl = Number(env.CACHE_TTL_SECONDS || 86400);

  const fundamentals = await Promise.all(
    pool.map(async (sym) => {
      const f = await loadFundamental(env, sym, ttl);
      return f ? { sym, f } : null;
    })
  );

  const ranked = fundamentals
    .filter((row): row is { sym: string; f: FundamentalsPayload } => row != null)
    .map(({ sym, f }) => ({
      symbol: sym.toUpperCase(),
      name: f.name || sym,
      fitScore: scoreFundamental(f, directive, profitHorizonYears),
      reason: buildReason(directive, f, profitHorizonYears),
      profitHorizonYears,
      snapshot: {
        price: f.quote?.price ?? null,
        pe: f.valuation?.pe ?? null,
        revenueYoY: f.growth?.revenueYoY ?? null,
        dividendYieldPct: f.capitalReturn?.dividendYieldPct ?? null,
      },
    }))
    .sort((a, b) => b.fitScore - a.fitScore);

  const picks = ranked.slice(0, limit);
  if (picks.length) {
    await cacheSet(env.CACHE, cacheKey, picks, DISCOVER_CACHE_TTL).catch(() => {});
  }
  return picks;
}
