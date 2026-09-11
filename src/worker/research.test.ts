import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUserPrompt, getSystemPrompt } from "./prompt.ts";
import {
  ANTHROPIC_OUTPUT_EFFORT,
  DEFAULT_BACKUP_MODEL,
  DEFAULT_BACKUP_PROVIDER,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_PRIMARY_PROVIDER,
  RESEARCH_MAX_TOKENS,
  XAI_REASONING_EFFORT,
  buildAnthropicMessagesBody,
  buildXaiChatBody,
  classifyUpstreamFailure,
  isProviderBillingError,
  planFailoverChain,
  shouldFailoverStatus,
} from "./research.ts";

const LIVE_BILLING_400 =
  '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CexBknLFcXGG6ndYEMMv2"}';

describe("Anthropic failure classification", () => {
  it("does not fail over ordinary 400 prompt bugs", () => {
    const classified = classifyUpstreamFailure(
      400,
      '{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: Extra inputs are not permitted"}}'
    );
    assert.equal(shouldFailoverStatus(400), false);
    assert.equal(classified.failover, false);
    assert.equal(classified.sameProviderUseless, false);
    assert.match(classified.message, /Analysis unavailable \(400\)/);
  });

  it("treats Anthropic empty-balance 400 as failover and skips Sonnet", () => {
    assert.equal(isProviderBillingError(LIVE_BILLING_400), true);
    const classified = classifyUpstreamFailure(400, LIVE_BILLING_400);
    assert.equal(classified.failover, true);
    assert.equal(classified.sameProviderUseless, true);
    assert.match(classified.message, /out of credits/);
  });

  it("treats HTTP 402 billing_error as same-provider-useless failover", () => {
    const classified = classifyUpstreamFailure(
      402,
      '{"type":"error","error":{"type":"billing_error","message":"Your credit balance is too low."}}'
    );
    assert.equal(classified.failover, true);
    assert.equal(classified.sameProviderUseless, true);
  });

  it("still fails over 429 / 5xx without calling them billing", () => {
    assert.equal(isProviderBillingError("rate_limit_error"), false);
    const classified = classifyUpstreamFailure(429, "rate_limit_error");
    assert.equal(classified.failover, true);
    assert.equal(classified.sameProviderUseless, false);
  });
});

describe("research stack defaults", () => {
  it("uses Grok 4.5 primary and Claude Sonnet 5 backup — not Opus", () => {
    assert.equal(DEFAULT_PRIMARY_MODEL, "grok-4.5");
    assert.equal(DEFAULT_PRIMARY_PROVIDER, "xai");
    assert.equal(DEFAULT_BACKUP_MODEL, "claude-sonnet-5");
    assert.equal(DEFAULT_BACKUP_PROVIDER, "anthropic");
    assert.notEqual(DEFAULT_PRIMARY_MODEL, "claude-opus-5");
    assert.notEqual(DEFAULT_BACKUP_MODEL, "grok-4.5");
    assert.equal(XAI_REASONING_EFFORT, "high");
    assert.equal(ANTHROPIC_OUTPUT_EFFORT, "medium");
  });

  it("plans Grok → Sonnet when both keys are present", () => {
    const chain = planFailoverChain({
      XAI_API_KEY: "xai-test",
      ANTHROPIC_API_KEY: "ant-test",
    } as Env);
    assert.deepEqual(chain, [
      { provider: "xai", model: "grok-4.5" },
      { provider: "anthropic", model: "claude-sonnet-5" },
    ]);
  });

  it("skips Grok when the xAI key is missing (Anthropic backup still runs)", () => {
    const chain = planFailoverChain({
      ANTHROPIC_API_KEY: "ant-test",
    } as Env);
    assert.deepEqual(chain, [
      { provider: "anthropic", model: "claude-sonnet-5" },
    ]);
  });

  it("stays Grok-only when Anthropic key is missing", () => {
    const chain = planFailoverChain({
      XAI_API_KEY: "xai-test",
    } as Env);
    assert.deepEqual(chain, [{ provider: "xai", model: "grok-4.5" }]);
  });
});

describe("Anthropic Messages payload shape", () => {
  it("builds a schema-valid streaming Messages body for short-horizon AVGO", () => {
    const system = getSystemPrompt("aggressive_growth", 2);
    const user = buildUserPrompt(
      "separate",
      [{ symbol: "AVGO", name: "Broadcom Inc" }],
      "aggressive_growth",
      2
    );
    const body = buildAnthropicMessagesBody(
      "claude-sonnet-5",
      system,
      user,
      RESEARCH_MAX_TOKENS
    );

    assert.equal(body.model, "claude-sonnet-5");
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 12_000);
    assert.equal(body.output_config.effort, "medium");
    assert.notEqual(body.output_config.effort, "max");
    assert.ok(Number.isInteger(body.max_tokens) && body.max_tokens > 0);
    assert.equal(typeof body.system, "string");
    assert.ok(body.system.length > 200);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, "user");
    assert.equal(typeof body.messages[0].content, "string");
    assert.ok(body.messages[0].content.includes("AVGO"));

    // JSON round-trip matches what fetch() posts (no NaN / undefined holes).
    const serialized = JSON.stringify(body);
    const parsed = JSON.parse(serialized) as typeof body;
    assert.deepEqual(parsed, body);
    assert.ok(serialized.length < 32 * 1024 * 1024);

    assert.match(body.system, /HARD HORIZON/);
    assert.match(body.system, /~2-year compounding/);
    assert.doesNotMatch(body.system, /18-year compounding/);
    assert.match(body.messages[0].content, /~2-year profit window/);
  });

  it("keeps long-window Aggressive Growth on the directive 18-year STRUCTURE", () => {
    const body = buildAnthropicMessagesBody(
      "claude-sonnet-5",
      getSystemPrompt("aggressive_growth", 18),
      buildUserPrompt("separate", [{ symbol: "AVGO" }], "aggressive_growth", 18),
      RESEARCH_MAX_TOKENS
    );
    assert.match(body.system, /~18-year compounding/);
    assert.match(body.system, /12-month \+ 5-year \+ 18-year outlook/);
    JSON.parse(JSON.stringify(body));
  });
});

describe("xAI Chat Completions payload shape", () => {
  it("omits deprecated search_parameters (xAI 410 Live search is deprecated)", () => {
    const body = buildXaiChatBody(
      "grok-4.5",
      getSystemPrompt("aggressive_growth", 2),
      buildUserPrompt("separate", [{ symbol: "AVGO" }], "aggressive_growth", 2),
      RESEARCH_MAX_TOKENS
    );
    assert.equal(body.model, "grok-4.5");
    assert.equal(body.stream, true);
    assert.equal(body.max_completion_tokens, 12_000);
    assert.equal(body.reasoning_effort, "high");
    assert.notEqual(body.reasoning_effort, "xhigh");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    assert.ok(body.messages[1].content.includes("AVGO"));
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, "search_parameters"),
      false
    );
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /search_parameters/);
    assert.doesNotMatch(serialized, /"xhigh"|"max"/);
    assert.deepEqual(JSON.parse(serialized), body);
  });
});
