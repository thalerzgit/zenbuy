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
  analyzeStream,
  anthropicThinkingFor,
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
  it("uses Grok 4.7 primary and Claude Sonnet 5.5 backup — not Opus", () => {
    assert.equal(DEFAULT_PRIMARY_MODEL, "grok-4.7");
    assert.equal(DEFAULT_PRIMARY_PROVIDER, "xai");
    assert.equal(DEFAULT_BACKUP_MODEL, "claude-sonnet-5-5");
    assert.equal(DEFAULT_BACKUP_PROVIDER, "anthropic");
    assert.notEqual(DEFAULT_PRIMARY_MODEL, "claude-opus-5");
    assert.notEqual(DEFAULT_BACKUP_MODEL, "grok-4.7");
    assert.equal(XAI_REASONING_EFFORT, "high");
    assert.equal(ANTHROPIC_OUTPUT_EFFORT, "medium");
  });

  it("plans Grok → Sonnet when both keys are present", () => {
    const chain = planFailoverChain({
      XAI_API_KEY: "xai-test",
      ANTHROPIC_API_KEY: "ant-test",
    } as Env);
    assert.deepEqual(chain, [
      { provider: "xai", model: "grok-4.7" },
      { provider: "anthropic", model: "claude-sonnet-5-5" },
    ]);
  });

  it("skips Grok when the xAI key is missing (Anthropic backup still runs)", () => {
    const chain = planFailoverChain({
      ANTHROPIC_API_KEY: "ant-test",
    } as Env);
    assert.deepEqual(chain, [
      { provider: "anthropic", model: "claude-sonnet-5-5" },
    ]);
  });

  it("stays Grok-only when Anthropic key is missing", () => {
    const chain = planFailoverChain({
      XAI_API_KEY: "xai-test",
    } as Env);
    assert.deepEqual(chain, [{ provider: "xai", model: "grok-4.7" }]);
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
      "claude-sonnet-5-5",
      system,
      user,
      RESEARCH_MAX_TOKENS
    );

    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 12_000);
    assert.equal(body.output_config.effort, "medium");
    assert.notEqual(body.output_config.effort, "max");
    assert.deepEqual(body.thinking, { type: "between_tools" });
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
      "claude-sonnet-5-5",
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
      "grok-4.7",
      getSystemPrompt("aggressive_growth", 2),
      buildUserPrompt("separate", [{ symbol: "AVGO" }], "aggressive_growth", 2),
      RESEARCH_MAX_TOKENS
    );
    assert.equal(body.model, "grok-4.7");
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

