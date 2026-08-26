import { cacheGet, cacheSet } from "./cache";

const FRED_BASE = "https://api.stlouisfed.org/fred";

export interface MacroSeriesPoint {
  id: string;
  label: string;
  value: number | null;
  asOf: string | null;
  /** Percent change vs prior observation when computable. */
  changePct: number | null;
}

export interface MacroSnapshot {
  asOf: string;
  series: MacroSeriesPoint[];
  _citation: string;
}

export interface LongHorizonArchive {
  asOf: string;
  /** Latest USREC observation: 1 = in recession, 0 = expansion. */
  inRecession: boolean | null;
  recessionHistory: string;
  realGdpYoYPct: number | null;
  m2YoYPct: number | null;
  sp500Return10yPct: number | null;
  treasury10yPct: number | null;
  summary: string;
  _citation: string;
}

const MACRO_SERIES: Array<{ id: string; label: string }> = [
  { id: "DGS10", label: "10Y Treasury" },
  { id: "T10Y2Y", label: "10Y–2Y spread" },
  { id: "CPIAUCSL", label: "CPI index" },
  { id: "UNRATE", label: "Unemployment" },
  { id: "GDPC1", label: "Real GDP" },
  { id: "FEDFUNDS", label: "Fed funds" },
  { id: "VIXCLS", label: "VIX" },
];

const MACRO_TTL = 43_200; // 12h
const ARCHIVE_TTL = 604_800; // 7d

function num(v: unknown): number | null {
  if (v == null || v === ".") return null;
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(4) : null;
}

async function fredObservations(
  apiKey: string,
  seriesId: string,
  limit = 14
): Promise<Array<{ date: string; value: number | null }>> {
  const url =
    `${FRED_BASE}/series/observations?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=${limit}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      observations?: Array<{ date?: string; value?: string }>;
    };
    return (body.observations ?? [])
      .map((o) => ({
        date: String(o.date ?? ""),
        value: num(o.value),
      }))
      .filter((o) => o.date && o.value != null);
  } catch {
    return [];
  }
}

function yoyFromMonthly(
  rows: Array<{ date: string; value: number | null }>
): number | null {
  if (rows.length < 13 || rows[0].value == null || rows[12].value == null) {
    return null;
  }
  const latest = rows[0].value!;
  const yearAgo = rows[12].value!;
  if (yearAgo === 0) return null;
  return +(((latest - yearAgo) / Math.abs(yearAgo)) * 100).toFixed(2);
}

function pctChange(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null || prior === 0) return null;
  return +(((latest - prior) / Math.abs(prior)) * 100).toFixed(2);
}

function buildMacroSeries(
  id: string,
  label: string,
  rows: Array<{ date: string; value: number | null }>
): MacroSeriesPoint {
  const latest = rows[0];
  let changePct: number | null = null;
  if (id === "CPIAUCSL") {
    changePct = yoyFromMonthly(rows);
  } else if (rows.length >= 2) {
    changePct = pctChange(latest?.value ?? null, rows[1]?.value ?? null);
  }
  return {
    id,
    label,
    value: latest?.value ?? null,
    asOf: latest?.date ?? null,
    changePct,
  };
}

export async function getMacroCached(
  kv: KVNamespace,
  apiKey: string | undefined
): Promise<MacroSnapshot | null> {
  if (!apiKey?.trim()) return null;

  const cached = await cacheGet<MacroSnapshot>(kv, "macro:v1");
  if (cached) return cached;

  const fetched = await Promise.all(
    MACRO_SERIES.map(async ({ id, label }) => {
      const rows = await fredObservations(apiKey, id, id === "CPIAUCSL" ? 14 : 3);
      return buildMacroSeries(id, label, rows);
    })
  );

  const asOf = new Date().toISOString().slice(0, 10);
  const snapshot: MacroSnapshot = {
    asOf,
    series: fetched,
    _citation: `Fact · [FRED](https://fred.stlouisfed.org/) · ${asOf}`,
  };

  await cacheSet(kv, "macro:v1", snapshot, MACRO_TTL).catch(() => {});
  return snapshot;
}

function recessionSummary(
  rows: Array<{ date: string; value: number | null }>
): { inRecession: boolean | null; history: string } {
  const latest = rows[0];
  const inRecession = latest?.value == null ? null : latest.value >= 0.5;
  const starts = rows
    .filter((r) => r.value != null && r.value >= 0.5)
    .slice(0, 6)
    .map((r) => r.date.slice(0, 4));
  const unique = [...new Set(starts)];
  const history =
    unique.length > 0
      ? `US recession flags since 1854 — recent starts: ${unique.join(", ")}`
      : "US recession series (USREC) — long-horizon expansion/recession flags";
  return { inRecession, history };
}

export async function getLongHorizonArchiveCached(
  kv: KVNamespace,
  apiKey: string | undefined
): Promise<LongHorizonArchive | null> {
  if (!apiKey?.trim()) return null;

  const cached = await cacheGet<LongHorizonArchive>(kv, "archive:macro:v1");
  if (cached) return cached;

  const [usrec, gdp, m2, sp, dgs10] = await Promise.all([
    fredObservations(apiKey, "USREC", 120),
    fredObservations(apiKey, "GDPC1", 6),
    fredObservations(apiKey, "M2SL", 14),
    fredObservations(apiKey, "SP500", 130),
    fredObservations(apiKey, "DGS10", 2),
  ]);

  const { inRecession, history } = recessionSummary(usrec);
  const realGdpYoYPct =
    gdp.length >= 5 && gdp[0].value != null && gdp[4].value != null
      ? pctChange(gdp[0].value, gdp[4].value)
      : null;
  const m2YoYPct = yoyFromMonthly(m2);
  const sp500Return10yPct =
    sp.length >= 120 && sp[0].value != null && sp[119].value != null
      ? pctChange(sp[0].value, sp[119].value)
      : sp.length >= 60 && sp[0].value != null && sp[59].value != null
        ? pctChange(sp[0].value, sp[59].value)
        : null;

  const treasury10yPct = dgs10[0]?.value ?? null;
  const recessionWord =
    inRecession == null ? "recession status unknown" : inRecession ? "in recession" : "expansion";
  const summary = [
    `Macro regime: ${recessionWord}.`,
    realGdpYoYPct != null ? `Real GDP ~${realGdpYoYPct}% vs ~4q ago.` : null,
    m2YoYPct != null ? `M2 ~${m2YoYPct}% YoY.` : null,
    sp500Return10yPct != null ? `S&P 500 ~${sp500Return10yPct}% over available long window.` : null,
    treasury10yPct != null ? `10Y ~${treasury10yPct}%.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const asOf = new Date().toISOString().slice(0, 10);
  const archive: LongHorizonArchive = {
    asOf,
    inRecession,
    recessionHistory: history,
    realGdpYoYPct,
    m2YoYPct,
    sp500Return10yPct,
    treasury10yPct,
    summary,
    _citation: `Fact · [FRED](https://fred.stlouisfed.org/) · ${asOf}`,
  };

  await cacheSet(kv, "archive:macro:v1", archive, ARCHIVE_TTL).catch(() => {});
  return archive;
}
