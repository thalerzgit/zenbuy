/** Strip punctuation / case for industry compares. */
export function normalizeIndustry(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Soft industry / sector family. Banks↔capital markets↔payments stay together;
 * exact Finnhub strings still match via normalize + token overlap.
 */
export function industryFamily(raw: string | null | undefined): string | null {
  const n = normalizeIndustry(raw);
  if (!n) return null;
  if (
    /\bbank/.test(n) ||
    n.includes("capital market") ||
    n.includes("credit service") ||
    n.includes("financial data") ||
    n.includes("asset management") ||
    n.includes("insurance") ||
    n.includes("payment")
  ) {
    return "financials";
  }
  if (n.includes("semiconductor") || n.includes("electronic component")) {
    return "semiconductors";
  }
  if (
    n.includes("software") ||
    n.includes("information technology") ||
    n.includes("internet content") ||
    n.includes("interactive media") ||
    n.includes("consumer electronic")
  ) {
    return "tech-software";
  }
  if (
    n.includes("drug") ||
    n.includes("biotech") ||
    n.includes("pharma") ||
    n.includes("health care") ||
    n.includes("healthcare") ||
    n.includes("medical")
  ) {
    return "healthcare";
  }
  if (
    n.includes("retail") ||
    n.includes("grocery") ||
    n.includes("discount store") ||
    n.includes("department store") ||
    n.includes("restaurants") ||
    n.includes("apparel")
  ) {
    return "consumer-retail";
  }
  if (n.includes("oil") || n.includes("gas") || n.includes("energy")) {
    return "energy";
  }
  if (
    n.includes("auto") ||
    n.includes("automaker") ||
    n.includes("automobile")
  ) {
    return "auto";
  }
  return n;
}

export function industriesSimilar(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const fa = industryFamily(a);
  const fb = industryFamily(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const na = normalizeIndustry(a);
  const nb = normalizeIndustry(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const stop = new Set(["and", "or", "the", "of", "services", "products", "inc"]);
  const ta = na.split(/\s+/).filter((t) => t.length > 2 && !stop.has(t));
  const tb = new Set(nb.split(/\s+/).filter((t) => t.length > 2 && !stop.has(t)));
  return ta.some((t) => t.length >= 4 && tb.has(t));
}
