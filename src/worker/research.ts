import { buildUserPrompt, getSystemPrompt } from "./prompt";
import type { FundamentalsPayload } from "./finnhub";

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (full: string) => void;
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

export async function streamResearch(
  env: Env,
  mode: "separate" | "comparative",
  payloads: FundamentalsPayload[],
  handlers: StreamHandlers
): Promise<void> {
  const body = {
    model: env.ZENBUY_MODEL || "claude-sonnet-5",
    max_tokens: 16384,
    stream: true,
    system: getSystemPrompt(),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(mode, payloads),
      },
    ],
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

  if (!res.ok) {
    const errText = await res.text();
    console.error("Anthropic error", res.status, errText);
    handlers.onError(analysisErrorMessage(res.status));
    return;
  }

  if (!res.body) {
    handlers.onError("Empty response stream");
    return;
  }

  let full = "";
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
          delta?: { type?: string; text?: string };
        };
        if (evt.type === "content_block_delta" && evt.delta?.text) {
          full += evt.delta.text;
          handlers.onDelta(evt.delta.text);
        }
      } catch {
        /* ignore partial json */
      }
    }
  }

  handlers.onDone(full);
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

export async function checkRateLimit(env: Env, ip: string): Promise<boolean> {
  const limit = Number(env.RATE_LIMIT_DAILY || 5);
  const key = `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const current = Number((await env.CACHE.get(key)) || 0);
  return current < limit;
}

export async function incrementRateLimit(env: Env, ip: string): Promise<void> {
  const key = `rl:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const current = Number((await env.CACHE.get(key)) || 0);
  await env.CACHE.put(key, String(current + 1), { expirationTtl: 86_400 });
}
