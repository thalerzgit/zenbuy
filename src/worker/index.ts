import { randomError } from "./errors";
import {
  appendReportArchive,
  cacheGet,
  cacheSet,
  fundCacheKey,
  parseReportCacheKey,
  reportCacheKey,
  SHARE_TTL_SECONDS,
  LAUNCH_TTL_SECONDS,
  launchCacheKey,
  type CachedReport,
  type LaunchSession,
  type SharedReportSnapshot,
} from "./cache";
import {
  enrichPayloadsForResearch,
  extractArchiveEntry,
  type ResearchPayload,
} from "./enrich";
import {
  DEFAULT_DIRECTIVE_ID,
  directivesForClient,
  getInvestmentDirective,
  isInvestmentDirectiveId,
  type InvestmentDirectiveId,
} from "../lib/investment-directives";
import { PROFIT_HORIZON_OPTIONS } from "../lib/profit-horizons";
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
  companyProfilesFromMarkdown,
  parseReport,
  renderMarkdown,
  scorecardHtml,
} from "./parse";
import { discoverPicksForGoal } from "./discover";
import { findSimilarSymbols } from "./similar";
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
    investmentDirectives: directivesForClient(),
    defaultDirectiveId: DEFAULT_DIRECTIVE_ID,
    profitHorizonOptions: PROFIT_HORIZON_OPTIONS,
  });
}