describe("provider failover on credential / billing rejection", () => {
  const XAI_TEAM_BLOCKED_403 =
    '{"code":"The caller does not have permission to execute the specified operation","error":"Your team is blocked."}';
  const XAI_BAD_KEY_401 =
    '{"code":"Client specified an invalid argument","error":"Incorrect API key provided."}';

  function anthropicSse(text: string): Response {
    const events = [
      { type: "message_start", message: { stop_reason: null } },
      { type: "content_block_delta", delta: { type: "text_delta", text } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ];
    const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  function xaiSse(text: string): Response {
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n` +
      "data: [DONE]\n\n";
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  type Route = (url: string) => Response;

  async function withFetch<T>(route: Route, fn: (calls: string[]) => Promise<T>): Promise<T> {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return route(url);
    }) as typeof fetch;
    console.log = console.warn = console.error = () => {};
    try {
      return await fn(calls);
    } finally {
      globalThis.fetch = orig;
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
    }
  }

  const bothKeys = {
    XAI_API_KEY: "xai-test",
    ANTHROPIC_API_KEY: "ant-test",
  } as Env;

  const isXai = (u: string) => u.includes("api.x.ai");
  const isAnthropic = (u: string) => u.includes("api.anthropic.com");

  for (const [status, errBody] of [
    [403, XAI_TEAM_BLOCKED_403],
    [401, XAI_BAD_KEY_401],
  ] as const) {
    it(`falls back to Claude when Grok returns ${status}`, async () => {
      let painted = "";
      const result = await withFetch(
        (url) => {
          if (isXai(url)) return new Response(errBody, { status });
          if (isAnthropic(url)) return anthropicSse("## BOTTOM LINE\nAVGO from Claude");
          throw new Error(`unexpected fetch ${url}`);
        },
        async (calls) => {
          const r = await analyzeStream(bothKeys, "sys", "user", 100, (t) => {
            painted += t;
          });
          assert.equal(calls.filter(isXai).length, 1);
          assert.equal(calls.filter(isAnthropic).length, 1);
          assert.ok(isXai(calls[0]), "Grok is tried first");
          return r;
        }
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.provider, "anthropic");
      assert.equal(result.model, "claude-sonnet-5-5");
      assert.match(result.text, /AVGO from Claude/);
      assert.match(painted, /AVGO from Claude/);
    });
  }

  it("falls back on 402 and quota 429 from the primary", async () => {
    for (const [status, errBody] of [
      [402, '{"error":"billing_error"}'],
      [429, '{"error":"Your team has either used all available credits or reached its monthly spending limit."}'],
    ] as const) {
      const result = await withFetch(
        (url) =>
          isXai(url) ? new Response(errBody, { status }) : anthropicSse("served by Claude"),
        () => analyzeStream(bothKeys, "sys", "user", 100, () => {})
      );
      assert.equal(result.ok, true, `status ${status}`);
      if (result.ok) assert.equal(result.provider, "anthropic");
    }
    assert.equal(
      classifyUpstreamFailure(
        429,
        '{"error":"Your team has either used all available credits or reached its monthly spending limit."}'
      ).sameProviderUseless,
      true
    );
  });

  it("is symmetric: Anthropic primary 403 falls back to Grok", async () => {
    const env = {
      ...bothKeys,
      ZENBUY_PRIMARY_PROVIDER: "anthropic",
      ZENBUY_MODEL: "claude-sonnet-5-5",
      ZENBUY_BACKUP_PROVIDER: "xai",
      ZENBUY_BACKUP_MODEL: "grok-4.7",
    } as Env;
    const result = await withFetch(
      (url) =>
        isAnthropic(url)
          ? new Response('{"type":"error","error":{"type":"permission_error"}}', { status: 403 })
          : xaiSse("served by Grok"),
      () => analyzeStream(env, "sys", "user", 100, () => {})
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.provider, "xai");
      assert.equal(result.model, "grok-4.7");
    }
  });

  it("only shows the credentials error when both providers reject", async () => {
    const result = await withFetch(
      (url) =>
        isXai(url)
          ? new Response(XAI_TEAM_BLOCKED_403, { status: 403 })
          : new Response('{"type":"error","error":{"type":"authentication_error"}}', { status: 401 }),
      (calls) =>
        analyzeStream(bothKeys, "sys", "user", 100, () => {}).then((r) => {
          assert.equal(calls.length, 2);
          return r;
        })
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /rejected our credentials/);
  });

  it("serves from Grok without touching Claude when Grok is healthy", async () => {
    const result = await withFetch(
      (url) => (isXai(url) ? xaiSse("served by Grok") : anthropicSse("nope")),
      (calls) =>
        analyzeStream(bothKeys, "sys", "user", 100, () => {}).then((r) => {
          assert.equal(calls.length, 1);
          return r;
        })
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.provider, "xai");
  });

  it("still does not fail over an ordinary 400 prompt bug", async () => {
    const result = await withFetch(
      (url) =>
        isXai(url)
          ? new Response('{"error":"max_completion_tokens: invalid"}', { status: 400 })
          : anthropicSse("should not run"),
      (calls) =>
        analyzeStream(bothKeys, "sys", "user", 100, () => {}).then((r) => {
          assert.equal(calls.length, 1);
          return r;
        })
    );
    assert.equal(result.ok, false);
  });

  it("classifies 401/403 as failover", () => {
    for (const s of [401, 402, 403]) {
      assert.equal(shouldFailoverStatus(s), true);
      const c = classifyUpstreamFailure(s, "");
      assert.equal(c.failover, true);
      assert.equal(c.sameProviderUseless, true);
    }
  });
});
