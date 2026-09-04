import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReportSources,
  citationWithSources,
  mdSourceLink,
  tickerSourceLabel,
  withTickerCitationLabels,
  withTickerSourceLabels,
} from "./sources.ts";

describe("buildReportSources", () => {
  it("ticker-prefixes every per-company label", () => {
    const sources = buildReportSources("aapl", "apple.com");
    assert.equal(sources.quote.label, "AAPL-Yahoo");
    assert.equal(sources.earnings.label, "AAPL-Earnings");
    assert.equal(sources.filings.label, "AAPL-SEC");
    assert.equal(sources.stats.label, "AAPL-Stats");
    assert.equal(sources.company?.label, "AAPL-Site");
  });

  it("keeps urls symbol-scoped and uppercased", () => {
    const sources = buildReportSources("net");
    assert.equal(sources.quote.url, "https://finance.yahoo.com/quote/NET");
    assert.equal(
      sources.stats.url,
      "https://finance.yahoo.com/quote/NET/key-statistics"
    );
    assert.equal(sources.company, undefined);
  });

  it("gives a comparative batch distinct quote labels", () => {
    const labels = ["AAPL", "NET", "MSFT"].map(
      (sym) => buildReportSources(sym).quote.label
    );
    assert.deepEqual(labels, ["AAPL-Yahoo", "NET-Yahoo", "MSFT-Yahoo"]);
    assert.equal(new Set(labels).size, 3);
  });
});

describe("mdSourceLink", () => {
  it("emits the ticker-prefixed markdown short-link", () => {
    const sources = buildReportSources("MSFT");
    assert.equal(
      mdSourceLink(sources.quote),
      "[MSFT-Yahoo](https://finance.yahoo.com/quote/MSFT)"
    );
    assert.equal(
      mdSourceLink(sources.earnings),
      "[MSFT-Earnings](https://finance.yahoo.com/calendar/earnings?symbol=MSFT)"
    );
  });
});

describe("citationWithSources", () => {
  it("cites the prefixed label", () => {
    const citation = citationWithSources(
      "Finnhub",
      "2026-09-04",
      buildReportSources("NET"),
      "09:41"
    );
    assert.equal(
      citation,
      "Fact · [NET-Yahoo](https://finance.yahoo.com/quote/NET) · 2026-09-04 ET (09:41)"
    );
  });
});

describe("tickerSourceLabel", () => {
  it("is idempotent", () => {
    assert.equal(tickerSourceLabel("AAPL", "AAPL-Yahoo"), "AAPL-Yahoo");
    assert.equal(tickerSourceLabel("aapl", "Yahoo"), "AAPL-Yahoo");
  });

  it("leaves empty inputs alone", () => {
    assert.equal(tickerSourceLabel("", "Yahoo"), "Yahoo");
    assert.equal(tickerSourceLabel("AAPL", "  "), "");
  });
});

describe("warm cache upgrades", () => {
  it("relabels sources cached before prefixes existed", () => {
    const legacy = {
      quote: { label: "Yahoo", url: "https://finance.yahoo.com/quote/AAPL" },
      earnings: {
        label: "Earnings",
        url: "https://finance.yahoo.com/calendar/earnings?symbol=AAPL",
      },
      filings: { label: "SEC", url: "https://www.sec.gov/edgar/search/" },
      stats: {
        label: "Stats",
        url: "https://finance.yahoo.com/quote/AAPL/key-statistics",
      },
      company: { label: "Site", url: "https://www.apple.com/" },
    };
    const upgraded = withTickerSourceLabels("AAPL", legacy);
    assert.deepEqual(
      [
        upgraded.quote.label,
        upgraded.earnings.label,
        upgraded.filings.label,
        upgraded.stats.label,
        upgraded.company?.label,
      ],
      ["AAPL-Yahoo", "AAPL-Earnings", "AAPL-SEC", "AAPL-Stats", "AAPL-Site"]
    );
    assert.equal(upgraded.quote.url, legacy.quote.url);
  });

  it("relabels a cached citation without touching the url or stamp", () => {
    assert.equal(
      withTickerCitationLabels(
        "AAPL",
        "Fact · [Yahoo](https://finance.yahoo.com/quote/AAPL) · 2026-09-04 ET (09:41)"
      ),
      "Fact · [AAPL-Yahoo](https://finance.yahoo.com/quote/AAPL) · 2026-09-04 ET (09:41)"
    );
  });

  it("leaves an already-prefixed citation unchanged", () => {
    const citation =
      "Fact · [NET-Yahoo](https://finance.yahoo.com/quote/NET) · 2026-09-04 ET";
    assert.equal(withTickerCitationLabels("NET", citation), citation);
  });
});
