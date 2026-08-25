/**
 * Keyless backup quote feed.
 *
 * Used only when Finnhub can't answer for a symbol (exhausted rate limit,
 * outage, or an unknown ticker). Yahoo's chart endpoint needs no key and is
 * reachable from Cloudflare's egress, but it only carries price and identity
 * data — no valuation, margins, insiders or peers. A report built on it is
 * marked degraded so the analysis can say so instead of guessing.
 */

export interface BackupQuote {
  name: string | null;
  price: number | null;
  changePct: number | null;
  exchange: string | null;
  currency: string | null;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchBackupQuote(
  symbol: string
): Promise<BackupQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=5d&interval=1d`;

  try {
    const res = await fetch(url, {
      headers: {
        // Yahoo rejects requests without a browser-ish agent.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "application/json",
      },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      chart?: { result?: Array<{ meta?: Record<string, unknown> }> };
    };
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = numOrNull(meta.regularMarketPrice);
    const prev = numOrNull(meta.chartPreviousClose ?? meta.previousClose);
    if (price == null && prev == null) return null;

    return {
      name:
        (meta.longName as string) ??
        (meta.shortName as string) ??
        null,
      price,
      changePct:
        price != null && prev != null && prev !== 0
          ? +(((price - prev) / prev) * 100).toFixed(4)
          : null,
      exchange: (meta.fullExchangeName as string) ?? null,
      currency: (meta.currency as string) ?? null,
    };
  } catch {
    return null;
  }
}
