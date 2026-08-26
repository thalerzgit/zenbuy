import type { InvestmentDirectiveId } from "../lib/investment-directives";
import type { MacroSnapshot, LongHorizonArchive } from "./fred";
import type { Institutional13FContext } from "./thirteenf";
import type { ReportArchiveEntry } from "./cache";
import type { FundamentalsPayload } from "./finnhub";

export interface ResearchContext {
  macro: MacroSnapshot | null;
  longHorizonArchive: LongHorizonArchive | null;
}

export interface EnrichedFundamentalsPayload {
  institutional13F?: Institutional13FContext | null;
  priorReports?: ReportArchiveEntry[];
}

export type ResearchPayload = FundamentalsPayload &
  ResearchContext &
  EnrichedFundamentalsPayload;

export function extractArchiveEntry(
  markdown: string,
  badges: { recommendation?: string },
  scorecard: { overall?: number },
  asOf: string
): ReportArchiveEntry {
  const verdict =
    badges.recommendation ??
    markdown.match(/Verdict[:\s]+(Buy|Hold|Sell)/i)?.[1] ??
    null;
  const overallScore =
    scorecard.overall ??
    (markdown.match(/Overall[:\s]+(\d+)\s*\/\s*10/i)?.[1]
      ? Number(markdown.match(/Overall[:\s]+(\d+)\s*\/\s*10/i)![1])
      : null);

  return {
    asOf,
    verdict: verdict ? String(verdict) : null,
    overallScore: Number.isFinite(overallScore) ? overallScore : null,
  };
}

export async function enrichPayloadsForResearch(
  env: Env,
  payloads: FundamentalsPayload[],
  directive: InvestmentDirectiveId
): Promise<ResearchPayload[]> {
  const { getMacroCached, getLongHorizonArchiveCached } = await import("./fred");
  const { getInstitutional13FCached } = await import("./thirteenf");
  const { getReportArchive } = await import("./cache");

  const [macro, longHorizonArchive] = await Promise.all([
    getMacroCached(env.CACHE, env.FRED_API_KEY),
    getLongHorizonArchiveCached(env.CACHE, env.FRED_API_KEY),
  ]);

  const enriched = await Promise.all(
    payloads.map(async (p) => {
      const [institutional13F, priorReports] = await Promise.all([
        getInstitutional13FCached(env.CACHE, env.FINNHUB_API_KEY, p.symbol).catch(
          () => null
        ),
        getReportArchive(env.CACHE, directive, p.symbol),
      ]);
      return {
        ...p,
        macro,
        longHorizonArchive,
        institutional13F,
        priorReports,
      };
    })
  );

  return enriched;
}
