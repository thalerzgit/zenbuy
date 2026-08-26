import { randomError } from "./errors";
import {
  cacheGet,
  cacheSet,
  fundCacheKey,
  reportCacheKey,
  type CachedReport,
} from "./cache";
import {
  getFundamentalsCached,
  isStalePayload,
  oldestAsOf,
  parseKeyPool,
  searchSymbols,
  type FundamentalsPayload,
  type SymbolResult,
} from "./finnhub";
import {
  parseReport,
  renderMarkdown,
  scorecardHtml,
} from "./parse";
import {
  checkRateLimit,
  incrementRateLimit,
  streamLayman,
  streamResearch,
  streamResearchParallel,
  verifyTurnstile,
} from "./research";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: CORS });
}

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Native iOS app — Turnstile is web-only; rate limits still apply. */
function isNativeIOSClient(request: Request): boolean {
  return request.headers.get("X-ZenBuy-Client")?.toLowerCase() === "ios";
}

function emitParsed(
  send: (event: string, data: unknown) => void,
  markdown: string
): CachedReport {
  const parsed = parseReport(markdown);
  const bottomLineHtml = renderMarkdown(parsed.bottomLine);
  const bodyHtml = renderMarkdown(parsed.body);
  const scoreHtml = scorecardHtml(parsed.scorecard);

  send("sticky", {
    bottomLineHtml,
    badges: parsed.badges,
    scorecardHtml: scoreHtml,
  });
  send("body", { html: bodyHtml });
  send("badges", parsed.badges);

  return {
    markdown,
    badges: parsed.badges,
    bottomLineHtml,
    bodyHtml,
    scorecardHtml: scoreHtml,
    asOf: "",
    stale: false,
  };
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q || q.length < 1) return json({ results: [] });

  if (!env.FINNHUB_API_KEY) {
    return json({ error: "Search unavailable" }, 503);
  }

  // Typeahead fires per keystroke; cache so prefixes don't burn the Finnhub quota.
  const key = `search:${q.toLowerCase()}`;
  const cached = await cacheGet<SymbolResult[]>(env.CACHE, key);
  if (cached) return json({ results: cached });

  try {
    const results = await searchSymbols(env.FINNHUB_API_KEY, q);
    // Misses are cheap to re-check later; hits are stable.
    const ttl = results.length ? 86_400 : 3_600;
    await cacheSet(env.CACHE, key, results, ttl).catch(() => {});
    return json({ results });
  } catch (e) {
    console.error("search failed", e);
    // A throttled lookup should just show no suggestions, not an error banner.
    return json({ results: [], throttled: true });
  }
}

/**
 * Warm a symbol's fundamentals while the user is still picking tickers, so
 * the ~11 Finnhub calls per symbol aren't sitting on the critical path when
 * they hit Generate. Cheap and idempotent: a warm cache returns immediately.
 */
