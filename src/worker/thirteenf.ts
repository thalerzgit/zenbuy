import { cacheGet, cacheSet } from "./cache";
import { addCalendarDays, nyseDateString } from "./market-time";

/** Name fragments matched against Finnhub institutional holder names. */
const LEGEND_FUNDS: Array<{ id: string; label: string; match: RegExp }> = [
  { id: "berkshire", label: "Berkshire Hathaway", match: /BERKSHIRE/i },
  { id: "baupost", label: "Baupost", match: /BAUPOST/i },
  { id: "bridgewater", label: "Bridgewater", match: /BRIDGEWATER/i },
  { id: "pershing", label: "Pershing Square", match: /PERSHING SQUARE/i },
  { id: "tiger", label: "Tiger Global", match: /TIGER GLOBAL/i },
  { id: "renaissance", label: "Renaissance", match: /RENAISSANCE/i },
  { id: "appaloosa", label: "Appaloosa (Tepper)", match: /APPALOOSA|TEPPER/i },
  { id: "duquesne", label: "Duquesne (Druckenmiller)", match: /DUQUESNE|DRUCKENMILLER/i },
  { id: "third_point", label: "Third Point", match: /THIRD POINT/i },
  { id: "elliott", label: "Elliott", match: /ELLIOTT/i },
  { id: "dodge_cox", label: "Dodge & Cox", match: /DODGE.*COX/i },
  { id: "millennium", label: "Millennium", match: /MILLENNIUM/i },
];

export interface LegendaryHolderMatch {
  fund: string;
  holderName: string;
  shares: number | null;
  changeShares: number | null;
  filingDate: string | null;
}

export interface Institutional13FContext {
  asOf: string;
  /** Legendary superinvestor matches in latest institutional filing window. */
  legendaryHolders: LegendaryHolderMatch[];
  totalInstitutionalRows: number;
  note: string;
  _citation: string;
}

const TTL_SECONDS = 86_400;

async function finnhubInstitutional(
  apiKey: string,
  symbol: string,
  from: string,
  to: string
): Promise<Array<Record<string, unknown>> | null> {
  const keys = apiKey
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!keys.length) return null;

  const url =
    `https://finnhub.io/api/v1/stock/institutional-ownership?symbol=${encodeURIComponent(symbol)}` +
    `&from=${from}&to=${to}&token=${keys[0]}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return body.data ?? [];
  } catch {
    return null;
  }
}

function matchLegendFunds(
  rows: Array<Record<string, unknown>>
): LegendaryHolderMatch[] {
  const matches: LegendaryHolderMatch[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const name = String(row.name ?? row.investor ?? "");
    if (!name) continue;
    for (const fund of LEGEND_FUNDS) {
      if (!fund.match.test(name) || seen.has(fund.id)) continue;
      seen.add(fund.id);
      matches.push({
        fund: fund.label,
        holderName: name,
        shares: num(row.share ?? row.shares),
        changeShares: num(row.change),
        filingDate: row.filingDate ? String(row.filingDate) : null,
      });
      break;
    }
  }

  return matches;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(0) : null;
}

export async function getInstitutional13FCached(
  kv: KVNamespace,
  apiKey: string,
  symbol: string
): Promise<Institutional13FContext | null> {
  const sym = symbol.toUpperCase();
  const key = `13f:${sym}`;
  const cached = await cacheGet<Institutional13FContext>(kv, key);
  if (cached) return cached;

  const asOfEt = nyseDateString();
  const from = addCalendarDays(asOfEt, -540);
  const rows = await finnhubInstitutional(apiKey, sym, from, asOfEt);
  if (!rows) return null;

  const legendaryHolders = matchLegendFunds(rows);
  const note =
    legendaryHolders.length > 0
      ? `${legendaryHolders.length} legendary fund(s) reported in institutional filings (13F lag ~45 days).`
      : "No legendary superinvestor matches in institutional feed for this symbol.";

  const ctx: Institutional13FContext = {
    asOf: asOfEt,
    legendaryHolders,
    totalInstitutionalRows: rows.length,
    note,
    _citation: `Fact · [SEC 13F](https://www.sec.gov/edgar/search/) · ${asOfEt}`,
  };

  await cacheSet(kv, key, ctx, TTL_SECONDS).catch(() => {});
  return ctx;
}
