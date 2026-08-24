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
};

export function resolvePeerSymbols(symbol: string, autoPeers: string[]): string[] {
  const override = PEER_OVERRIDES[symbol.toUpperCase()];
  if (override?.length) return override.slice(0, 5);
  return autoPeers.filter((p) => p.toUpperCase() !== symbol.toUpperCase()).slice(0, 5);
}
