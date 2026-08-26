import type { InvestmentDirectiveId } from "../lib/investment-directives";
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

import { DEFAULT_DIRECTIVE_ID, isInvestmentDirectiveId } from "../lib/investment-directives";

export function reportCacheKey(
  mode: string,
  symbols: string[],
  directive: InvestmentDirectiveId = DEFAULT_DIRECTIVE_ID,
  profitHorizonYears?: number
): string {
  const sorted = [...symbols].map((s) => s.toUpperCase()).sort();
  const horizon =
    profitHorizonYears != null && Number.isFinite(profitHorizonYears)
      ? `:h${Math.round(profitHorizonYears)}`
      : "";
  return `report:${mode}:${directive}${horizon}:${sorted.join(",")}`;
}

export function parseReportCacheKey(reportId: string): {
  mode: string;
  directive: InvestmentDirectiveId;
  profitHorizonYears?: number;
  symbols: string[];
} {
  const parts = reportId.split(":");
  const mode = parts[1] ?? "separate";

  // report:separate:growth:h12:AAPL,MSFT
  if (parts.length >= 5 && isInvestmentDirectiveId(parts[2])) {
    const horizonPart = parts[3] ?? "";
    const profitHorizonYears = horizonPart.startsWith("h")
      ? Number(horizonPart.slice(1))
      : undefined;
    return {
      mode,
      directive: parts[2],
      profitHorizonYears: Number.isFinite(profitHorizonYears)
        ? profitHorizonYears
        : undefined,
      symbols: (parts[4] ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    };
  }

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

export function reportArchiveKey(
  directive: InvestmentDirectiveId,
  symbol: string
): string {
  return `hist:${directive}:${symbol.toUpperCase()}`;
}

export interface ReportArchiveEntry {
  asOf: string;
  verdict: string | null;
  overallScore: number | null;
}

const ARCHIVE_MAX_ENTRIES = 5;
const ARCHIVE_TTL_SECONDS = 365 * 86_400;

export async function getReportArchive(
  kv: KVNamespace,
  directive: InvestmentDirectiveId,
  symbol: string
): Promise<ReportArchiveEntry[]> {
  return (await cacheGet<ReportArchiveEntry[]>(
    kv,
    reportArchiveKey(directive, symbol)
  )) ?? [];
}

export async function appendReportArchive(
  kv: KVNamespace,
  directive: InvestmentDirectiveId,
  symbol: string,
  entry: ReportArchiveEntry
): Promise<void> {
  const key = reportArchiveKey(directive, symbol);
  const prior = await getReportArchive(kv, directive, symbol);
  const next = [entry, ...prior.filter((e) => e.asOf !== entry.asOf)].slice(
    0,
    ARCHIVE_MAX_ENTRIES
  );
  await cacheSet(kv, key, next, ARCHIVE_TTL_SECONDS);
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
