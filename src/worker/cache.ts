import type { Badges } from "./parse";

export async function cacheGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key, "json");
  return (raw as T) ?? null;
}

export async function cacheSet(
  kv: KVNamespace,
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
}

import type { InvestmentDirectiveId } from "../lib/investment-directives";
import { DEFAULT_DIRECTIVE_ID, isInvestmentDirectiveId } from "../lib/investment-directives";

export function reportCacheKey(
  mode: string,
  symbols: string[],
  directive: InvestmentDirectiveId = DEFAULT_DIRECTIVE_ID
): string {
  const sorted = [...symbols].map((s) => s.toUpperCase()).sort();
  return `report:${mode}:${directive}:${sorted.join(",")}`;
}

export function parseReportCacheKey(reportId: string): {
  mode: string;
  directive: InvestmentDirectiveId;
  symbols: string[];
} {
  const parts = reportId.split(":");
  const mode = parts[1] ?? "separate";

  if (parts.length >= 4 && isInvestmentDirectiveId(parts[2])) {
    return {
      mode,
      directive: parts[2],
      symbols: (parts[3] ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    };
  }

  // Legacy keys: report:separate:NVDA (pre-directive)
  return {
    mode,
    directive: "aggressive_growth",
    symbols: (parts[2] ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  };
}

export function fundCacheKey(symbol: string): string {
  return `fund:${symbol.toUpperCase()}`;
}

export function rateLimitKey(ip: string): string {
  return `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
}

export interface CachedReport {
  markdown: string;
  badges: Badges;
  bottomLineHtml: string;
  bodyHtml: string;
  scorecardHtml: string;
  asOf: string;
  stale: boolean;
}

/** Immutable snapshot for a single share link (7-day TTL). */
export interface SharedReportSnapshot {
  reportId: string;
  variant: "full" | "layman";
  mode: string;
  symbols: string[];
  badges: Badges;
  bottomLineHtml: string;
  bodyHtml: string;
  scorecardHtml: string;
  asOf: string;
  stale: boolean;
}

export const SHARE_TTL_SECONDS = 7 * 86_400;
