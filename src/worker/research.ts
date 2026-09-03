import { RATE_LIMIT_TTL_SECONDS } from "./cache";
import type { InvestmentDirectiveId } from "../lib/investment-directives";
import {
  isUsablePartialReport,
  planResearchFinish,
  shouldSilentRetryIncomplete,
} from "./parse";
import {
  buildLaymanPrompt,
  buildUserPrompt,
  getLaymanSystemPrompt,
  getSystemPrompt,
} from "./prompt";
import type { FundamentalsPayload } from "./finnhub";

/** Headroom for a 1500-word single report or 2200-word comparative. */
const RESEARCH_MAX_TOKENS = 12_000;

export const DEFAULT_PRIMARY_MODEL = "claude-opus-5";
const ANTHROPIC_SECONDARY_MODEL = "claude-sonnet-5";
export const DEFAULT_BACKUP_MODEL = "grok-4.5";
export const DEFAULT_BACKUP_PROVIDER = "xai";

/** Headers must arrive before we treat the primary as unresponsive. */
const TTFB_TIMEOUT_MS = 45_000;

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (full: string) => void | Promise<void>;
  onError: (message: string) => void;
  /** Clear the client accumulator before a silent incomplete retry. */
  onRestart?: () => void;
}

export function primaryModel(env: Env): string {
  return env.ZENBUY_MODEL || DEFAULT_PRIMARY_MODEL;
}

export function backupModel(env: Env): string {
  return env.ZENBUY_BACKUP_MODEL || DEFAULT_BACKUP_MODEL;
}

export function backupProvider(env: Env): string {
  return (env.ZENBUY_BACKUP_PROVIDER || DEFAULT_BACKUP_PROVIDER)
    .trim()
    .toLowerCase();
}

export function hasXaiKey(env: Env): boolean {
  return Boolean(env.XAI_API_KEY?.trim());
}

/** Outage / timeout / rate-limit / model-gone — never ordinary 400 prompt bugs. */
export function shouldFailoverStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 404 || status >= 500;
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

function xaiUrl(env: Env): string {
  if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_ID) {
    return `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/grok/v1/chat/completions`;
  }
  return "https://api.x.ai/v1/chat/completions";
}

function xaiHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${env.XAI_API_KEY}`,
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
  if (status === 408) {
    return "Analysis service didn't respond. Try again in a moment?";
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
      ids.find((id) => id.startsWith("claude-opus") && id !== rejected) ??
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

async function fetchHeaders(
  url: string,
  init: RequestInit,
  ttfbMs = TTFB_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ttfbMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error("timeout");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

type StreamKind = "anthropic" | "openai";

type AttemptOk = { ok: true; text: string; stopReason: string | null };
type AttemptFail = { ok: false; failover: boolean; message: string; status?: number };
type Attempt = AttemptOk | AttemptFail;

function parseAnthropicEvent(evt: Record<string, unknown>): {
  text?: string;
  stopReason?: string | null;
} {
  const type = evt.type as string | undefined;
  const delta = evt.delta as
    | { type?: string; text?: string; stop_reason?: string | null }
    | undefined;
  const message = evt.message as { stop_reason?: string | null } | undefined;
  const out: { text?: string; stopReason?: string | null } = {};
  if (type === "content_block_delta" && delta?.text) out.text = delta.text;
  const reason = delta?.stop_reason ?? message?.stop_reason ?? null;
  if (reason) out.stopReason = reason;
  return out;
}

function parseOpenaiEvent(evt: Record<string, unknown>): {
  text?: string;
  stopReason?: string | null;
} {
  const choices = evt.choices as
    | Array<{
        delta?: { content?: string | null };
        finish_reason?: string | null;
      }>
    | undefined;
  const choice = choices?.[0];
  const out: { text?: string; stopReason?: string | null } = {};
  if (choice?.delta?.content) out.text = choice.delta.content;
  if (choice?.finish_reason === "length") out.stopReason = "max_tokens";
  else if (choice?.finish_reason) out.stopReason = choice.finish_reason;
  return out;
}

async function readSseStream(
  res: Response,
  onText: (text: string) => void,
  kind: StreamKind
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
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as Record<string, unknown>;
        const parsed =
          kind === "anthropic" ? parseAnthropicEvent(evt) : parseOpenaiEvent(evt);
        if (parsed.text) {
          full += parsed.text;
          onText(parsed.text);
        }
        if (parsed.stopReason) stopReason = parsed.stopReason;
      } catch {
        /* ignore partial json */
      }
    }
  }

  return { text: full, stopReason };
}

function networkFail(label: string, e: unknown): AttemptFail {
  const timeout = e instanceof Error && e.message === "timeout";
  console.error(label, timeout ? "timeout" : e);
  return {
    ok: false,
    failover: true,
    message: "Analysis service didn't respond. Try again in a moment?",
  };
}

async function consumeAnthropic(
  env: Env,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  onText: (text: string) => void
): Promise<Attempt> {
  const body = {
    model,
    max_tokens: maxTokens,
    stream: true,
    system,
    messages: [{ role: "user" as const, content: user }],
  };

  const post = (): Promise<Response> =>
    fetchHeaders(anthropicUrl(env), {
      method: "POST",
      headers: anthropicHeaders(env),
      body: JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await post();
  } catch (e) {
    return networkFail("Anthropic request failed", e);
  }

  if (res.status === 404) {
    console.error("Anthropic model rejected", body.model, await res.text());
    const live = await resolveLiveModel(env, body.model);
    if (live && live !== body.model) {
      console.warn("retrying with model", live);
      body.model = live;
      try {
        res = await post();
      } catch (e) {
        return networkFail("Anthropic retry failed", e);
      }
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error("Anthropic error", res.status, errText);
    return {
      ok: false,
      failover: shouldFailoverStatus(res.status),
      status: res.status,
      message: analysisErrorMessage(res.status),
    };
  }

  let emitted = 0;
  const track = (text: string): void => {
    emitted += text.length;
    onText(text);
  };

  try {
    const result = await readSseStream(res, track, "anthropic");
    if (!result.text.trim()) {
      console.error("Anthropic stream empty");
      return {
        ok: false,
        failover: true,
        message: "The analysis stream dropped. Try again?",
      };
    }
    return { ok: true, ...result };
  } catch (e) {
    console.error("stream read failed", e);
    return {
      ok: false,
      failover: emitted === 0,
      message: "The analysis stream dropped. Try again?",
    };
  }
}

async function consumeXai(
  env: Env,
  system: string,
  user: string,
  maxTokens: number,
  onText: (text: string) => void
): Promise<Attempt> {
  const body = {
    model: backupModel(env),
    max_completion_tokens: maxTokens,
    stream: true,
    // Reports must stay on injected Finnhub numbers, not live search.
    search_parameters: { mode: "off" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  let res: Response;
  try {
    res = await fetchHeaders(xaiUrl(env), {
      method: "POST",
      headers: xaiHeaders(env),
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ...networkFail("xAI request failed", e), failover: false };
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error("xAI error", res.status, errText);
    return {
      ok: false,
      failover: false,
      status: res.status,
      message: analysisErrorMessage(res.status),
    };
  }

  try {
    const result = await readSseStream(res, onText, "openai");
    if (!result.text.trim()) {
      console.error("xAI stream empty");
      return {
        ok: false,
        failover: false,
        message: "The analysis stream dropped. Try again?",
      };
    }
    return { ok: true, ...result };
  } catch (e) {
    console.error("xAI stream read failed", e);
    return {
      ok: false,
      failover: false,
      message: "The analysis stream dropped. Try again?",
    };
  }
}

/**
 * Primary Anthropic → same-provider live-id retry → optional Sonnet once → xAI.
 * Failover only when no tokens were already painted to the client.
 */
async function analyzeStream(
  env: Env,
  system: string,
  user: string,
  maxTokens: number,
  onText: (text: string) => void
): Promise<Attempt> {
  const primary = primaryModel(env);
  let last = await consumeAnthropic(env, primary, system, user, maxTokens, onText);
  if (last.ok || !last.failover) return last;

  if (primary !== ANTHROPIC_SECONDARY_MODEL) {
    console.warn("anthropic secondary", ANTHROPIC_SECONDARY_MODEL);
    last = await consumeAnthropic(
      env,
      ANTHROPIC_SECONDARY_MODEL,
      system,
      user,
      maxTokens,
      onText
    );
    if (last.ok || !last.failover) return last;
  }

  if (backupProvider(env) === "xai" && hasXaiKey(env)) {
    console.warn("failing over to xAI", backupModel(env));
    return consumeXai(env, system, user, maxTokens, onText);
  }

  if (backupProvider(env) === "xai") {
    console.warn("xAI backup skipped: XAI_API_KEY missing");
  }
  return last;
}

function isLaymanComplete(text: string): boolean {
  return (
    /^##\s*Bottom line\b/im.test(text) &&
    /^##\s*What I'd watch next\b/im.test(text) &&
    text.trim().length >= 400
  );
}

/** max_tokens is only fatal when the markdown is actually unusable. */
function acceptMaxTokensStop(
  text: string,
  kind: "research" | "layman"
): boolean {
  return kind === "layman"
    ? isLaymanComplete(text)
    : planResearchFinish(text).action !== "fail";
}

async function finishAnalysis(
  result: Attempt,
  kind: "research" | "layman",
  handlers: StreamHandlers
): Promise<void> {
  if (!result.ok) {
    handlers.onError(result.message);
    return;
  }
  if (result.stopReason === "max_tokens" && !acceptMaxTokensStop(result.text, kind)) {
    console.error(`${kind} truncated by max_tokens`, {
      chars: result.text.length,
      stopReason: result.stopReason,
    });
    handlers.onError(
      kind === "layman"
        ? "The rewrite hit the length limit before finishing. Try again?"
        : "The analysis hit the length limit before finishing. Try again?"
    );
    return;
  }
  if (result.stopReason === "max_tokens") {
    console.warn(`${kind} max_tokens but report complete`, {
      chars: result.text.length,
    });
  }
  await handlers.onDone(result.text);
}

export async function streamResearch(
  env: Env,
  mode: "separate" | "comparative",
  payloads: FundamentalsPayload[],
  directive: InvestmentDirectiveId,
  handlers: StreamHandlers,
  profitHorizonYears?: number
): Promise<void> {
  try {
    const system = getSystemPrompt(directive);
    const user = buildUserPrompt(mode, payloads, directive, profitHorizonYears);
    let result = await analyzeStream(
      env,
      system,
      user,
      RESEARCH_MAX_TOKENS,
      handlers.onDelta
    );
    // One silent retry only when the first pass painted little/no usable sticky.
    // A usable BOTTOM LINE must not double-bill — finish() caches that partial.
    if (result.ok && shouldSilentRetryIncomplete(result.text)) {
      console.warn("silent retry incomplete research", {
        chars: result.text.length,
      });
      handlers.onRestart?.();
      result = await analyzeStream(
        env,
        system,
        user,
        RESEARCH_MAX_TOKENS,
        handlers.onDelta
      );
    }
    await finishAnalysis(result, "research", handlers);
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
  try {
    const result = await analyzeStream(
      env,
      getLaymanSystemPrompt(),
      buildLaymanPrompt(markdown),
      4_096,
      handlers.onDelta
    );
    await finishAnalysis(result, "layman", handlers);
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
        const runTicker = (): Promise<Attempt> =>
          analyzeStream(
            env,
            getSystemPrompt(directive),
            buildUserPrompt("separate", [payload], directive, profitHorizonYears),
            RESEARCH_MAX_TOKENS,
            (text) => {
              sections[i] += text;
              emit();
            }
          );

        let result = await runTicker();
        if (result.ok && shouldSilentRetryIncomplete(sections[i])) {
          console.warn("silent retry incomplete parallel", payload.symbol);
          sections[i] = "";
          result = await runTicker();
        }

        if (!result.ok) {
          console.error("analysis failed", payload.symbol, result.message);
          failures.push(payload.symbol);
          sections[i] = `## BOTTOM LINE\n\n_${result.message}_`;
          emit(true);
          return;
        }

        if (
          result.stopReason === "max_tokens" &&
          !acceptMaxTokensStop(sections[i], "research")
        ) {
          console.error("parallel analysis truncated", payload.symbol);
          failures.push(payload.symbol);
          sections[i] =
            "## BOTTOM LINE\n\n_Analysis cut off before finishing for this ticker._";
          emit(true);
        } else if (result.stopReason === "max_tokens") {
          console.warn(
            isUsablePartialReport(sections[i])
              ? "parallel analysis max_tokens but report usable"
              : "parallel analysis max_tokens but report complete",
            payload.symbol
          );
        }
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
  await env.CACHE.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_TTL_SECONDS });
}
