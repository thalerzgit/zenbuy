import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildUserPrompt, getSystemPrompt, midHorizonYearsFor } from "./prompt.ts";
import {
  ANTHROPIC_OUTPUT_EFFORT,
  DEFAULT_BACKUP_MODEL,
  DEFAULT_BACKUP_PROVIDER,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_PRIMARY_PROVIDER,
  DEFAULT_XAI_REASONING_EFFORT,
  RESEARCH_MAX_TOKENS,
  analyzeStream,
  anthropicThinkingFor,
  buildAnthropicMessagesBody,
  buildXaiChatBody,
  classifyUpstreamFailure,
  firstContentMs,
  isProviderBillingError,
  planFailoverChain,
  shouldFailoverStatus,
  xaiReasoningEffort,
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
    assert.equal(DEFAULT_XAI_REASONING_EFFORT, "low");
    assert.equal(ANTHROPIC_OUTPUT_EFFORT, "medium");
    const chain = planFailoverChain({ XAI_API_KEY: "x", ANTHROPIC_API_KEY: "a" } as Env);
    assert.ok(chain.every((a) => !/opus/i.test(a.model)), "Opus is never in the chain");
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

describe("Grok reasoning effort and first-token deadline", () => {
  const effortFor = (raw?: string) =>
    xaiReasoningEffort({ ZENBUY_XAI_REASONING_EFFORT: raw } as Env);

  it("defaults to low and honors only low | medium | high", () => {
    assert.equal(xaiReasoningEffort({} as Env), "low");
    assert.equal(effortFor("low"), "low");
    assert.equal(effortFor("medium"), "medium");
    assert.equal(effortFor("high"), "high");
    assert.equal(effortFor(" High "), "high");
    for (const bad of ["xhigh", "max", "none", "garbage", ""]) {
      assert.equal(effortFor(bad), "low", bad);
    }
  });

  it("clamps ZENBUY_FIRST_TOKEN_MS to 10s–120s, default 45s", () => {
    const deadline = (raw?: string) =>
      firstContentMs({ ZENBUY_FIRST_TOKEN_MS: raw } as Env);
    assert.equal(firstContentMs({} as Env), 45_000);
    assert.equal(deadline("soon"), 45_000);
    assert.equal(deadline("0"), 45_000);
    assert.equal(deadline("10"), 10_000);
    assert.equal(deadline("30000"), 30_000);
    assert.equal(deadline("600000"), 120_000);
  });
});

describe("xAI Chat Completions payload shape", () => {
  const avgoShort = [
    "grok-4.7",
    getSystemPrompt("aggressive_growth", 2),
    buildUserPrompt("separate", [{ symbol: "AVGO" }], "aggressive_growth", 2),
    RESEARCH_MAX_TOKENS,
  ] as const;

  it("omits deprecated search_parameters (xAI 410 Live search is deprecated)", () => {
    const body = buildXaiChatBody(...avgoShort, "low");
    assert.equal(body.model, "grok-4.7");
    assert.equal(body.stream, true);
    assert.equal(body.stream_options.include_usage, true);
    assert.equal(body.max_completion_tokens, 12_000);
    assert.equal(body.reasoning_effort, "low");
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

  it("carries the requested effort and changes nothing else", () => {
    const low = buildXaiChatBody(...avgoShort, "low");
    const high = buildXaiChatBody(...avgoShort, "high");
    assert.equal(high.reasoning_effort, "high");
    assert.deepEqual({ ...high, reasoning_effort: "low" }, low);
  });

  it("keeps today's AVGO 2-year messages byte-identical (horizon guard)", () => {
    const { messages } = buildXaiChatBody(...avgoShort, "low");
    const digest = createHash("sha256").update(JSON.stringify(messages)).digest("hex");
    // Golden prompt bytes: update only with a deliberate prompt.ts change.
    assert.equal(digest, "cdccd66e3385498f15cfedbebd29eb8d4c9744aa0bc48fc22505c4cad21f9be0");
    assert.match(
      messages[1].content,
      new RegExp(`12-month \\+ ${midHorizonYearsFor(2)}-year \\+ 2-year`)
    );
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
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
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

  const sse = (evt: unknown): string => `data: ${JSON.stringify(evt)}\n\n`;
  const reasoningChunk = sse({ choices: [{ delta: { reasoning_content: "Weighing AVGO margins" } }] });
  const contentChunk = (text: string): string =>
    sse({ choices: [{ delta: { content: text } }], usage: null });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Headers at once; each chunk after its delay; then close, hang open, or error. */
  function timedSse(
    steps: Array<[delayMs: number, chunk: string]>,
    end: "close" | "hang" | "error" = "close"
  ): Response {
    const enc = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const [ms, chunk] of steps) {
          await sleep(ms);
          if (cancelled) return;
          controller.enqueue(enc.encode(chunk));
        }
        await sleep(1);
        if (cancelled) return;
        if (end === "close") controller.close();
        if (end === "error") controller.error(new Error("connection reset"));
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  /** Grok thinking out loud forever: reasoning every 2ms, never report text. */
  function xaiReasoningForever(): Response {
    const enc = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setInterval(() => controller.enqueue(enc.encode(reasoningChunk)), 2);
        timer.unref?.();
      },
      cancel() {
        clearInterval(timer);
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  const served = (logs: unknown[][]) =>
    logs.find((args) => args[0] === "analysis served by")?.[1] as
      | Record<string, unknown>
      | undefined;

  type Route = (url: string) => Response;

  async function withFetch<T>(
    route: Route,
    fn: (calls: string[], logs: unknown[][], bodies: unknown[]) => Promise<T>
  ): Promise<T> {
    const calls: string[] = [];
    const logs: unknown[][] = [];
    const bodies: unknown[] = [];
    const orig = globalThis.fetch;
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      return route(url);
    }) as typeof fetch;
    console.log = console.warn = console.error = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      return await fn(calls, logs, bodies);
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

  const finishChunk = sse({ choices: [{ delta: {}, finish_reason: "stop" }], usage: null });

  it("fails over to Claude when Grok only reasons past the first-token deadline", { timeout: 5_000 }, async () => {
    let painted = "";
    const result = await withFetch(
      (url) => {
        if (isXai(url)) return xaiReasoningForever();
        if (isAnthropic(url)) return anthropicSse("## BOTTOM LINE\nAVGO from Claude");
        throw new Error(`unexpected fetch ${url}`);
      },
      async (calls, logs) => {
        const r = await analyzeStream(bothKeys, "sys", "user", 100, (t) => {
          painted += t;
        }, 10);
        assert.deepEqual(calls.map((u) => (isXai(u) ? "xai" : "anthropic")), ["xai", "anthropic"]);
        assert.ok(logs.some((args) => args.join(" ") === "xai first-token timeout"));
        assert.equal(served(logs)?.provider, "anthropic");
        assert.equal(served(logs)?.failover, true);
        assert.equal(served(logs)?.completionTokens, 42);
        return r;
      }
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.provider, "anthropic");
    assert.equal(painted, "## BOTTOM LINE\nAVGO from Claude", "reasoning is never painted");
  });

  it("is symmetric: a silent Anthropic primary fails over to Grok", { timeout: 5_000 }, async () => {
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
          ? timedSse([[0, sse({ type: "message_start", message: { stop_reason: null } })]], "hang")
          : xaiSse("served by Grok"),
      async (_calls, logs) => {
        const r = await analyzeStream(env, "sys", "user", 100, () => {}, 10);
        assert.ok(logs.some((args) => args.join(" ") === "anthropic first-token timeout"));
        return r;
      }
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.provider, "xai");
  });

  it("keeps Grok once report text beats the deadline, however long the rest takes", { timeout: 5_000 }, async () => {
    let painted = "";
    const result = await withFetch(
      (url) =>
        isXai(url)
          ? timedSse([
              [0, reasoningChunk],
              [2, contentChunk("## BOTTOM LINE\nAVGO from Grok")],
              [60, contentChunk(" — still streaming")],
              [0, finishChunk],
            ])
          : anthropicSse("should not run"),
      async (calls, logs) => {
        const r = await analyzeStream(bothKeys, "sys", "user", 100, (t) => {
          painted += t;
        }, 20);
        assert.equal(calls.length, 1);
        assert.equal(served(logs)?.failover, false);
        return r;
      }
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.provider, "xai");
    assert.equal(painted, "## BOTTOM LINE\nAVGO from Grok — still streaming");
  });

  it("never fails over once text is painted, even if the stream then errors", { timeout: 5_000 }, async () => {
    let painted = "";
    const result = await withFetch(
      (url) =>
        isXai(url)
          ? timedSse([[0, contentChunk("## BOTTOM LINE\nAVGO partial")]], "error")
          : anthropicSse("should not run"),
      async (calls) => {
        const r = await analyzeStream(bothKeys, "sys", "user", 100, (t) => {
          painted += t;
        }, 10);
        assert.equal(calls.filter(isAnthropic).length, 0);
        return r;
      }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failover, false);
      assert.match(result.message, /stream dropped/);
    }
    assert.equal(painted, "## BOTTOM LINE\nAVGO partial");
  });

  it("posts low effort with include_usage and logs latency plus token usage", async () => {
    const usageChunk = sse({
      choices: [],
      usage: {
        prompt_tokens: 5_210,
        completion_tokens: 2_875,
        completion_tokens_details: { reasoning_tokens: 333 },
      },
    });
    const result = await withFetch(
      (url) =>
        isXai(url)
          ? timedSse([
              [0, contentChunk("## BOTTOM LINE\nAVGO")],
              [0, finishChunk],
              [0, usageChunk],
              [0, "data: [DONE]\n\n"],
            ])
          : anthropicSse("should not run"),
      async (_calls, logs, bodies) => {
        const r = await analyzeStream(bothKeys, "sys", "user", 100, () => {});
        const posted = bodies[0] as { reasoning_effort?: string; stream_options?: unknown };
        assert.equal(posted.reasoning_effort, "low");
        assert.deepEqual(posted.stream_options, { include_usage: true });
        const log = served(logs);
        assert.equal(log?.provider, "xai");
        assert.equal(log?.model, "grok-4.7");
        assert.equal(log?.effort, "low");
        assert.equal(log?.failover, false);
        assert.equal(log?.promptTokens, 5_210);
        assert.equal(log?.completionTokens, 2_875);
        assert.equal(log?.reasoningTokens, 333);
        assert.equal(typeof log?.ttftMs, "number");
        assert.ok(typeof log?.totalMs === "number" && log.totalMs >= (log.ttftMs as number));
        return r;
      }
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.usage.reasoningTokens, 333);
  });
});
