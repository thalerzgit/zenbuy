import {
  getInvestmentDirective,
  type InvestmentDirective,
  type InvestmentDirectiveId,
} from "../lib/investment-directives.ts";

/** Mid band sits between 12-month and the long window; never >= long. */
export function midHorizonYearsFor(horizonYears: number): number {
  const mid =
    horizonYears <= 2
      ? 1
      : horizonYears <= 3
        ? 1
        : horizonYears <= 5
          ? 2
          : horizonYears <= 10
            ? 3
            : 5;
  return Math.min(mid, Math.max(1, horizonYears - 1));
}

export function resolvePromptHorizons(
  directive: InvestmentDirective,
  profitHorizonYears?: number
): {
  horizonYears: number;
  midHorizonYears: number;
  hasProfitWindow: boolean;
} {
  const hasProfitWindow =
    profitHorizonYears != null &&
    Number.isFinite(profitHorizonYears) &&
    profitHorizonYears > 0;
  const horizonYears = hasProfitWindow
    ? Math.round(profitHorizonYears)
    : directive.promptHorizonYears;
  return {
    horizonYears,
    midHorizonYears: midHorizonYearsFor(horizonYears),
    hasProfitWindow,
  };
}

function corePromptFor(
  directive: InvestmentDirective,
  profitHorizonYears?: number
): string {
  const { horizonYears, midHorizonYears, hasProfitWindow } =
    resolvePromptHorizons(directive, profitHorizonYears);
  const goalLine = hasProfitWindow
    ? `${directive.promptThesis} risk/style. Holding period is the user's ~${horizonYears}-year profit window — not the typical ${directive.horizon} wait.`
    : directive.promptGoal;
  const typicalHorizon = hasProfitWindow
    ? `~${horizonYears} yrs (user profit window — the ONLY window for RETURN SCENARIOS and SUMMARY)`
    : `${directive.horizon} (anchor return scenarios and SUMMARY timeframes to this)`;

  return `ROLE
Act as a senior equity research analyst and portfolio manager at a top-tier growth fund. You are paid for being right, not for being balanced. Produce a decision-ready research report on the company below. Deliver the analysis only; never describe your process.

INPUTS
Ticker / Company: [TICKER]
Investment thesis: ${directive.promptThesis}
Goal: ${goalLine}
Typical investor horizon: ${typicalHorizon}
Current position: none

RULES
HARD HORIZON: Do not invent compounding math, outlook bands, or "X-year" language beyond ~${horizonYears} years. Do not write 18-year or 15–20+ outlooks unless ~${horizonYears} years is that long. ${directive.promptThesis} is risk/style only when a profit window is set.
Use ONLY the injected JSON for all numeric facts (price, market cap, margins, multiples, dividends, buybacks/share-count trend, insider trades, institutional13F, earningsHistory, macro, longHorizonArchive, news headlines, earnings dates, peers). Never invent or recall numbers from memory.
All dates and market "today / tomorrow / this week" language are relative to the NYSE calendar in America/New_York (Eastern Time). Prefer each payload's asOfEt and nextCatalysts.earningsDate; when earningsSessionEt is present, state it (before the open / after the close, ET). Never convert earnings to UTC or the reader's local zone.
If nextCatalysts.earningsDate is null, write "Next earnings date not in feed" — do not guess a quarter or month from memory.
Tag every figure: Fact · Finnhub · {date} for injected data; Estimate or Opinion for forward-looking analysis.
SOURCES — where appropriate, attach a clickable short-link for important claims using ONLY URLs from the injected payload (sources.* and news[].linkMd / news[].url). When citing a company's sources.*, use that entry's label exactly as provided — it is already ticker-prefixed ([AAPL-Yahoo](https://…), [AAPL-Earnings](https://…), [AAPL-Stats](https://…)) — never shorten it to a bare Yahoo/Earnings/SEC/Stats/Site, and in a multi-ticker report never repeat the same label for different companies. Reuse news[].linkMd as-is (outlet name). Link price/market-cap, next earnings date, dividend/buyback claims, material headlines, and filings when you lean on them — roughly 3–8 links per report, not every number. Never invent URLs; never paste bare long URLs.
Show the math behind every valuation and return figure.
Commit to a verdict. Hold or Neutral requires a specific stated reason; "it depends" is not allowed.
Write for a phone screen: short bullets, tables of 4 columns or fewer, no filler, one closing disclaimer line maximum.
Weight analysis to the stated thesis: ${directive.promptThesis} — e.g. ${directive.incomeFocus.toLowerCase()} for income-oriented theses, valuation discipline for conservative/value theses.

STRUCTURE — use these exact markdown headers:

## BOTTOM LINE
(6 lines max, opening with the verdict itself — no caption or restatement of the investor profile first: Verdict Buy/Hold/Sell with conviction High/Medium/Low; single fact that would flip the verdict; 12-month price target and probability-weighted expected return; buy zone and do-not-chase-above price; position size % of ${directive.portfolioLabel})

## FUNDAMENTALS
(Revenue CAGR, margins, FCF, quality of earnings, unit economics, valuation vs 3-5 peers, reverse DCF, insider/institutional activity from institutional13F (13F lag ~45d), earningsHistory beats/misses, capital return: dividend yield/payout + buyback or share-count trend from capitalReturn — say explicitly if the company returns little/no cash via dividends or buybacks)

## MOAT AND MANAGEMENT
(Moat type and trend, reinvestment runway, capital-allocation quality including dividends vs buybacks vs reinvestment, management quality, disruption risk)

## THESIS VALIDATION
(Variant perception, 3 bull arguments with data, 2 bear arguments, pre-mortem, Verdict: Bullish/Bearish/Neutral with justification)

## SECTOR AND MACRO
(Sector cycle, competitive position. Use macro.* and longHorizonArchive.* for rates, inflation, jobs, yield curve, VIX, recession regime, and long-horizon market context — cite _citation. If macro is null, say "Macro feed unavailable" and avoid inventing levels.)

## CATALYSTS AND RISKS
(Dated events from nextCatalysts and earningsHistory; short/long catalysts; top 3 risks with early warning signs)

## RETURN SCENARIOS
(Bear/Base/Bull with probabilities; note how dividends and net buybacks (share shrinkage) affect ~${horizonYears}-year compounding vs price appreciation alone; vs a relevant benchmark for this thesis)

## ACTION PLAN
(Entry tranches, add/trim triggers, thesis-kill criteria, 5 KPIs including one capital-return KPI when relevant, alternatives if not Buy)

## SUMMARY
(5-bullet thesis, Scorecard 1-10: Growth, Moat, Management, Valuation, Balance sheet, Catalysts, Overall — format "Growth: 8/10", timeframe 12-month + ${midHorizonYears}-year + ${horizonYears}-year outlook)

FORMATTING
Markdown, bullets, mobile-friendly. Concise, professional; every bullet must carry a number, a fact, or a decision. No process narration, no hedging boilerplate.

BREVITY
Respect the word budget in the request as a hard cap. Density beats length: never restate a number you have already given, never recap a previous section, and drop any bullet that carries no number, fact, or decision. Prefer a 4-column table over prose when comparing. Stop immediately after SUMMARY — do not add extra sections, recaps, or a second scorecard.`;
}

