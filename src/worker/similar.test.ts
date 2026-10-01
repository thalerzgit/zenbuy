import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  industriesSimilar,
  industryFamily,
  normalizeIndustry,
} from "./similar-industry.ts";

describe("normalizeIndustry", () => {
  it("lowercases and strips punctuation", () => {
    assert.equal(normalizeIndustry("Banks—Diversified"), "banks diversified");
    assert.equal(
      normalizeIndustry("  Software—Infrastructure  "),
      "software infrastructure"
    );
  });
});

describe("industryFamily", () => {
  it("groups banks and capital markets as financials", () => {
    assert.equal(industryFamily("Banks—Diversified"), "financials");
    assert.equal(industryFamily("Banks—Regional"), "financials");
    assert.equal(industryFamily("Capital Markets"), "financials");
    assert.equal(industryFamily("Credit Services"), "financials");
  });

  it("keeps semis out of financials", () => {
    assert.equal(industryFamily("Semiconductors"), "semiconductors");
    assert.notEqual(
      industryFamily("Semiconductors"),
      industryFamily("Banks—Diversified")
    );
  });
});

describe("industriesSimilar", () => {
  it("matches JPM-like banks to peers, not mega-cap tech", () => {
    assert.equal(industriesSimilar("Banks—Diversified", "Banks—Regional"), true);
    assert.equal(industriesSimilar("Banks—Diversified", "Capital Markets"), true);
    assert.equal(industriesSimilar("Banks—Diversified", "Credit Services"), true);
    assert.equal(industriesSimilar("Banks—Diversified", "Semiconductors"), false);
    assert.equal(
      industriesSimilar("Banks—Diversified", "Consumer Electronics"),
      false
    );
    assert.equal(
      industriesSimilar("Banks—Diversified", "Software—Infrastructure"),
      false
    );
  });

  it("returns false when either side is missing", () => {
    assert.equal(industriesSimilar(null, "Banks—Diversified"), false);
    assert.equal(industriesSimilar("Banks—Diversified", ""), false);
  });
});
