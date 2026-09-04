import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUserPrompt, getSystemPrompt } from "./prompt.ts";

const PAYLOADS = [{ symbol: "AAPL" }, { symbol: "PANW" }];

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
