import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isParseableBottomLine, parseReport, splitReport } from "./parse.ts";

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
