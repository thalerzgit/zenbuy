import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getInvestmentDirective } from "../lib/investment-directives.ts";
import {
  buildUserPrompt,
  getLaymanSystemPrompt,
  getSystemPrompt,
  midHorizonYearsFor,
  resolvePromptHorizons,
} from "./prompt.ts";

const PAYLOADS = [{ symbol: "AAPL" }, { symbol: "PANW" }];

function returnScenariosBlock(prompt: string): string {
  const m = prompt.match(/## RETURN SCENARIOS\n([^\n]+)/);
  assert.ok(m?.[1], "RETURN SCENARIOS block missing");
  return m[1];
}

function summaryBlock(prompt: string): string {
  const m = prompt.match(/## SUMMARY\n([^\n]+)/);
  assert.ok(m?.[1], "SUMMARY block missing");
  return m[1];
}

describe("buildUserPrompt", () => {
  it("never asks for a 'Rank for … mandate:' caption", () => {
    for (const directive of [
      "aggressive_growth",
      "growth",
      "growth_income",
      "value_income",
      "conservative",
    ] as const) {
      for (const mode of ["comparative", "separate"] as const) {
        const prompt = buildUserPrompt(mode, PAYLOADS, directive);
        assert.doesNotMatch(prompt, /rank(?:ing)? for an? /i);
        assert.doesNotMatch(prompt, /mandate/i);
      }
      assert.doesNotMatch(getSystemPrompt(directive), /mandate/i);
    }
  });

  it("ranks over the profit window when the user picked one", () => {
    const withWindow = buildUserPrompt(
      "comparative",
      PAYLOADS,
      "aggressive_growth",
      3
    );
    assert.match(withWindow, /judged over ~3 years/);

    const withoutWindow = buildUserPrompt(
      "comparative",
      PAYLOADS,
      "aggressive_growth"
    );
    assert.match(withoutWindow, /judged over ~18 years/);
  });
});

describe("profit window wins report timeframes", () => {
  it("scales mid-horizon with the effective window", () => {
    assert.equal(midHorizonYearsFor(2), 1);
    assert.equal(midHorizonYearsFor(3), 1);
    assert.equal(midHorizonYearsFor(5), 2);
    assert.equal(midHorizonYearsFor(7), 3);
    assert.equal(midHorizonYearsFor(10), 3);
    assert.equal(midHorizonYearsFor(12), 5);
    assert.equal(midHorizonYearsFor(18), 5);
    assert.ok(midHorizonYearsFor(2) < 2);
  });

  it("falls back to the directive default when no profit window is set", () => {
    const directive = getInvestmentDirective("aggressive_growth");
    const resolved = resolvePromptHorizons(directive);
    assert.equal(resolved.hasProfitWindow, false);
    assert.equal(resolved.horizonYears, 18);
    assert.equal(resolved.midHorizonYears, 5);
  });

  it("Aggressive Growth with profitHorizonYears=2 anchors ~2-year, not 18-year", () => {
    const system = getSystemPrompt("aggressive_growth", 2);
    const user = buildUserPrompt(
      "separate",
      [{ symbol: "AVGO" }],
      "aggressive_growth",
      2
    );
    const comparative = buildUserPrompt(
      "comparative",
      PAYLOADS,
      "aggressive_growth",
      2
    );

    const returns = returnScenariosBlock(system);
    const summary = summaryBlock(system);

    assert.match(returns, /~2-year compounding/);
    assert.doesNotMatch(returns, /18-year/);
    assert.match(summary, /12-month \+ 1-year \+ 2-year outlook/);
    assert.doesNotMatch(summary, /18-year/);
    assert.doesNotMatch(summary, /5-year/);

    assert.doesNotMatch(system, /may refine but not contradict/);
    assert.doesNotMatch(user, /may refine but not contradict/);
    assert.match(system, /HARD HORIZON/);
    assert.match(user, /~2-year profit window/);
    assert.match(user, /12-month \+ 1-year \+ 2-year/);
    assert.match(comparative, /judged over ~2 years/);
    assert.doesNotMatch(comparative, /judged over ~18 years/);

    // Goal/style may mention the typical wait only to forbid it — STRUCTURE must not require it.
    assert.doesNotMatch(
      typicalHorizonLine(system),
      /15–20\+|15-20\+|18-year/
    );
  });

  it("no profit window still uses Aggressive Growth's directive 18 / 5", () => {
    const system = getSystemPrompt("aggressive_growth");
    const user = buildUserPrompt(
      "separate",
      [{ symbol: "AVGO" }],
      "aggressive_growth"
    );

    assert.match(returnScenariosBlock(system), /~18-year compounding/);
    assert.match(summaryBlock(system), /12-month \+ 5-year \+ 18-year outlook/);
    assert.match(system, /Typical investor horizon: 15–20\+ yrs/);
    assert.match(user, /Typical horizon: 15–20\+ yrs/);
    assert.doesNotMatch(user, /HARD RULE: Every timeframe/);
  });

  it("layman rewrite must not stretch a short window into multi-decade outlooks", () => {
    assert.match(
      getLaymanSystemPrompt(),
      /Do not stretch a short profit window into multi-decade or 18-year compounding/
    );
  });

  it("HARD FORMAT forbids Grok-style wraps, raw null, and split scorecards", () => {
    const system = getSystemPrompt("aggressive_growth", 2);
    assert.match(system, /HARD FORMAT/);
    assert.match(system, /Never insert a newline inside a sentence/);
    assert.match(system, /GFM tables/);
    assert.match(system, /Not in feed/);
    assert.match(system, /null in feed/);
    assert.match(system, /Scorecard on ONE line/);
    assert.match(system, /~2-year compounding/);
  });
});

function typicalHorizonLine(prompt: string): string {
  const m = prompt.match(/Typical investor horizon: ([^\n]+)/);
  assert.ok(m?.[1], "Typical investor horizon missing");
  return m[1];
}
