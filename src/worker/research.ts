import type { InvestmentDirectiveId } from "../lib/investment-directives";
import { assessReportCompleteness } from "./parse";
import {
  buildLaymanPrompt,
  buildUserPrompt,
  getLaymanSystemPrompt,
  getSystemPrompt,
} from "./prompt";
import type { FundamentalsPayload } from "./finnhub";

/** Headroom for a 1500-word single report or 2200-word comparative. */
const RESEARCH_MAX_TOKENS = 12_000;

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (full: string) => void | Promise<void>;
  onError: (message: string) => void;
}

function anthropicUrl(env: Env): string {
  if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_ID) {
    return `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic/v1/messages`;
  }
  return "https://api.anthropic.com/v1/messages";
}

function anthropicHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };
  if (env.AI_GATEWAY_TOKEN) {
    headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
  }
  if (env.CACHE_TTL_SECONDS) {
    headers["cf-aig-cache-ttl"] = env.CACHE_TTL_SECONDS;
  }
  return headers;
}

function analysisErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Analysis service rejected our credentials. This needs a config fix.";
  }
  if (status === 404) {
    return "The analysis model is unavailable. This needs a config fix.";
  }
  if (status === 429) {
    return "Analysis service is rate limited right now. Give it a moment and retry?";
  }
  if (status === 529 || status >= 500) {
    return "Analysis service is overloaded. Try again in a moment?";
  }
  return `Analysis unavailable (${status}). Try again?`;
}

const FALLBACK_MODEL_KEY = "model:fallback";

/**
 * Model ids get retired, which otherwise takes every report down until
 * someone edits a var. Resolve a live id once and remember it for a day.
 */
async function resolveLiveModel(env: Env, rejected: string): Promise<string | null> {
  const cached = await env.CACHE.get(FALLBACK_MODEL_KEY);
  if (cached && cached !== rejected) return cached;

  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=30", {
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (body.data ?? []).map((m) => m.id).filter(Boolean) as string[];
    const pick =
      ids.find((id) => id.startsWith("claude-sonnet") && id !== rejected) ??
      ids.find((id) => id !== rejected) ??
      null;
    if (pick) {
      await env.CACHE.put(FALLBACK_MODEL_KEY, pick, { expirationTtl: 86_400 });
    }
    return pick;
  } catch (e) {
    console.error("model resolve failed", e);
    return null;
  }
}

/** One analysis request, with a single self-healing retry on a dead model id. */
async function requestAnalysis(
  env: Env,
  system: string,
  user: string,
  maxTokens: number
): Promise<Response> {
  const body = {
    model: env.ZENBUY_MODEL || "claude-sonnet-5",
    max_tokens: maxTokens,
    stream: true,
    system,
    messages: [{ role: "user", content: user }],
  };

  const post = (): Promise<Response> =>
    fetch(anthropicUrl(env), {
      method: "POST",
      headers: anthropicHeaders(env),
      body: JSON.stringify(body),
    });

  let res = await post();

  if (res.status === 404) {
    console.error("Anthropic model rejected", body.model, await res.text());
    const live = await resolveLiveModel(env, body.model);
    if (live) {
      console.warn("retrying with model", live);
      body.model = live;
      res = await post();
    }
  }

  return res;
}

async function readAnalysisStream(
  res: Response,
  onText: (text: string) => void
): Promise<{ text: string; stopReason: string | null }> {
  if (!res.body) throw new Error("Empty response stream");

  let full = "";
  let stopReason: string | null = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: {
            type?: string;
            text?: string;
            stop_reason?: string | null;
          };
          message?: { stop_reason?: string | null };
        };
        if (evt.type === "content_block_delta" && evt.delta?.text) {
          full += evt.delta.text;
          onText(evt.delta.text);
        }
        // Anthropic streams stop_reason on message_delta / message_stop.
        const reason =
          evt.delta?.stop_reason ?? evt.message?.stop_reason ?? null;
        if (reason) stopReason = reason;
      } catch {
        /* ignore partial json */
      }
    }
  }

  return { text: full, stopReason };
}

