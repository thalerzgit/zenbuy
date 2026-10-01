export const PEER_OVERRIDES: Record<string, string[]> = {
  AAPL: ["MSFT", "GOOGL", "META"],
  MSFT: ["AAPL", "GOOGL", "ORCL"],
  GOOGL: ["META", "MSFT", "AMZN"],
  AMZN: ["WMT", "SHOP", "GOOGL"],
  NVDA: ["AMD", "AVGO", "INTC"],
  CSCO: ["ANET", "JNPR", "HPE"],
  PANW: ["CRWD", "FTNT", "ZS"],
  NET: ["AKAM", "FSLY", "CFLT"],
  TSLA: ["F", "GM", "RIVN"],
  // Banks / capital markets — keep "Show more like this" in-sector for JPM etc.
  JPM: ["BAC", "WFC", "GS", "MS", "C"],
  BAC: ["JPM", "WFC", "C", "PNC"],
  WFC: ["JPM", "BAC", "C", "USB"],
  GS: ["MS", "JPM", "BAC", "BLK"],
  MS: ["GS", "JPM", "SCHW", "BAC"],
  C: ["JPM", "BAC", "WFC", "USB"],
  USB: ["PNC", "WFC", "BAC", "TFC"],
  PNC: ["USB", "TFC", "BAC", "WFC"],
  BLK: ["BN", "SCHW", "MS", "GS"],
  SCHW: ["MS", "BLK", "AMP", "RJ"],
  V: ["MA", "AXP", "PYPL"],
  MA: ["V", "AXP", "PYPL"],
  AXP: ["V", "MA", "COF"],
  LLY: ["NVO", "JNJ", "ABBV", "MRK"],
  UNH: ["ELV", "CI", "CVS"],
  COST: ["WMT", "TGT", "BJ"],
  XOM: ["CVX", "COP", "BP"],
  CVX: ["XOM", "COP", "BP"],
};

export function resolvePeerSymbols(symbol: string, autoPeers: string[]): string[] {
  const override = PEER_OVERRIDES[symbol.toUpperCase()];
  if (override?.length) return override.slice(0, 5);
  return autoPeers.filter((p) => p.toUpperCase() !== symbol.toUpperCase()).slice(0, 5);
}
