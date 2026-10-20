import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatEta, QUOTE_ROTATION_MS, quoteDelayMs } from "./processing-progress.ts";

describe("formatEta", () => {
  it("keeps the pre-verdict countdown", () => {
    assert.equal(formatEta(42_000), "About 42s remaining");
    assert.equal(formatEta(70_000), "About 2 min remaining");
    assert.equal(formatEta(4_000), "Almost there…");
  });

  it("acknowledges an early verdict without changing the full-report clock", () => {
    assert.equal(formatEta(42_000, true), "Full report · About 42s remaining");
    assert.equal(formatEta(70_000, true), "Full report · About 2 min remaining");
    assert.equal(formatEta(4_000, true), "Almost there…");
  });
});

describe("quote rotation", () => {
  it("keeps each quote on screen for at least 15 seconds", () => {
    assert.ok(QUOTE_ROTATION_MS >= 15_000);
  });

  it("waits out the remaining minimum before advancing", () => {
    assert.equal(quoteDelayMs(1_000, 1_000), 15_000);
    assert.equal(quoteDelayMs(1_000, 6_000), 10_000);
    assert.equal(quoteDelayMs(1_000, 15_999), 1);
    assert.equal(quoteDelayMs(1_000, 16_000), 0);
    assert.equal(quoteDelayMs(1_000, 60_000), 0);
  });

  it("advances immediately when no quote is showing yet", () => {
    assert.equal(quoteDelayMs(null, 5_000), 0);
  });

  it("never treats a clock skew as elapsed time", () => {
    assert.equal(quoteDelayMs(10_000, 9_000), 15_000);
  });
});