function isLaymanComplete(text: string): boolean {
  return (
    /^##\s*Bottom line\b/im.test(text) &&
    /^##\s*What I'd watch next\b/im.test(text) &&
    text.trim().length >= 400
  );
}

/** max_tokens is only fatal when the markdown is actually unfinished. */
function acceptMaxTokensStop(
  text: string,
  kind: "research" | "layman"
): boolean {
  return kind === "layman"
    ? isLaymanComplete(text)
    : assessReportCompleteness(text).ok;
}

export async function streamResearch(
  env: Env,
  mode: "separate" | "comparative",
  payloads: FundamentalsPayload[],
  directive: InvestmentDirectiveId,
  handlers: StreamHandlers,
  profitHorizonYears?: number
): Promise<void> {
  const res = await requestAnalysis(
    env,
    getSystemPrompt(directive),
    buildUserPrompt(mode, payloads, directive, profitHorizonYears),
    RESEARCH_MAX_TOKENS
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error("Anthropic error", res.status, errText);
    handlers.onError(analysisErrorMessage(res.status));
    return;
  }

  try {
    const { text: full, stopReason } = await readAnalysisStream(
      res,
      handlers.onDelta
    );
    if (stopReason === "max_tokens" && !acceptMaxTokensStop(full, "research")) {
      console.error("analysis truncated by max_tokens", {
        chars: full.length,
        stopReason,
      });
      handlers.onError(
        "The analysis hit the length limit before finishing. Try again?"
      );
      return;
    }
    if (stopReason === "max_tokens") {
      console.warn("analysis max_tokens but report complete", {
        chars: full.length,
      });
    }
    await handlers.onDone(full);
  } catch (e) {
    console.error("stream read failed", e);
    handlers.onError("The analysis stream dropped. Try again?");
  }
}

const PROGRESS_INTERVAL_MS = 200;

/**
 * Tag every section header with its ticker.
 *
 * splitReport() drops anything ahead of the first "## BOTTOM LINE", so a
 * separate "## TICKER: X" heading survives for later tickers but vanishes for
 * the first one. Labelling the headers themselves keeps all N reports
 * attributable, and the parsers match on header prefixes so they still work.
 */
function labelHeaders(markdown: string, symbol: string): string {
  return markdown.replace(
    /^##[ \t]+(.+)$/gm,
    (_m, heading: string) => `## ${heading.trim()} — ${symbol}`
  );
}

/** Rewrite a finished report in plain English, same verdict and risk level. */
export async function streamLayman(
  env: Env,
  markdown: string,
  handlers: StreamHandlers
): Promise<void> {
  const res = await requestAnalysis(
    env,
    getLaymanSystemPrompt(),
    buildLaymanPrompt(markdown),
    4_096
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error("Anthropic error (layman)", res.status, errText);
    handlers.onError(analysisErrorMessage(res.status));
    return;
  }

  try {
    const { text: full, stopReason } = await readAnalysisStream(
      res,
      handlers.onDelta
    );
    if (stopReason === "max_tokens" && !acceptMaxTokensStop(full, "layman")) {
      console.error("layman truncated by max_tokens", { chars: full.length });
      handlers.onError(
        "The rewrite hit the length limit before finishing. Try again?"
      );
      return;
    }
    if (stopReason === "max_tokens") {
      console.warn("layman max_tokens but rewrite complete", {
        chars: full.length,
      });
    }
    await handlers.onDone(full);
  } catch (e) {
    console.error("layman stream read failed", e);
    handlers.onError("The rewrite stream dropped. Try again?");
  }
}

export interface ParallelHandlers {
  onProgress: (assembled: string) => void;
  onDone: (assembled: string) => void | Promise<void>;
  onError: (message: string) => void;
}

