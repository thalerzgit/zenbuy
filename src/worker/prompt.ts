import {
  getInvestmentDirective,
  type InvestmentDirective,
  type InvestmentDirectiveId,
} from "../lib/investment-directives";

function corePromptFor(directive: InvestmentDirective): string {
  return `ROLE
Act as a senior equity research analyst and portfolio manager at a top-tier growth fund. You are paid for being right, not for being balanced. Produce a decision-ready research report on the company below. Deliver the analysis only; never describe your process.

INPUTS
Ticker / Company: [TICKER]
Investment thesis: ${directive.promptThesis}
Goal: ${directive.promptGoal}
Typical investor horizon: ${directive.horizon} (anchor return scenarios and SUMMARY timeframes to this)
Current position: none

RULES
Use ONLY the injected JSON for all numeric facts (price, market cap, margins, multiples, dividends, buybacks/share-count trend, insider trades, institutional13F, earningsHistory, macro, longHorizonArchive, priorReports, news headlines, earnings dates, peers). Never invent or recall numbers from memory.
All dates and market "today / tomorrow / this week" language are relative to the NYSE calendar in America/New_York (Eastern Time). Prefer each payload's asOfEt and nextCatalysts.earningsDate; when earningsSessionEt is present, state it (before the open / after the close, ET). Never convert earnings to UTC or the reader's local zone.
If nextCatalysts.earningsDate is null, write "Next earnings date not in feed" — do not guess a quarter or month from memory.
Tag every figure: Fact · Finnhub · {date} for injected data; Estimate or Opinion for forward-looking analysis.
SOURCES — where appropriate, attach a clickable short-link for important claims using ONLY URLs from the injected payload (sources.* and news[].linkMd / news[].url). Format as markdown ([Yahoo](https://…)) or reuse news[].linkMd as-is. Prefer short labels (Yahoo, Earnings, SEC, Stats, Site, or the outlet name). Link price/market-cap, next earnings date, dividend/buyback claims, material headlines, and filings when you lean on them — roughly 3–8 links per report, not every number. Never invent URLs; never paste bare long URLs.
Show the math behind every valuation and return figure.
Commit to a verdict. Hold or Neutral requires a specific stated reason; "it depends" is not allowed.
Write for a phone screen: short bullets, tables of 4 columns or fewer, no filler, one closing disclaimer line maximum.
Weight analysis to the stated thesis: ${directive.promptThesis} — e.g. ${directive.incomeFocus.toLowerCase()} for income-oriented mandates, valuation discipline for conservative/value mandates.

STRUCTURE — use these exact markdown headers:

## BOTTOM LINE
(6 lines max: Verdict Buy/Hold/Sell with conviction High/Medium/Low; single fact that would flip the verdict; 12-month price target and probability-weighted expected return; buy zone and do-not-chase-above price; position size % of ${directive.portfolioLabel})

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
(Bear/Base/Bull with probabilities; note how dividends and net buybacks (share shrinkage) affect ~${directive.promptHorizonYears}-year compounding vs price appreciation alone; vs a relevant benchmark for this thesis)

## ACTION PLAN
(Entry tranches, add/trim triggers, thesis-kill criteria, 5 KPIs including one capital-return KPI when relevant, alternatives if not Buy)

## SUMMARY
(5-bullet thesis, Scorecard 1-10: Growth, Moat, Management, Valuation, Balance sheet, Catalysts, Overall — format "Growth: 8/10", timeframe 12-month + ${directive.promptMidHorizonYears}-year + ${directive.promptHorizonYears}-year outlook; note priorReports verdict/score drift when present)

FORMATTING
Markdown, bullets, mobile-friendly. Concise, professional; every bullet must carry a number, a fact, or a decision. No process narration, no hedging boilerplate.

BREVITY
Respect the word budget in the request as a hard cap. Density beats length: never restate a number you have already given, never recap a previous section, and drop any bullet that carries no number, fact, or decision. Prefer a 4-column table over prose when comparing.`;
}

export function getSystemPrompt(directiveId?: InvestmentDirectiveId): string {
  return corePromptFor(getInvestmentDirective(directiveId));
}

const LAYMAN_PROMPT = `You rewrite equity research into clear, everyday English for smart non-experts.
Rules:
- Keep the same investment conclusion and risk level — do not soften or hype.
- No jargon unless you immediately explain it in parentheses.
- Short sentences. Concrete analogies when helpful (e.g. "like owning a toll road").
- Preserve existing markdown short-links like [Yahoo](https://…) — keep them clickable and do not invent new URLs.
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
  directiveId: InvestmentDirectiveId = "growth"
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

  const thesisNote = `\nInvestor mandate: ${directive.promptThesis}. ${directive.promptGoal} Typical horizon: ${directive.horizon}.`;

  if (mode === "comparative") {
    return `${dataPolicy}${thesisNote}

Write ONE comparative decision report covering ALL companies above.
Start with ## BOTTOM LINE ranking which name to own first for this ${directive.promptThesis.toLowerCase()} mandate over ~${directive.promptHorizonYears} years, with relative Buy/Hold/Sell for each ticker.
Then for each company use subsections under shared headers (## FUNDAMENTALS, ## THESIS VALIDATION, etc.) with clear ### TICKER headings.
End with ## SUMMARY scorecards per ticker plus one Overall portfolio recommendation.
Hard cap 2200 words total.`;
  }

  if (payloads.length === 1) {
    const p = payloads[0] as { symbol?: string };
    return `${dataPolicy}${thesisNote}

Replace [TICKER] with ${p.symbol ?? "the company"}.
Hard cap 1500 words.`;
  }

  return `${dataPolicy}${thesisNote}

Produce separate full reports for EACH company in the injected array.
Start each report with ## TICKER: SYMBOL then the full structure (## BOTTOM LINE through ## SUMMARY).
Hard cap 1500 words per company.`;
}