async function handlePrefetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase().trim();
  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return json({ ok: false }, 400);
  }
  if (!env.FINNHUB_API_KEY) return json({ ok: false }, 503);

  if (await env.CACHE.get(fundCacheKey(symbol))) {
    return json({ ok: true, cached: true });
  }

  // Warming costs upstream quota, so cap it per IP per day.
  const guard = `pf:${clientIp(request)}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.CACHE.get(guard)) || 0);
  if (used >= 120) return json({ ok: false, code: "prefetch_limit" });
  ctx.waitUntil(
    env.CACHE.put(guard, String(used + 1), { expirationTtl: 86_400 })
  );

  const ttl = Number(env.CACHE_TTL_SECONDS || 86400);
  ctx.waitUntil(
    getFundamentalsCached(env.CACHE, env.FINNHUB_API_KEY, symbol, ttl).then(
      () => undefined,
      (e) => {
        console.warn("prefetch failed", symbol, e);
      }
    )
  );

  return json({ ok: true, warming: true });
}

/**
 * Upstream reachability, so a failing report can be diagnosed without
 * solving a Turnstile challenge. Reports statuses only — never key material.
 */
async function handleHealth(request: Request, env: Env): Promise<Response> {
  const model = env.ZENBUY_MODEL || "claude-sonnet-5";
  const out: Record<string, unknown> = {
    model,
    keys: {
      finnhub: parseKeyPool(env.FINNHUB_API_KEY ?? "").length,
      anthropic: Boolean(env.ANTHROPIC_API_KEY),
      turnstile: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY),
    },
  };

  // Probing costs real upstream quota, so keep it opt-in.
  if (!new URL(request.url).searchParams.has("deep")) {
    return json({ ...out, hint: "add ?deep=1 to probe upstreams" });
  }

  const cached = await cacheGet<Record<string, unknown>>(env.CACHE, "health");
  if (cached) return json({ ...cached, cached: true });

  // Are keyless quote sources usable from Cloudflare's egress? Both refuse
  // most datacenter IPs, so probe before relying on either as a fallback.
  const probes: Array<[string, string]> = [
    ["stooq", "https://stooq.com/q/l/?s=amzn.us&f=sd2t2ohlcv&h&e=csv"],
    [
      "yahoo",
      "https://query1.finance.yahoo.com/v8/finance/chart/AMZN?range=1d&interval=1d",
    ],
  ];
  const backup: Record<string, unknown> = {};
  await Promise.all(
    probes.map(async ([name, probeUrl]) => {
      try {
        const r = await fetch(probeUrl);
        backup[name] = r.status;
      } catch {
        backup[name] = "unreachable";
      }
    })
  );
  out.backup = backup;

  if (env.FINNHUB_API_KEY) {
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${env.FINNHUB_API_KEY}`
      );
      out.finnhub = r.status;
    } catch {
      out.finnhub = "unreachable";
    }
  }

  if (env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch(
        `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`,
        {
          headers: {
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
        }
      );
      out.anthropic = r.status;
      if (!r.ok) {
        out.anthropicDetail = (await r.text()).slice(0, 200);
        // A retired model id is the likeliest cause; name the valid ones.
        const list = await fetch("https://api.anthropic.com/v1/models?limit=30", {
          headers: {
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
        });
        if (list.ok) {
          const body = (await list.json()) as { data?: Array<{ id?: string }> };
          out.availableModels = (body.data ?? []).map((m) => m.id).filter(Boolean);
        }
      }
    } catch {
      out.anthropic = "unreachable";
    }
  }

  await cacheSet(env.CACHE, "health", out, 60).catch(() => {});
  return json(out);
}

/** Public client config (Turnstile site key is public by design). */
async function handleConfig(env: Env): Promise<Response> {
  return json({
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? "",
  });
}

