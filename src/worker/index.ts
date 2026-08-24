import { randomError } from "./errors";
import {
  cacheGet,
  cacheSet,
  reportCacheKey,
  type CachedReport,
} from "./cache";
import {
  getFundamentalsCached,
  isStalePayload,
  oldestAsOf,
  searchSymbols,
} from "./finnhub";
import {
  parseReport,
  renderMarkdown,
  scorecardHtml,
} from "./parse";
import {
  checkRateLimit,
  incrementRateLimit,
  streamResearch,
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

  try {
    const results = await searchSymbols(env.FINNHUB_API_KEY, q);
    return json({ results });
  } catch (e) {
    console.error(e);
    return json({ error: randomError(), retry: true }, 502);
  }
}

async function handleResearch(request: Request, env: Env): Promise<Response> {
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

  const turnstileOk = await verifyTurnstile(env, body.turnstileToken ?? "", ip);
  if (!turnstileOk) {
    return json({ error: randomError(), retry: true }, 403);
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
          send("done", { badges: cached.badges });
          controller.close();
          return;
        }

        const payloads = await Promise.all(
          symbols.map((s) =>
            getFundamentalsCached(env.CACHE, env.FINNHUB_API_KEY, s, ttl)
          )
        );

        const showAsOf = isStalePayload(payloads);
        send("meta", {
          cached: false,
          asOf: oldestAsOf(payloads),
          showAsOf,
          symbols: payloads.map((p) => ({
            symbol: p.symbol,
            name: p.name,
            price: p.quote.price,
          })),
        });

        let full = "";
        let stickySent = false;

        await streamResearch(env, mode, payloads, {
          onDelta(text) {
            full += text;
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
            if (stickySent) {
              const bodyPart = parseReport(full).body;
              if (bodyPart.length > 40) {
                send("body", { html: renderMarkdown(bodyPart), streaming: true });
              }
            }
          },
          onDone(markdown) {
            const report = emitParsed(send, markdown);
            report.asOf = oldestAsOf(payloads);
            report.stale = showAsOf;
            cacheSet(env.CACHE, cacheKey, report, ttl).catch(console.error);
            incrementRateLimit(env, ip).catch(console.error);
            send("done", { badges: report.badges });
          },
          onError(message) {
            send("error", { error: message || randomError(), retry: true });
          },
        });
      } catch (e) {
        console.error(e);
        send("error", { error: randomError(), retry: true });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === "www.zenbuy.info") {
      return Response.redirect(
        `https://zenbuy.info${url.pathname}${url.search}`,
        301
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/api/search") {
      return handleSearch(request, env);
    }

    if (url.pathname === "/api/research" && request.method === "POST") {
      return handleResearch(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
