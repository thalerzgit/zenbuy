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

export async function streamResearch(
  env: Env,
  mode: "separate" | "comparative",
  payloads: FundamentalsPayload[],
  handlers: StreamHandlers
): Promise<void> {
  const body = {
    model: env.ZENBUY_MODEL || "claude-sonnet-4-20250514",
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

  const res = await fetch(anthropicUrl(env), {
    method: "POST",
    headers: anthropicHeaders(env),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    handlers.onError(`Analysis unavailable (${res.status})`);
    console.error("Anthropic error", res.status, errText);
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
  if (!env.TURNSTILE_SECRET_KEY) return true;
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
