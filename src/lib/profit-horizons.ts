import type { InvestmentDirectiveId } from "./investment-directives";
import { getInvestmentDirective } from "./investment-directives";

export interface ProfitHorizonOption {
  id: string;
  years: number;
  label: string;
}

/** Selectable profit windows — overlay on the investment goal. */
export const PROFIT_HORIZON_OPTIONS: ProfitHorizonOption[] = [
  { id: "3", years: 3, label: "3–5 yrs" },
  { id: "7", years: 7, label: "5–10 yrs" },
  { id: "12", years: 12, label: "10–15 yrs" },
  { id: "18", years: 18, label: "15–20+ yrs" },
];

export function defaultProfitHorizonYears(directiveId: InvestmentDirectiveId): number {
  return getInvestmentDirective(directiveId).promptHorizonYears;
}

export function closestHorizonOption(years: number): ProfitHorizonOption {
  return PROFIT_HORIZON_OPTIONS.reduce((best, opt) =>
    Math.abs(opt.years - years) < Math.abs(best.years - years) ? opt : best
  );
}

export function profitHorizonLabel(years: number): string {
  return closestHorizonOption(years).label;
}
