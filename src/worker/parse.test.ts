import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INCOMPLETE_HARD_FAIL,
  PARTIAL_REPORT_WARNING,
  assessReportCompleteness,
  isParseableBottomLine,
  isUsablePartialReport,
  normalizeMarkdown,
  parseReport,
  parseScorecard,
  planResearchFinish,
  renderMarkdown,
  shouldSilentRetryIncomplete,
  splitReport,
} from "./parse.ts";

const SECTIONS = [
  "BOTTOM LINE",
  "FUNDAMENTALS",
  "MOAT AND MANAGEMENT",
  "THESIS VALIDATION",
  "SECTOR AND MACRO",
  "CATALYSTS AND RISKS",
  "RETURN SCENARIOS",
  "ACTION PLAN",
  "SUMMARY",
] as const;

function fullReport(opts?: {
  overall?: string;
  tail?: string;
  drop?: string[];
}): string {
  const drop = new Set(opts?.drop ?? []);
  const overall = opts?.overall ?? "Overall: 7/10";
  const parts = SECTIONS.filter((name) => !drop.has(name)).map((name) => {
    if (name === "BOTTOM LINE") {
      return "## BOTTOM LINE\n\n- **Verdict: BUY — High conviction.** Buy zone $10–12. Position size 4%. Flip if revenue growth stalls two quarters in a row.";
    }
    if (name === "SUMMARY") {
      return `## SUMMARY\n\nGrowth: 8/10 · Moat: 7/10 · Management: 7/10 · Valuation: 5/10 · Balance sheet: 8/10 · Catalysts: 6/10 · ${overall}\n\nBase case holds if execution stays clean through the next two prints.`;
    }
    return `## ${name}\n\nEnough analyst prose for this section to count as present, with cited facts and a clear implication for the mandate. Repeat the point so the report clears the completeness floor.`;
  });
  const body = parts.join("\n\n");
  return opts?.tail ? `${body}\n\n${opts.tail}` : body;
}

describe("isParseableBottomLine", () => {
  it("is false before BOTTOM LINE exists", () => {
    assert.equal(isParseableBottomLine(""), false);
    assert.equal(isParseableBottomLine("drafting…"), false);
    assert.equal(isParseableBottomLine("## FUNDAMENTALS\n\nRevenue grew."), false);
  });

  it("is false for a heading-only BOTTOM LINE", () => {
    assert.equal(isParseableBottomLine("## BOTTOM LINE\n"), false);
    assert.equal(isParseableBottomLine("## BOTTOM LINE"), false);
  });

  it("is true as soon as BOTTOM LINE has content — FUNDAMENTALS not required", () => {
    const early = "## BOTTOM LINE\n\n- **Verdict: HOLD — Medium conviction.**";
    assert.equal(isParseableBottomLine(early), true);
    assert.equal(splitReport(early).body, "");
    assert.match(parseReport(early).bottomLine, /HOLD/);
    assert.equal(parseReport(early).badges.recommendation, "HOLD");
  });

  it("stays true after FUNDAMENTALS arrives (sticky can finalize)", () => {
    const mid = [
      "## BOTTOM LINE",
      "",
      "- **Verdict: BUY — High conviction.** Buy zone $10–12.",
      "",
      "## FUNDAMENTALS",
      "",
      "| Metric | AAPL |",
    ].join("\n");
    assert.equal(isParseableBottomLine(mid), true);
    assert.match(splitReport(mid).body, /FUNDAMENTALS/);
  });
});