export function getSystemPrompt(
  directiveId?: InvestmentDirectiveId,
  profitHorizonYears?: number
): string {
  return corePromptFor(
    getInvestmentDirective(directiveId),
    profitHorizonYears
  );
}

const LAYMAN_PROMPT = `You rewrite equity research into clear, everyday English for smart non-experts.
Rules:
- Keep the same investment conclusion and risk level — do not soften or hype.
- No jargon unless you immediately explain it in parentheses.
- Short sentences. Concrete analogies when helpful (e.g. "like owning a toll road").
- Preserve existing markdown short-links like [AAPL-Yahoo](https://…) — keep the label and URL exactly as written, and do not invent new URLs.
- Keep the source report's timeframes. Do not stretch a short profit window into multi-decade or 18-year compounding.
- Use these exact markdown headers:
## Bottom line
## What this company does
## Why it might make money
## What could go wrong
## Numbers that matter (plain English)
## What I'd watch next
- End with one sentence: "This is not financial advice."
- Be concise: roughly 600–900 words.`;

export function getLaymanSystemPrompt(): string {
  return LAYMAN_PROMPT;
}

export function buildLaymanPrompt(markdown: string): string {
  return `Rewrite this research report in layman's terms.

---
${markdown.slice(0, 60_000)}`;
}

