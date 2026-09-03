import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatEta } from "./processing-progress.ts";

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