async function handleDiscover(request: Request, env: Env): Promise<Response> {
  if (!env.FINNHUB_API_KEY) {
    return json({ error: "Discovery unavailable" }, 503);
  }

  const url = new URL(request.url);
  const directiveRaw = url.searchParams.get("directive") ?? DEFAULT_DIRECTIVE_ID;
  const directive: InvestmentDirectiveId = isInvestmentDirectiveId(directiveRaw)
    ? directiveRaw
    : DEFAULT_DIRECTIVE_ID;

  const profitHorizonYears = Math.min(
    25,
    Math.max(
      2,
      Number(url.searchParams.get("horizon") ?? "") ||
        getInvestmentDirective(directive).promptHorizonYears
    )
  );
  const limit = Math.min(
    4,
    Math.max(1, Number(url.searchParams.get("limit") ?? 4))
  );

  try {
    const picks = await discoverPicksForGoal(
      env,
      directive,
      profitHorizonYears,
      limit
    );
    if (!picks.length) {
      return json(
        {
          error: "No matches found right now. Try again in a moment.",
          code: "empty",
        },
        503
      );
    }
    return json({
      picks,
      directive,
      profitHorizonYears,
      directiveLabel: getInvestmentDirective(directive).label,
    });
  } catch (e) {
    console.error("discover failed", e);
    return json({ error: "Couldn't find matching stocks.", code: "discover_failed" }, 500);
  }
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
function parseReportIdParts(reportId: string): {
  mode: string;
  directive: InvestmentDirectiveId;
  profitHorizonYears?: number;
  symbols: string[];
} {
  return parseReportCacheKey(reportId);
}

function stripLaymanBottomLine(md: string): string {
  return md.replace(/^##\s*Bottom line\b[\s\S]*?(?=\n##\s+|$)/im, "").trim();
}

async function handleCreateShare(request: Request, env: Env): Promise<Response> {
  let body: { reportId?: string; variant?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request.", code: "bad_request" }, 400);
  }

  const reportId = (body.reportId ?? "").trim();
  const variant = body.variant === "layman" ? "layman" : "full";
  if (!reportId.startsWith("report:") || reportId.length > 200) {
    return json({ error: "Generate a report first.", code: "not_found" }, 404);
  }

  let snapshot: SharedReportSnapshot | null = null;

  if (variant === "layman") {
    const layman = await cacheGet<{
      bottomLineHtml: string;
      bodyHtml: string;
    }>(env.CACHE, `layman:${reportId}`);
    if (!layman?.bodyHtml) {
      return json(
        {
          error: "Plain-English version not ready. Tap Explain in Lay Terms first.",
          code: "layman_missing",
        },
        404
      );
    }
    const { mode, symbols } = parseReportIdParts(reportId);
    snapshot = {
      reportId,
      variant: "layman",
      mode,
      symbols,
      badges: {},
      bottomLineHtml: layman.bottomLineHtml,
      bodyHtml: layman.bodyHtml,
      scorecardHtml: "",
      asOf: "",
      stale: false,
    };
  } else {
    const report = await cacheGet<CachedReport>(env.CACHE, reportId);
    if (!report?.bodyHtml) {
      return json(
        {
          error: "That report has expired. Generate a fresh one to share.",
          code: "report_expired",
        },
        404
      );
    }
    const { mode, symbols } = parseReportIdParts(reportId);
    snapshot = {
      reportId,
      variant: "full",
      mode,
      symbols,
      badges: report.badges,
      bottomLineHtml: report.bottomLineHtml,
      bodyHtml: report.bodyHtml,
      scorecardHtml: report.scorecardHtml,
      asOf: report.asOf,
      stale: report.stale,
    };
  }

  const shareId = `share:${crypto.randomUUID()}`;
  await cacheSet(env.CACHE, shareId, snapshot, SHARE_TTL_SECONDS);
  return json({ shareId });
}

async function handleGetReport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const reportId = (url.searchParams.get("id") ?? "").trim();
  if (
    !reportId.startsWith("report:") &&
    !reportId.startsWith("share:") &&
    !reportId.startsWith("layman:")
  ) {
    return json({ error: "Report not found.", code: "not_found" }, 404);
  }
  if (reportId.length > 220) {
    return json({ error: "Report not found.", code: "not_found" }, 404);
  }

  if (reportId.startsWith("share:")) {
    const snapshot = await cacheGet<SharedReportSnapshot>(env.CACHE, reportId);
    if (!snapshot?.bodyHtml) {
      return json(
        {
          error: "This share link has expired. Ask for a fresh link.",
          code: "share_expired",
        },
        404
      );
    }
    return json({
      reportId: snapshot.reportId,
      shareId: reportId,
      variant: snapshot.variant,
      mode: snapshot.mode,
      symbols: snapshot.symbols,
      badges: snapshot.badges,
      bottomLineHtml: snapshot.bottomLineHtml,
      bodyHtml: snapshot.bodyHtml,
      scorecardHtml: snapshot.scorecardHtml,
      asOf: snapshot.asOf,
      stale: snapshot.stale,
    });
  }

  const sourceKey = reportId.startsWith("layman:") ? reportId : reportId;
  if (reportId.startsWith("layman:")) {
    const layman = await cacheGet<{
      bottomLineHtml: string;
      bodyHtml: string;
    }>(env.CACHE, sourceKey);
    if (!layman?.bodyHtml) {
      return json(
        {
          error: "That shared report has expired. Generate a fresh one.",
          code: "report_expired",
        },
        404
      );
    }
    const baseId = reportId.slice("layman:".length);
    const { mode, symbols } = parseReportIdParts(baseId);
    return json({
      reportId: baseId,
      variant: "layman",
      mode,
      symbols,
      badges: {},
      bottomLineHtml: layman.bottomLineHtml,
      bodyHtml: layman.bodyHtml,
      scorecardHtml: "",
      asOf: "",
      stale: false,
    });
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

  const { mode, symbols } = parseReportIdParts(reportId);

  return json({
    reportId,
    variant: "full",
    mode,
    symbols,
    badges: report.badges,
    bottomLineHtml: report.bottomLineHtml,
    bodyHtml: report.bodyHtml,
    scorecardHtml: report.scorecardHtml,
    companies: report.markdown
      ? companyProfilesFromMarkdown(report.markdown, symbols)
      : [],
    asOf: report.asOf,
    stale: report.stale,
  });
}

async function handleSimilar(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return json({ error: "Ticker required.", code: "bad_request" }, 400);
  }

  let scores: import("./parse").Scorecard = {};
  try {
    const raw = url.searchParams.get("scores");
    if (raw) scores = JSON.parse(raw) as import("./parse").Scorecard;
  } catch {
    return json({ error: "Invalid score profile.", code: "bad_request" }, 400);
  }

  const exclude = (url.searchParams.get("exclude") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  try {
    const symbols = await findSimilarSymbols(env, symbol, scores, exclude, 3);
    if (!symbols.length) {
      return json(
        { error: "No similar names found right now. Try again later.", code: "empty" },
        404
      );
    }
    return json({ symbols, source: symbol });
  } catch (e) {
    console.error("similar lookup failed", e);
    return json({ error: "Couldn't find similar companies.", code: "similar_failed" }, 500);
  }
}

/** Issue a one-time launch pass after Turnstile on "Show more like this". */
async function handleCreateLaunch(request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);
  let body: {
    symbols?: string[];
    mode?: "separate" | "comparative";
    directive?: string;
    profitHorizonYears?: number;
    turnstileToken?: string;
  };

  try {
    body = await request.json();
  } catch {
    return json({ error: randomError(), retry: true }, 400);
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

  const symbols = (body.symbols ?? [])
    .map((s) => s.toUpperCase().trim())
    .filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s));
  if (symbols.length < 1 || symbols.length > 4) {
    return json({ error: "Select 1 to 4 tickers.", retry: true }, 400);
  }

  const directive: InvestmentDirectiveId = isInvestmentDirectiveId(body.directive ?? "")
    ? (body.directive as InvestmentDirectiveId)
    : DEFAULT_DIRECTIVE_ID;
  const profitHorizonYears = Math.min(
    25,
    Math.max(
      2,
      Number(body.profitHorizonYears) ||
        getInvestmentDirective(directive).promptHorizonYears
    )
  );
  const mode = body.mode === "comparative" ? "comparative" : "separate";

  const launchId = crypto.randomUUID();
  const session: LaunchSession = {
    symbols,
    mode,
    directive,
    profitHorizonYears,
  };
  await cacheSet(env.CACHE, launchCacheKey(launchId), session, LAUNCH_TTL_SECONDS);
  return json({ launchId, symbols, mode, directive, profitHorizonYears });
}