describe("splitReport rank-caption strip", () => {
  it("drops a leading 'Rank for an N-year … mandate:' caption", () => {
    const md = [
      "## BOTTOM LINE",
      "",
      "**Rank for an 18-year aggressive-growth mandate:**",
      "",
      "1. **PANW — Buy.** Platform consolidation at 15% growth.",
    ].join("\n");
    const { bottomLine } = splitReport(md);
    assert.doesNotMatch(bottomLine, /Rank for/i);
    assert.match(bottomLine, /^## BOTTOM LINE\n\n1\. \*\*PANW/);
  });

  it("drops the caption when it prefixes the ranking on one line", () => {
    const md =
      "## BOTTOM LINE\n\nRank for a 7-year value / income mandate: CSCO first, then AAPL.";
    assert.equal(
      splitReport(md).bottomLine,
      "## BOTTOM LINE\n\nCSCO first, then AAPL."
    );
  });

  it("leaves normal bottom lines untouched", () => {
    const md = "## BOTTOM LINE\n\n- **Verdict: BUY — High conviction.**";
    assert.equal(splitReport(md).bottomLine, md);
  });
});

describe("assessReportCompleteness", () => {
  it("accepts a finished report", () => {
    const result = assessReportCompleteness(fullReport());
    assert.equal(result.ok, true);
  });

  it("accepts Overall 7.5/10 (half-points are not incomplete_summary)", () => {
    const md = fullReport({ overall: "Overall: 7.5/10" });
    assert.equal(assessReportCompleteness(md).ok, true);
    assert.equal(parseScorecard(md).overall, 7.5);
  });

  it("does not flag truncated_tail when SUMMARY + Overall exist", () => {
    const md = fullReport({
      overall: "Overall: 7.5/10",
      tail: "The oligopoly benef",
    });
    assert.equal(assessReportCompleteness(md).ok, true);
    assert.equal(assessReportCompleteness(md).reason, undefined);
  });

  it("hard-fails too short / no BOTTOM LINE", () => {
    assert.equal(assessReportCompleteness("drafting…").ok, false);
    assert.equal(assessReportCompleteness("drafting…").reason, "too_short");
    assert.equal(
      assessReportCompleteness("## FUNDAMENTALS\n\n" + "x".repeat(2000)).ok,
      false
    );
  });
});

describe("planResearchFinish (Worker finish path)", () => {
  it("caches a complete report unmarked", () => {
    const plan = planResearchFinish(fullReport());
    assert.equal(plan.action, "cache");
    assert.equal(plan.usable, true);
    assert.equal(plan.warning, undefined);
  });

  it("soft-accepts a usable partial (BOTTOM LINE + Overall, missing tail sections)", () => {
    const md = fullReport({
      drop: ["RETURN SCENARIOS", "ACTION PLAN"],
      overall: "Overall: 7.5/10",
    });
    assert.equal(assessReportCompleteness(md).ok, false);
    assert.equal(assessReportCompleteness(md).reason, "missing_sections");
    assert.equal(isUsablePartialReport(md), true);
    const plan = planResearchFinish(md);
    assert.equal(plan.action, "cache_partial");
    assert.equal(plan.warning, PARTIAL_REPORT_WARNING);
    assert.doesNotMatch(plan.warning ?? "", /nothing was cached/);
  });

  it("soft-accepts a usable partial with most sections even without Overall", () => {
    const md = fullReport({ drop: ["SUMMARY"] });
    assert.equal(isUsablePartialReport(md), true);
    assert.equal(planResearchFinish(md).action, "cache_partial");
  });

  it("hard-fails when there is no usable BOTTOM LINE", () => {
    const stub = "## BOTTOM LINE\n\n_Analysis cut off before finishing for this ticker._";
    assert.equal(isUsablePartialReport(stub), false);
    const plan = planResearchFinish(stub);
    assert.equal(plan.action, "fail");
    assert.equal(plan.failMessage, INCOMPLETE_HARD_FAIL);
    assert.match(plan.failMessage ?? "", /nothing was cached/);
  });

  it("hard-fails a heading-only or empty stream", () => {
    assert.equal(planResearchFinish("").action, "fail");
    assert.equal(planResearchFinish("## BOTTOM LINE\n").action, "fail");
    assert.equal(isUsablePartialReport("## BOTTOM LINE\n"), false);
  });

  it("retries only when the first attempt has no usable sticky", () => {
    const usable = "## BOTTOM LINE\n\n- **Verdict: HOLD — Medium conviction.** Stay patient on valuation. Position 2%.\n\n## SUMMARY\n\nOverall: 7.5/10";
    assert.equal(shouldSilentRetryIncomplete(usable), false);
    assert.equal(shouldSilentRetryIncomplete("## BOTTOM LINE\n"), true);
    assert.equal(shouldSilentRetryIncomplete("drafting…"), true);
  });
});

const GROK_BOTTOM_LINE = [
  "## BOTTOM LINE",
  "Buy — Medium conviction.",
  "Flip to Selling if next 2 prints show",
  "revenue growth still",
  "$18.50",
  "· probability-weighted expected return",
  "~28%",
  "(12m).",
  "Buy zone",
  "$12.50–14.50",
  "· do-not-chase above",
  "$17.50",
  "·",
  "Position size:",
  "2.5–3.5%",
  "of aggressive-growth book.",
].join("\n");

const GROK_BROKEN_TABLE = [
  "## RETURN SCENARIOS",
  "Horizon = ~2 years only.",
  "| Scenario | Prob | 12m price | ~2y",
  "price | ~2y return |",
  "|----------|------|-----------|--",
  "--------|------------|",
  "| Bear | 25% | $10 | $9 | -38% |",
  "| Base | 50% | $18 | $22 | +52% |",
  "| Bull | 25% | $24 | $30 | +107% |",
].join("\n");

const GROK_SCORECARD = [
  "## SUMMARY",
  "Scorecard: Growth:",
  "8/10",
  "· Moat:",
  "6/10",
  "· Management:",
  "7/10",
  "· Valuation:",
  "5/10",
  "· Balance sheet:",
  "5/10",
  "· Catalysts:",
  "7/10",
  "·",
  "Overall: 6.5/10",
].join("\n");

describe("normalizeMarkdown / renderMarkdown (Grok-shaped markdown)", () => {
  it("collapses fragment-per-line BOTTOM LINE into coherent prose", () => {
    const html = renderMarkdown(GROK_BOTTOM_LINE);
    assert.doesNotMatch(html, /<br\s*\/?>/i);
    assert.match(html, /\$18\.50/);
    assert.match(html, /probability-weighted expected return/);
    assert.match(html, /\$18\.50 · probability-weighted expected return ~28%/);
    assert.doesNotMatch(html, /<p>\$18\.50<\/p>/);
    assert.doesNotMatch(html, /<p>·<\/p>/);
  });

  it("turns wrapped Grok pipe tables into real <table> HTML", () => {
    const html = renderMarkdown(GROK_BROKEN_TABLE);
    assert.match(html, /<table>/);
    assert.match(html, /<th>Scenario<\/th>/);
    assert.match(html, /<th>~2y price<\/th>/);
    assert.match(html, /<td>Bear<\/td>/);
    assert.match(html, /<td>\+107%<\/td>/);
    assert.doesNotMatch(html, /<th>-+/);
    assert.doesNotMatch(html, /\| Scenario \| Prob/);
    assert.doesNotMatch(html, /\|----------/);
    assert.equal((html.match(/<tr>/g) ?? []).length, 4);
  });

  it("still renders a well-formed Claude GFM table", () => {
    const md = [
      "| Metric | AAPL |",
      "| --- | --- |",
      "| PE | 34.4 |",
    ].join("\n");
    const html = renderMarkdown(md);
    assert.match(html, /<table>/);
    assert.match(html, /<th>Metric<\/th>/);
    assert.match(html, /<td>34\.4<\/td>/);
  });

  it("joins scorecard dots onto one line and still parses Overall 6.5", () => {
    const normalized = normalizeMarkdown(GROK_SCORECARD);
    assert.match(normalized, /Growth: 8\/10 · Moat: 6\/10/);
    assert.match(normalized, /Overall: 6\.5\/10/);
    const html = renderMarkdown(GROK_SCORECARD);
    assert.match(html, /Growth: 8\/10 · Moat: 6\/10/);
    assert.doesNotMatch(html, /<p>8\/10<\/p>/);
    assert.equal(parseScorecard(GROK_SCORECARD).overall, 6.5);
    assert.equal(parseScorecard(GROK_SCORECARD).growth, 8);
  });

  it("replaces user-facing 'null in feed' and drops orphan outlet lines", () => {
    const md = [
      "## FUNDAMENTALS",
      "FCF/share and FCF margin: null in feed.",
      "Revenue/EPS YoY: null/null.",
      "Yahoo",
      "Fact · Finnhub · 2026-09-11",
    ].join("\n");
    const html = renderMarkdown(md);
    assert.match(html, /not in feed/i);
    assert.doesNotMatch(html, />\s*null/i);
    assert.doesNotMatch(html, /<p>Yahoo<\/p>/);
    assert.match(html, /Fact · Finnhub/);
  });
});
