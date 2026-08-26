export type InvestmentDirectiveId =
  | "aggressive_growth"
  | "growth"
  | "growth_income"
  | "value_income"
  | "conservative";

export interface InvestmentDirective {
  id: InvestmentDirectiveId;
  label: string;
  headline: string;
  bestIf: string;
  plainEnglish: string;
  horizon: string;
  risk: string;
  incomeFocus: string;
  exampleGoal: string;
  /** Full profile shown in the info popover. */
  detailProfile: string;
  promptThesis: string;
  promptGoal: string;
  promptHorizonYears: number;
  promptMidHorizonYears: number;
  portfolioLabel: string;
}

export const INVESTMENT_DIRECTIVES: InvestmentDirective[] = [
  {
    id: "aggressive_growth",
    label: "Aggressive Growth",
    headline: "Big winners, long wait",
    bestIf: "15–20+ years out; OK with big drops",
    plainEnglish: "Fast-growers and moonshots. Volatile.",
    horizon: "15–20+ yrs",
    risk: "High",
    incomeFocus: "Low",
    exampleGoal: "$10k → $50k+ possible; −40% years happen",
    detailProfile:
      "Moonshots and fast-growers for 15–20+ years. High volatility — big drawdowns are normal. Income is usually reinvested. Best if you won't need the money for a long time and can hold through −40% years.",
    promptThesis: "Aggressive growth",
    promptGoal:
      "Maximize long-term wealth compounding over 15–20+ years; tolerate high volatility and drawdowns.",
    promptHorizonYears: 18,
    promptMidHorizonYears: 5,
    portfolioLabel: "aggressive growth portfolio",
  },
  {
    id: "growth",
    label: "Growth",
    headline: "Strong returns, less wild",
    bestIf: "10–15 years; quality growth names",
    plainEnglish: "Proven growers beating the market.",
    horizon: "10–15 yrs",
    risk: "Mod–high",
    incomeFocus: "Low",
    exampleGoal: "$10k → ~$25k–40k in 10–15 yrs",
    detailProfile:
      "Quality companies growing faster than the economy over 10–15 years. Moderate-high risk — less wild than moonshots, still market-beating focus. Low dividend income; gains mostly from share price.",
    promptThesis: "Growth",
    promptGoal:
      "Compound above-market returns over 10–15 years with quality growth businesses; moderate volatility tolerance.",
    promptHorizonYears: 12,
    promptMidHorizonYears: 5,
    portfolioLabel: "growth portfolio",
  },
  {
    id: "growth_income",
    label: "Growth & Income",
    headline: "Grow plus payouts",
    bestIf: "7–12 years; want dividends too",
    plainEnglish: "Growing companies that also pay you.",
    horizon: "7–12 yrs",
    risk: "Moderate",
    incomeFocus: "Moderate",
    exampleGoal: "$10k → ~$18k–28k + yearly cash",
    detailProfile:
      "Growing businesses that also pay dividends or buy back shares over 7–12 years. Moderate risk — income helps you stay patient while the nest egg grows.",
    promptThesis: "Growth & income",
    promptGoal:
      "Balance share-price growth with shareholder returns (dividends and net buybacks) over 7–12 years.",
    promptHorizonYears: 10,
    promptMidHorizonYears: 3,
    portfolioLabel: "growth-and-income portfolio",
  },
  {
    id: "value_income",
    label: "Value / Income",
    headline: "Fair price, steady income",
    bestIf: "5–10 years; dividends matter",
    plainEnglish: "Value names with cash flow and yield.",
    horizon: "5–10 yrs",
    risk: "Mod–low",
    incomeFocus: "High",
    exampleGoal: "$10k → ~$14k–20k + dividends",
    detailProfile:
      "Fair price, steady cash flow, and dividends over 5–10 years. Moderate-low risk — less hype, more yield and payout safety.",
    promptThesis: "Value / income",
    promptGoal:
      "Protect capital, avoid overpaying, and compound via dividends, buybacks, and modest appreciation over 5–10 years.",
    promptHorizonYears: 7,
    promptMidHorizonYears: 3,
    portfolioLabel: "value-and-income portfolio",
  },
  {
    id: "conservative",
    label: "Conservative",
    headline: "Stability first",
    bestIf: "3–7 years; smaller drawdowns",
    plainEnglish: "Solid balance sheets, modest returns.",
    horizon: "3–7 yrs",
    risk: "Lower",
    incomeFocus: "Steady",
    exampleGoal: "$10k → ~$11.5k–14k, milder swings",
    detailProfile:
      "Stable balance sheets and modest returns over 3–7 years. Lower risk — sleep-well priority, dividends and financial strength matter.",
    promptThesis: "Conservative",
    promptGoal:
      "Preserve capital and earn modest, dependable returns over 3–7 years; minimize drawdown risk.",
    promptHorizonYears: 5,
    promptMidHorizonYears: 2,
    portfolioLabel: "conservative portfolio",
  },
];

export const DEFAULT_DIRECTIVE_ID: InvestmentDirectiveId = "growth";

const DIRECTIVE_MAP = new Map(
  INVESTMENT_DIRECTIVES.map((d) => [d.id, d] as const)
);

export function isInvestmentDirectiveId(
  value: string
): value is InvestmentDirectiveId {
  return DIRECTIVE_MAP.has(value as InvestmentDirectiveId);
}

export function getInvestmentDirective(
  id: string | undefined
): InvestmentDirective {
  if (id && isInvestmentDirectiveId(id)) return DIRECTIVE_MAP.get(id)!;
  return DIRECTIVE_MAP.get(DEFAULT_DIRECTIVE_ID)!;
}

/** Public shape for /api/config and mobile clients. */
export function directivesForClient(): Array<
  Pick<
    InvestmentDirective,
    | "id"
    | "label"
    | "headline"
    | "bestIf"
    | "plainEnglish"
    | "horizon"
    | "risk"
    | "incomeFocus"
    | "exampleGoal"
    | "detailProfile"
  >
> {
  return INVESTMENT_DIRECTIVES.map(
    ({
      id,
      label,
      headline,
      bestIf,
      plainEnglish,
      horizon,
      risk,
      incomeFocus,
      exampleGoal,
      detailProfile,
    }) => ({
      id,
      label,
      headline,
      bestIf,
      plainEnglish,
      horizon,
      risk,
      incomeFocus,
      exampleGoal,
      detailProfile,
    })
  );
}
