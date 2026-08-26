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
    headline: "Swing for the fences — years from now",
    bestIf:
      "You're young, won't need this money for 15–20+ years, and can stomach big drops without selling.",
    plainEnglish:
      "You're looking for companies that could become much larger winners — often in new or fast-changing industries. The ride is bumpy; the payoff is mostly years away, not next quarter.",
    horizon: "15–20+ years",
    risk: "High",
    incomeFocus: "Usually reinvested — growth over paychecks",
    exampleGoal:
      "$10,000 might become $50k–$100k+ in 15–20 years if picks work — but −40% years happen.",
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
    headline: "Beat the market over a decade",
    bestIf:
      "You want strong returns over 10–15 years without betting everything on the wildest names.",
    plainEnglish:
      "Solid companies still growing faster than the economy — usually bigger and more proven than moonshots. You want your money to outpace inflation and the broad market over time.",
    horizon: "10–15 years",
    risk: "Moderate–high",
    incomeFocus: "Low — gains mostly from the stock rising",
    exampleGoal:
      "$10,000 might reach $25k–$40k in 10–15 years, typically with less chaos than aggressive growth.",
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
    headline: "Grow the nest egg and get paid along the way",
    bestIf:
      "You want progress toward a goal in 7–12 years plus dividends or buybacks that pay you while you wait.",
    plainEnglish:
      "Companies that still expand but also return cash to shareholders. Less all-or-nothing than pure growth; income helps you stay patient.",
    horizon: "7–12 years",
    risk: "Moderate",
    incomeFocus: "Moderate — dividends and buybacks matter",
    exampleGoal:
      "$10,000 might reach $18k–$28k in 7–12 years, with some cash paid out each year.",
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
    headline: "Don't overpay; get paid to wait",
    bestIf:
      "You care about the price you pay, steady dividends, and avoiding hype — horizon about 5–10 years.",
    plainEnglish:
      "Cheaper or mature businesses that reward patience with income. Less about doubling overnight; more about fair price, cash flow, and dividends while you hold.",
    horizon: "5–10 years",
    risk: "Moderate–low",
    incomeFocus: "High — yield and payout safety weigh heavily",
    exampleGoal:
      "$10,000 might reach $14k–$20k in 5–10 years, with meaningful dividend income.",
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
    headline: "Sleep at night first, grow second",
    bestIf:
      "You may need the money in 3–7 years, hate large drawdowns, or you're learning and want less drama.",
    plainEnglish:
      "Stable businesses and strong balance sheets over lottery tickets. Returns are usually modest, but scary years tend to be smaller.",
    horizon: "3–7 years",
    risk: "Lower",
    incomeFocus: "Often important — dividends and financial strength",
    exampleGoal:
      "$10,000 might reach $11.5k–$14k in 3–7 years with much smaller down years.",
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
    })
  );
}