/** Read a launch pass for autostart UI (does not consume it). */
async function handleGetLaunch(request: Request, env: Env): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id || id.length > 64) {
    return json({ error: "Launch link invalid.", code: "bad_request" }, 400);
  }

  const session = await cacheGet<LaunchSession>(env.CACHE, launchCacheKey(id));
  if (!session) {
    return json(
      {
        error: "This link expired. Use Show more like this again from a report.",
        retry: true,
        code: "launch_expired",
      },
      404
    );
  }

  return json({
    symbols: session.symbols,
    mode: session.mode,
    directive: session.directive,
    profitHorizonYears: session.profitHorizonYears,
  });
}

async function consumeLaunchSession(
  env: Env,
  launchId: string,
  symbols: string[]
): Promise<LaunchSession | null> {
  const key = launchCacheKey(launchId);
  const session = await cacheGet<LaunchSession>(env.CACHE, key);
  if (!session) return null;

  const requested = [...symbols].map((s) => s.toUpperCase()).sort();
  const allowed = [...session.symbols].map((s) => s.toUpperCase()).sort();
  if (requested.join(",") !== allowed.join(",")) return null;

  await env.CACHE.delete(key);
  return session;
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
              send("body", {
                html: renderMarkdown(stripLaymanBottomLine(full)),
                streaming: true,
              });
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
            const bodyHtml = renderMarkdown(stripLaymanBottomLine(text));

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
    directive?: string;
    profitHorizonYears?: number;
    turnstileToken?: string;
    launchId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return json({ error: randomError(), retry: true }, 400);
  }

  let symbols = (body.symbols ?? [])
    .map((s) => s.toUpperCase().trim())
    .filter(Boolean);
  let mode = body.mode ?? "separate";
  let directive: InvestmentDirectiveId = isInvestmentDirectiveId(
    body.directive ?? ""
  )
    ? (body.directive as InvestmentDirectiveId)
    : DEFAULT_DIRECTIVE_ID;
  let profitHorizonYears = Math.min(
    25,
    Math.max(
      2,
      Number(body.profitHorizonYears) ||
        getInvestmentDirective(directive).promptHorizonYears
    )
  );

  const launchId = (body.launchId ?? "").trim();
  let usedLaunch = false;
  if (launchId) {
    const session = await consumeLaunchSession(env, launchId, symbols);
    if (!session) {
      return json(
        {
          error:
            "This auto-start link expired. Use Show more like this again from the prior report.",
          retry: true,
          code: "launch_expired",
        },
        403
      );
    }
    symbols = session.symbols;
    mode = session.mode;
    directive = session.directive;
    profitHorizonYears = session.profitHorizonYears;
    usedLaunch = true;
  }

  if (symbols.length < 1 || symbols.length > 4) {
    return json({ error: "Select 1 to 4 tickers.", retry: true }, 400);
  }
  if (symbols.length > 1 && mode !== "separate" && mode !== "comparative") {
    return json({ error: "Choose separate or comparative mode.", retry: true }, 400);
  }

  if (!isNativeIOSClient(request) && !usedLaunch) {
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
  const cacheKey = reportCacheKey(mode, symbols, directive, profitHorizonYears);
  const cached = await cacheGet<CachedReport>(env.CACHE, cacheKey);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(sseLine(event, data)));
      };

      try {
        if (cached) {
          const {
            mode: cachedMode,
            symbols: cachedSymbols,
            directive: cachedDirective,
            profitHorizonYears: cachedHorizon,
          } = parseReportIdParts(cacheKey);
          send("meta", {
            cached: true,
            asOf: cached.asOf,
            showAsOf: cached.stale,
            directive: cachedDirective,
            directiveLabel: getInvestmentDirective(cachedDirective).label,
            profitHorizonYears: cachedHorizon ?? profitHorizonYears,
          });
          send("sticky", {
            bottomLineHtml: cached.bottomLineHtml,
            badges: cached.badges,
            scorecardHtml: cached.scorecardHtml,
          });
          send("body", { html: cached.bodyHtml });
          if (cached.markdown) {
            send("companies", {
              companies: companyProfilesFromMarkdown(
                cached.markdown,
                cachedSymbols
              ),
              mode: cachedMode,
            });
          }
          send("done", {
            badges: cached.badges,
            reportId:
              cached.markdown && cached.markdown.length >= 80 ? cacheKey : "",
            directive: cachedDirective,
            directiveLabel: getInvestmentDirective(cachedDirective).label,
            profitHorizonYears: cachedHorizon ?? profitHorizonYears,
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

        const enrichedPayloads: ResearchPayload[] = await enrichPayloadsForResearch(
          env,
          payloads,
          directive
        );

        // Comparative needs at least two names to compare.
        const effectiveMode = payloads.length > 1 ? mode : "separate";

        const showAsOf = isStalePayload(payloads);
        send("meta", {
          cached: false,
          asOf: oldestAsOf(payloads),
          showAsOf,
          directive,
          directiveLabel: getInvestmentDirective(directive).label,
          profitHorizonYears,
          skipped,
          degraded: payloads
            .filter((p) => p.dataQuality === "degraded")
            .map((p) => p.symbol),
          symbols: payloads.map((p) => ({
            symbol: p.symbol,
            name: p.name,
            price: p.quote.price,
          })),
          macroLive: Boolean(enrichedPayloads[0]?.macro),
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
          const symbolList = payloads.map((p) => p.symbol);
          const companies = companyProfilesFromMarkdown(markdown, symbolList);
          const doneKey = reportCacheKey(
            effectiveMode,
            symbolList,
            directive,
            profitHorizonYears
          );
          await cacheSet(env.CACHE, doneKey, report, ttl);

          const parsed = parseReport(markdown);
          const archiveEntry = extractArchiveEntry(
            markdown,
            parsed.badges,
            parsed.scorecard,
            report.asOf
          );
          await Promise.all(
            symbolList.map((sym) =>
              appendReportArchive(env.CACHE, directive, sym, archiveEntry).catch(
                console.error
              )
            )
          );

          ctx.waitUntil(incrementRateLimit(env, ip).catch(console.error));
          send("companies", { companies, mode: effectiveMode });
          send("done", {
            badges: report.badges,
            reportId: doneKey,
            directive,
            directiveLabel: getInvestmentDirective(directive).label,
            profitHorizonYears,
          });
        };

        const fail = (message: string): void => {
          send("error", { error: message || randomError(), retry: true });
        };

        // Separate reports are independent, so generate them concurrently.
        if (effectiveMode === "separate" && payloads.length > 1) {
          await streamResearchParallel(env, enrichedPayloads, directive, {
            onProgress: (assembled) => renderProgress(assembled),
            onDone: finish,
            onError: fail,
          }, profitHorizonYears);
        } else {
          let full = "";
          await streamResearch(env, effectiveMode, enrichedPayloads, directive, {
            onDelta(text) {
              full += text;
              renderProgress(full);
            },
            onDone: finish,
            onError: fail,
          }, profitHorizonYears);
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

    if (url.pathname === "/api/similar" && request.method === "GET") {
      return handleSimilar(request, env);
    }

    if (url.pathname === "/api/launch" && request.method === "POST") {
      return handleCreateLaunch(request, env);
    }
    if (url.pathname === "/api/launch" && request.method === "GET") {
      return handleGetLaunch(request, env);
    }

    if (url.pathname === "/api/share" && request.method === "POST") {
      return handleCreateShare(request, env);
    }

    if (url.pathname === "/api/search") {
      return handleSearch(request, env);
    }

    if (url.pathname === "/api/discover") {
      return handleDiscover(request, env);
    }

    if (url.pathname === "/api/research" && request.method === "POST") {
      return handleResearch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};