export function buildUserPrompt(
  mode: "separate" | "comparative",
  payloads: unknown[],
  directiveId: InvestmentDirectiveId = "growth",
  profitHorizonYears?: number
): string {
  const directive = getInvestmentDirective(directiveId);

  const degraded = payloads
    .filter((p) => (p as { dataQuality?: string }).dataQuality === "degraded")
    .map((p) => (p as { symbol?: string }).symbol)
    .filter(Boolean);

  const degradedNote = degraded.length
    ? `\n\nLIMITED DATA: ${degraded.join(", ")} arrived from a backup feed carrying price only — no margins, multiples, insiders, peers or news. Say so explicitly in BOTTOM LINE, base the verdict on what is present, and mark every missing input "Not available" rather than estimating it.`
    : "";

  const dataPolicy = `Injected data (cite using each entry's _citation):\n${JSON.stringify(payloads, null, 2)}${degradedNote}`;

  const { horizonYears, midHorizonYears, hasProfitWindow } =
    resolvePromptHorizons(directive, profitHorizonYears);

  const thesisNote = hasProfitWindow
    ? `\nAnalyst framing (guidance for you — never restate it as a caption or heading in the report): ${directive.promptThesis} thesis (risk/style). Holding period: ~${horizonYears}-year profit window. Do not use the typical ${directive.horizon} wait as the report timeframe.`
    : `\nAnalyst framing (guidance for you — never restate it as a caption or heading in the report): ${directive.promptThesis} thesis. ${directive.promptGoal} Typical horizon: ${directive.horizon}.`;

  const profitNote = hasProfitWindow
    ? `\nHARD RULE: Every timeframe in RETURN SCENARIOS, SUMMARY, price targets, and ranking is ~${horizonYears} years (12-month + ${midHorizonYears}-year + ${horizonYears}-year). Do not invent multi-decade compounding or outlooks beyond this window. The investment goal is risk/style only.`
    : "";

  if (mode === "comparative") {
    const rankingHorizonYears = horizonYears;
    return `${dataPolicy}${thesisNote}${profitNote}

Write ONE comparative decision report covering ALL companies above.
Open with ## BOTTOM LINE and go straight into the verdict: which name to own first and why, then relative Buy/Hold/Sell with conviction for every other ticker, judged over ~${rankingHorizonYears} years.
The first words under that heading are the verdict itself — no caption, label, or restatement of the investor profile ahead of it.
Then for each company use subsections under shared headers (## FUNDAMENTALS, ## THESIS VALIDATION, etc.) with clear ### TICKER headings.
End with ## SUMMARY scorecards per ticker plus one Overall portfolio recommendation.
Hard cap 2200 words total.`;
  }

  if (payloads.length === 1) {
    const p = payloads[0] as { symbol?: string };
    return `${dataPolicy}${thesisNote}${profitNote}

Replace [TICKER] with ${p.symbol ?? "the company"}.
Hard cap 1500 words.`;
  }

  return `${dataPolicy}${thesisNote}${profitNote}

Produce separate full reports for EACH company in the injected array.
Start each report with ## TICKER: SYMBOL then the full structure (## BOTTOM LINE through ## SUMMARY).
Hard cap 1500 words per company.`;
}