/**
 * Separate reports for N tickers used to be one completion emitting N x ~2500
 * words serially, so wall time scaled with the total. Running one request per
 * ticker concurrently makes it scale with the slowest single report instead.
 */
export async function streamResearchParallel(
  env: Env,
  payloads: FundamentalsPayload[],
  directive: InvestmentDirectiveId,
  handlers: ParallelHandlers,
  profitHorizonYears?: number
): Promise<void> {
  const sections = payloads.map(() => "");
  const failures: string[] = [];

  const assemble = (): string =>
    payloads
      .map((p, i) => (sections[i] ? labelHeaders(sections[i], p.symbol) : ""))
      .filter(Boolean)
      .join("\n\n");

  // Assembling re-copies every section, so emit on a cadence rather than per
  // token; the client repaint is throttled again downstream.
  let lastEmit = 0;
  const emit = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    handlers.onProgress(assemble());
  };

  await Promise.all(
    payloads.map(async (payload, i) => {
      try {
        const res = await requestAnalysis(
          env,
          getSystemPrompt(directive),
          buildUserPrompt("separate", [payload], directive, profitHorizonYears),
          RESEARCH_MAX_TOKENS
        );

        if (!res.ok) {
          const errText = await res.text();
          console.error("Anthropic error", payload.symbol, res.status, errText);
          failures.push(payload.symbol);
          sections[i] = `## BOTTOM LINE\n\n_${analysisErrorMessage(res.status)}_`;
          emit(true);
          return;
        }

        await readAnalysisStream(res, (text) => {
          sections[i] += text;
          emit();
        }).then(({ stopReason }) => {
          if (
            stopReason === "max_tokens" &&
            !acceptMaxTokensStop(sections[i], "research")
          ) {
            console.error("parallel analysis truncated", payload.symbol);
            failures.push(payload.symbol);
            sections[i] =
              "## BOTTOM LINE\n\n_Analysis cut off before finishing for this ticker._";
            emit(true);
          } else if (stopReason === "max_tokens") {
            console.warn(
              "parallel analysis max_tokens but report complete",
              payload.symbol
            );
          }
        });
      } catch (e) {
        console.error("parallel analysis failed", payload.symbol, e);
        failures.push(payload.symbol);
        sections[i] = "## BOTTOM LINE\n\n_Analysis unavailable for this ticker._";
        emit(true);
      }
    })
  );

  if (failures.length === payloads.length) {
    handlers.onError("Analysis service didn't respond. Try again in a moment?");
    return;
  }

  await handlers.onDone(assemble());
}

export async function verifyTurnstile(
  env: Env,
  token: string,
  ip: string
): Promise<boolean> {
  // Match production: only enforce when both keys are configured.
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) return true;
  if (!token) return false;

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip && ip !== "unknown") form.append("remoteip", ip);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form,
      }
    );
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (!data.success) {
      console.warn("turnstile siteverify failed", data["error-codes"] ?? []);
    }
    return !!data.success;
  } catch (e) {
    console.error("turnstile siteverify error", e);
    return false;
  }
}

export function isRateLimitExempt(env: Env, ip: string): boolean {
  const raw = env.RATE_LIMIT_WHITELIST?.trim();
  if (!raw) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(ip);
}

export async function checkRateLimit(env: Env, ip: string): Promise<boolean> {
  if (isRateLimitExempt(env, ip)) return true;
  const limit = Number(env.RATE_LIMIT_DAILY || 5);
  const key = `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const current = Number((await env.CACHE.get(key)) || 0);
  return current < limit;
}

export async function incrementRateLimit(env: Env, ip: string): Promise<void> {
  if (isRateLimitExempt(env, ip)) return;
  const key = `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const current = Number((await env.CACHE.get(key)) || 0);
  await env.CACHE.put(key, String(current + 1), { expirationTtl: 86_400 });
}
