#!/usr/bin/env node
/**
 * ZenBuy smoke test — fetch live fundamentals + optional LLM report.
 * Usage:
 *   node tools/smoke-test.mjs AAPL CSCO PANW NET
 *   ANTHROPIC_API_KEY=... node tools/smoke-test.mjs --llm separate AAPL CSCO PANW NET
 */

const args = process.argv.slice(2);
const RUN_LLM = args.includes("--llm");
const MODE = args.includes("comparative") ? "comparative" : "separate";
const TICKERS = args.filter(
  (a) => !a.startsWith("-") && !["separate", "comparative"].includes(a)
);

import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (compatible; ZenBuySmokeTest/1.0)";

async function yahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${symbol}: Yahoo HTTP ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`${symbol}: no chart meta`);
  return meta;
}

async function loadPayloads(symbols) {
  const fixturePath = new URL("./smoke-data.json", import.meta.url);
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const bySym = Object.fromEntries(fixture.map((f) => [f.symbol, f]));
  const payloads = [];

  for (const sym of symbols) {
    process.stdout.write(`Fetching ${sym} live quote... `);
    const meta = await yahooChart(sym);
    const base = structuredClone(bySym[sym] ?? { symbol: sym, name: sym });
    base.asOf = new Date().toISOString();
    base.quote = {
      ...base.quote,
      price: num(meta.regularMarketPrice),
      changePct: num(
        meta.chartPreviousClose
          ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100
          : null
      ),
    };
    base.name = meta.longName ?? meta.shortName ?? base.name;
    base.exchange = meta.fullExchangeName ?? base.exchange;
    payloads.push(base);
    console.log(`$${base.quote.price}`);
  }
  return payloads;
}

function pct(n) {
  if (n == null || Number.isNaN(n)) return null;
  return +(n * 100).toFixed(2);
}

function num(n, d = 2) {
  if (n == null || Number.isNaN(n)) return null;
  return +Number(n).toFixed(d);
}

function fmtCap(n) {
  if (n == null) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n}`;
}

const SYSTEM_PROMPT = `Act as an elite equity research analyst at a top-tier investment fund.
Analyze using BOTH the injected fundamentals JSON (ONLY source for numbers) and qualitative sector/macro knowledge.
Structure per the framework. Use markdown. Be concise and professional. Do not explain your process.

Hidden thesis: Aggressive Growth. Goal: Retire in 18yrs extremely wealthy.

Sections:
1. Fundamental Analysis
2. Thesis Validation (3 bull, 2 bear, verdict Bullish/Bearish/Neutral)
3. Sector & Macro View
4. Catalyst Watch (short + long term)
5. Investment Summary (5 bullets, Buy/Hold/Sell, confidence, timeframe)

End with JSON block:
\`\`\`json
{"verdict":"","recommendation":"","confidence":"","timeframe":""}
\`\`\``;

function buildUserPrompt(mode, payloads) {
  if (mode === "separate") {
    return payloads
      .map(
        (p) =>
          `Produce a full equity research report for:\n\n${JSON.stringify(p, null, 2)}`
      )
      .join("\n\n---\n\n");
  }
  return `Produce ONE comparative equity research report for these companies (side-by-side where relevant):\n\n${JSON.stringify(payloads, null, 2)}`;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

async function callAnthropic(system, user) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");

  const model = process.env.ZENBUY_MODEL || "claude-sonnet-4-20250514";
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const elapsed = Date.now() - t0;
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${JSON.stringify(body)}`);
  }
  const text = body.content?.map((c) => c.text).join("") ?? "";
  return {
    model,
    elapsedMs: elapsed,
    inputTokens: body.usage?.input_tokens,
    outputTokens: body.usage?.output_tokens,
    text,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

async function main() {
  const symbols = TICKERS.length ? TICKERS : ["AAPL", "CSCO", "PANW", "NET"];
  console.log(`\nZenBuy smoke test — symbols: ${symbols.join(", ")} | mode: ${MODE} | llm: ${RUN_LLM}\n`);

  const tFetch = Date.now();
  const payloads = await loadPayloads(symbols);
  const fetchMs = Date.now() - tFetch;

  const userPrompt = buildUserPrompt(MODE, payloads);
  const inputEst = estimateTokens(SYSTEM_PROMPT + userPrompt);

  console.log("\n--- Fundamentals payload (sample: first symbol) ---");
  console.log(JSON.stringify(payloads[0], null, 2));
  console.log(`\nFetch time: ${fetchMs}ms for ${symbols.length} symbols`);
  console.log(`Injected JSON total: ${JSON.stringify(payloads).length} chars (~${estimateTokens(JSON.stringify(payloads))} tokens)`);
  console.log(`Full prompt estimate: ~${inputEst} input tokens (system + user)`);

  if (!RUN_LLM) {
    console.log("\nSkipping LLM (--llm not passed). Re-run with ANTHROPIC_API_KEY and --llm to measure output.");
    console.log("\nCost estimate (Claude Sonnet ~$3/M in, $15/M out):");
    for (const out of [2500, 4000, 6000, 8000]) {
      const cost = (inputEst / 1e6) * 3 + (out / 1e6) * 15;
      console.log(`  If output ${out} tokens → ~$${cost.toFixed(3)} per request (${MODE}, ${symbols.length} tickers)`);
    }
    return;
  }

  console.log("\nCalling Anthropic...");
  const result = await callAnthropic(SYSTEM_PROMPT, userPrompt);
  console.log("\n--- LLM result ---");
  console.log(`Model: ${result.model}`);
  console.log(`Latency: ${result.elapsedMs}ms`);
  console.log(`Tokens: in=${result.inputTokens} out=${result.outputTokens}`);
  console.log(`Words: ${result.words}`);
  console.log(`Chars: ${result.text.length}`);
  const inCost = ((result.inputTokens ?? inputEst) / 1e6) * 3;
  const outCost = ((result.outputTokens ?? 0) / 1e6) * 15;
  console.log(`Est. cost: $${(inCost + outCost).toFixed(4)}`);

  const outPath = new URL("../smoke-output.md", import.meta.url);
  await writeFile(outPath, result.text, "utf8");
  console.log(`\nFull report written to ${outPath.pathname}`);
  console.log("\n--- Preview (first 1200 chars) ---\n");
  console.log(result.text.slice(0, 1200));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
