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

export function reportCacheKey(mode: string, symbols: string[]): string {
  const sorted = [...symbols].map((s) => s.toUpperCase()).sort();
  return `report:${mode}:${sorted.join(",")}`;
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
