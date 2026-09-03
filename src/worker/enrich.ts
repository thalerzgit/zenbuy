import type { InvestmentDirectiveId } from "../lib/investment-directives";
import type { MacroSnapshot, LongHorizonArchive } from "./fred";
import type { Institutional13FContext } from "./thirteenf";
import type { FundamentalsPayload } from "./finnhub";

export interface ResearchContext {
  macro: MacroSnapshot | null;
  longHorizonArchive: LongHorizonArchive | null;
}

export interface EnrichedFundamentalsPayload {
  institutional13F?: Institutional13FContext | null;
}

export type ResearchPayload = FundamentalsPayload &
  ResearchContext &
  EnrichedFundamentalsPayload;

export async function enrichPayloadsForResearch(
  env: Env,
  payloads: FundamentalsPayload[],
  _directive: InvestmentDirectiveId
): Promise<ResearchPayload[]> {
  const { getMacroCached, getLongHorizonArchiveCached } = await import("./fred");
  const { getInstitutional13FCached } = await import("./thirteenf");

  const [macro, longHorizonArchive] = await Promise.all([
    getMacroCached(env.CACHE, env.FRED_API_KEY),
    getLongHorizonArchiveCached(env.CACHE, env.FRED_API_KEY),
  ]);

  const enriched = await Promise.all(
    payloads.map(async (p) => {
      const institutional13F = await getInstitutional13FCached(
        env.CACHE,
        env.FINNHUB_API_KEY,
        p.symbol
      ).catch(() => null);
      return {
        ...p,
        macro,
        longHorizonArchive,
        institutional13F,
      };
    })
  );

  return enriched;
}