const SSE_HEADERS = {
  ...CORS,
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/**
 * Rewrite a finished report in plain English.
 *
 * Takes the report's cache id rather than its markdown so a ~30KB document
 * doesn't round-trip through the browser.
 */
/**
 * Public read of a cached report for share links.
 * No Turnstile — the report id is the capability, and KV TTL bounds exposure.
 */
async function handleGetReport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const reportId = (url.searchParams.get("id") ?? "").trim();
  if (!reportId.startsWith("report:") || reportId.length > 200) {
    return json({ error: "Report not found.", code: "not_found" }, 404);
  }

  const report = await cacheGet<CachedReport>(env.CACHE, reportId);
  if (!report?.bodyHtml) {
    return json(
      {
        error: "That shared report has expired. Generate a fresh one.",
        code: "report_expired",
      },
      404
    );
  }

  // Parse mode + tickers from report:mode:SYM1,SYM2
  const parts = reportId.split(":");
  const mode = parts[1] ?? "separate";
  const symbols = (parts[2] ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return json({
    reportId,
    mode,
    symbols,
    badges: report.badges,
    bottomLineHtml: report.bottomLineHtml,
    bodyHtml: report.bodyHtml,
    scorecardHtml: report.scorecardHtml,
    asOf: report.asOf,
    stale: report.stale,
  });
}

async function handleSimplify(request: Request, env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "Research service not configured" }, 503);
  }

  let body: { reportId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: randomError(), retry: true }, 400);
  }

  const reportId = (body.reportId ?? "").trim();
  if (!reportId.startsWith("report:") || reportId.length > 200) {
    return json(
      { error: "Generate a report first, then try again.", retry: true },
      400
    );
  }

  const report = await cacheGet<CachedReport>(env.CACHE, reportId);
  if (!report?.markdown || report.markdown.length < 80) {
    return json(
      {
        error: "That report has expired. Generate it again to simplify it.",
        retry: true,
        code: "report_expired",
      },
      404
    );
  }

  const ttl = Number(env.CACHE_TTL_SECONDS || 86400);
  const laymanKey = `layman:${reportId}`;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(sseLine(event, data)));
      };

      try {
        const cached = await cacheGet<{
          bottomLineHtml: string;
          bodyHtml: string;
        }>(env.CACHE, laymanKey);

        if (cached) {
          send("sticky", {
            bottomLineHtml: cached.bottomLineHtml,
            badges: {},
            scorecardHtml: "",
          });
          send("body", { html: cached.bodyHtml });
          send("done", { layman: true, cached: true });
          controller.close();
          return;
        }

        let full = "";
        let lastAt = 0;
        await streamLayman(env, report.markdown, {
          onDelta(text) {
            full += text;
            const now = Date.now();
            if (full.length > 40 && now - lastAt >= 250) {
              lastAt = now;
              send("body", { html: renderMarkdown(full), streaming: true });
            }
          },
          onDone(text) {
            const bottomMatch = text.match(
              /^##\s*Bottom line\b[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i
            );
            const bottomMd = (bottomMatch?.[1] ?? text.slice(0, 900)).trim();
            const bottomLineHtml = renderMarkdown(
              `## Bottom line\n\n${bottomMd}`
            );
            const bodyHtml = renderMarkdown(text);

            send("sticky", { bottomLineHtml, badges: {}, scorecardHtml: "" });
            send("body", { html: bodyHtml });
            send("done", { layman: true });

            cacheSet(env.CACHE, laymanKey, { bottomLineHtml, bodyHtml }, ttl).catch(
              console.error
            );
          },
          onError(message) {
            send("error", { error: message || randomError(), retry: true });
          },
        });
      } catch (e) {
        console.error("simplify failed", e);
        send("error", {
          error: "We couldn't rewrite that report. Try again?",
          retry: true,
          code: "simplify_failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

async function handleResearch(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!env.FINNHUB_API_KEY || !env.ANTHROPIC_API_KEY) {
    return json({ error: "Research service not configured" }, 503);
  }

  const ip = clientIp(request);
  let body: {
    symbols?: string[];
    mode?: "separate" | "comparative";
    turnstileToken?: string;
  };

  try {
    body = await request.json();
  } catch {
    return json({ error: randomError(), retry: true }, 400);
  }

  const symbols = (body.symbols ?? [])
    .map((s) => s.toUpperCase().trim())
    .filter(Boolean);
  const mode = body.mode ?? "separate";

  if (symbols.length < 1 || symbols.length > 4) {
    return json({ error: "Select 1 to 4 tickers.", retry: true }, 400);
  }
  if (symbols.length > 1 && mode !== "separate" && mode !== "comparative") {
    return json({ error: "Choose separate or comparative mode.", retry: true }, 400);
  }

  if (!isNativeIOSClient(request)) {
    const turnstileOk = await verifyTurnstile(env, body.turnstileToken ?? "", ip);
    if (!turnstileOk) {
      return json(
        {
          error:
            "Human check didn't clear. Tap retry — on iPhone, wait for the check to finish first.",
          retry: true,
          code: "turnstile_failed",
        },
        403
      );
    }
  }

  const allowed = await checkRateLimit(env, ip);
  if (!allowed) {
    return json(
      {
        error:
          "Daily research limit reached. The zen garden is closed until tomorrow.",
        retry: false,
      },
      429
    );
  }

  const ttl = Number(env.CACHE_TTL_SECONDS || 86400);
  const cacheKey = reportCacheKey(mode, symbols);
  const cached = await cacheGet<CachedReport>(env.CACHE, cacheKey);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(sseLine(event, data)));
      };

      try {
        if (cached) {
          send("meta", {
            cached: true,
            asOf: cached.asOf,
            showAsOf: cached.stale,
          });
          send("sticky", {
            bottomLineHtml: cached.bottomLineHtml,
            badges: cached.badges,
            scorecardHtml: cached.scorecardHtml,
          });
          send("body", { html: cached.bodyHtml });
          send("done", {
            badges: cached.badges,
            reportId:
              cached.markdown && cached.markdown.length >= 80 ? cacheKey : "",
          });
          controller.close();
          return;
        }

        // One flaky ticker (delisted, or a throttled Finnhub call) must not
        // sink the whole report.
        const settled = await Promise.allSettled(
          symbols.map((s) =>
            getFundamentalsCached(env.CACHE, env.FINNHUB_API_KEY, s, ttl)
          )
        );

        const payloads: FundamentalsPayload[] = [];
        const skipped: string[] = [];
        settled.forEach((r, i) => {
          if (r.status === "fulfilled") payloads.push(r.value);
          else {
            skipped.push(symbols[i]);
            console.error("fundamentals failed", symbols[i], r.reason);
          }
        });

        if (!payloads.length) {
          send("error", {
            error: `We couldn't pull market data for ${skipped.join(", ")}. The data feed may be rate limited — try again in a moment.`,
            retry: true,
            code: "fundamentals_unavailable",
          });
          controller.close();
          return;
        }

        // Comparative needs at least two names to compare.
        const effectiveMode = payloads.length > 1 ? mode : "separate";

        const showAsOf = isStalePayload(payloads);
        send("meta", {
          cached: false,
          asOf: oldestAsOf(payloads),
          showAsOf,
          skipped,
          degraded: payloads
            .filter((p) => p.dataQuality === "degraded")
            .map((p) => p.symbol),
          symbols: payloads.map((p) => ({
            symbol: p.symbol,
            name: p.name,
            price: p.quote.price,
          })),
        });

        let stickySent = false;
        let lastBodyAt = 0;
        let lastBodyLen = 0;

        // Re-rendering markdown on every token is wasted work on a phone;
        // paint on a cadence instead.
        const BODY_INTERVAL_MS = 250;
        const BODY_GROWTH = 600;

        const renderProgress = (full: string, force = false): void => {
          if (!stickySent && /^##\s*FUNDAMENTALS/im.test(full)) {
            const partial = parseReport(full);
            if (partial.bottomLine) {
              send("sticky", {
                bottomLineHtml: renderMarkdown(partial.bottomLine),
                badges: partial.badges,
                scorecardHtml: "",
              });
              stickySent = true;
            }
          }
          if (!stickySent) return;

          const now = Date.now();
          const grown = full.length - lastBodyLen;
          if (!force && now - lastBodyAt < BODY_INTERVAL_MS && grown < BODY_GROWTH) {
            return;
          }

          const bodyPart = parseReport(full).body;
          if (bodyPart.length > 40) {
            lastBodyAt = now;
            lastBodyLen = full.length;
            send("body", { html: renderMarkdown(bodyPart), streaming: true });
          }
        };

        const finish = async (markdown: string): Promise<void> => {
          const report = emitParsed(send, markdown);
          report.asOf = oldestAsOf(payloads);
          report.stale = showAsOf;
          // Key on what actually made the report, not what was requested.
          const doneKey = reportCacheKey(
            effectiveMode,
            payloads.map((p) => p.symbol)
          );
          await cacheSet(env.CACHE, doneKey, report, ttl);
          ctx.waitUntil(incrementRateLimit(env, ip).catch(console.error));
          send("done", { badges: report.badges, reportId: doneKey });
        };

        const fail = (message: string): void => {
          send("error", { error: message || randomError(), retry: true });
        };

        // Separate reports are independent, so generate them concurrently.
        if (effectiveMode === "separate" && payloads.length > 1) {
          await streamResearchParallel(env, payloads, {
            onProgress: (assembled) => renderProgress(assembled),
            onDone: finish,
            onError: fail,
          });
        } else {
          let full = "";
          await streamResearch(env, effectiveMode, payloads, {
            onDelta(text) {
              full += text;
              renderProgress(full);
            },
            onDone: finish,
            onError: fail,
          });
        }
      } catch (e) {
        console.error("research failed", e);
        send("error", {
          error:
            "We couldn't finish that report. The data feed or analysis service hiccuped — try again?",
          retry: true,
          code: "research_failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function isLinkPreviewBot(request: Request): boolean {
  const ua = request.headers.get("user-agent") ?? "";
  return /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|SkypeUriPreview|Applebot|WhatsApp|TelegramBot|redditbot|Embedly|Quora Link Preview|Iframely/i.test(
    ua
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Humans on www → apex. Link-preview bots stay on www so they can read
    // Open Graph tags without depending on redirect-following.
    if (url.hostname === "www.zenbuy.info" && !isLinkPreviewBot(request)) {
      return Response.redirect(
        `https://zenbuy.info${url.pathname}${url.search}`,
        301
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/api/config") {
      return handleConfig(env);
    }
    if (url.pathname === "/api/health") {
      return handleHealth(request, env);
    }
    if (url.pathname === "/api/prefetch") {
      return handlePrefetch(request, env, ctx);
    }
    if (url.pathname === "/api/simplify" && request.method === "POST") {
      return handleSimplify(request, env);
    }

    if (url.pathname === "/api/report" && request.method === "GET") {
      return handleGetReport(request, env);
    }

    if (url.pathname === "/api/search") {
      return handleSearch(request, env);
    }

    if (url.pathname === "/api/research" && request.method === "POST") {
      return handleResearch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};
