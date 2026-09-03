import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INCOMPLETE_HARD_FAIL,
  PARTIAL_REPORT_WARNING,
  assessReportCompleteness,
  isParseableBottomLine,
  isUsablePartialReport,
  parseReport,
  parseScorecard,
  planResearchFinish,
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
