/**
 * Web unlock: one App Store purchase, unlocked on the website.
 *
 * The two halves of the flow meet at the Apple `sub`:
 *
 *   1. In the iOS app, the buyer signs in with Apple and the app posts its
 *      identity token together with the StoreKit 2 signed transactions to
 *      `POST /api/unlock-web`. Both are verified here, and an entitlement is
 *      written under that `sub`.
 *   2. In the browser, the same person signs in with Apple through
 *      `/auth/apple`. The callback stores a session pointing at their `sub`,
 *      and `GET /api/me` reports `unlocked` once an entitlement exists.
 *
 * The app step has to come first — a browser sign-in alone proves identity,
 * not purchase — which is why the website leads with a guide rather than a
 * bare sign-in button.
 */

import { AppleAuthError, exchangeAuthorizationCode, verifyAppleIdToken } from "./apple-id";
import { AppleJwsError, verifyAppleJws } from "./apple-jws";

const SESSION_COOKIE = "zb_session";
const STATE_COOKIE = "zb_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;
const STATE_TTL_SECONDS = 600;
/** Keeps a lapsed subscription readable long enough for a renewal to land. */
const ENTITLEMENT_GRACE_SECONDS = 60 * 60 * 72;
const LIFETIME_TTL_SECONDS = 60 * 60 * 24 * 365 * 5;

const DEFAULT_BUNDLE_ID = "info.zenbuy.app";
const DEFAULT_PRO_PRODUCT_IDS = "info.zenbuy.app.lifetime,info.zenbuy.app.pro.monthly";

/** StoreKit 2 `JWSTransactionDecodedPayload`, trimmed to what unlocking needs. */
interface SignedTransaction {
  bundleId?: string;
  productId?: string;
  originalTransactionId?: string;
  transactionId?: string;
  expiresDate?: number;
  revocationDate?: number;
  inAppOwnershipType?: string;
  environment?: string;
}

export interface Entitlement {
  productId: string;
  originalTransactionId: string;
  /** Epoch ms for subscriptions; null for a lifetime purchase. */
  expiresAt: number | null;
  environment: string;
  updatedAt: number;
}

export interface UnlockState {
  signedIn: boolean;
  unlocked: boolean;
  sub: string | null;
}

function proProductIds(env: Env): string[] {
  return (env.APPLE_PRO_PRODUCT_IDS || DEFAULT_PRO_PRODUCT_IDS)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function bundleId(env: Env): string {
  return env.APPLE_BUNDLE_ID || DEFAULT_BUNDLE_ID;
}

function entitlementKey(sub: string): string {
  return `apple:entitlement:${sub}`;
}

function sessionKey(id: string): string {
  return `apple:session:${id}`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookie(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
  path = "/"
): string {
  // Localhost dev is plain http, where a Secure cookie is silently dropped.
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${path}; HttpOnly; SameSite=Lax${secure}`;
}

function redirect(to: string, headers: string[][] = []): Response {
  return new Response(null, {
    status: 302,
    headers: [["location", to], ["cache-control", "no-store"], ...headers],
  });
}

function json(data: unknown, status = 200, headers: string[][] = []): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: [
      ["content-type", "application/json; charset=utf-8"],
      ["cache-control", "no-store"],
      ...headers,
    ],
  });
}

function isLive(entitlement: Entitlement | null, now = Date.now()): boolean {
  if (!entitlement) return false;
  return entitlement.expiresAt === null || entitlement.expiresAt > now;
}

export async function readEntitlement(env: Env, sub: string): Promise<Entitlement | null> {
  const raw = await env.CACHE.get(entitlementKey(sub), "json").catch(() => null);
  return (raw as Entitlement | null) ?? null;
}

/**
 * Who is this request, and have they unlocked?
 *
 * Browsers present a session cookie; the iOS app presents the same session id
 * as a bearer token, so a purchase earns the higher quota in both places.
 */
export async function resolveUnlock(request: Request, env: Env): Promise<UnlockState> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const sessionId = bearer ?? readCookie(request, SESSION_COOKIE);
  if (!sessionId) return { signedIn: false, unlocked: false, sub: null };

  const sub = await env.CACHE.get(sessionKey(sessionId)).catch(() => null);
  if (!sub) return { signedIn: false, unlocked: false, sub: null };

  return { signedIn: true, unlocked: isLive(await readEntitlement(env, sub)), sub };
}

async function createSession(env: Env, sub: string): Promise<string> {
  const id = randomToken();
  await env.CACHE.put(sessionKey(id), sub, { expirationTtl: SESSION_TTL_SECONDS });
  return id;
}

/** `GET /api/me` — the website's one source of truth for pro mode. */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const { signedIn, unlocked } = await resolveUnlock(request, env);
  return json({ signedIn, unlocked });
}

/** `GET /auth/apple` — hand off to Apple with a single-use state value. */
export async function handleAppleSignIn(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // The callback cannot mint a client secret without the key, so fail here
  // rather than walking someone through Apple's sign-in for nothing.
  if (!env.APPLE_SERVICES_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY) {
    return redirect("/?signin=failed");
  }

  const state = randomToken();
  const authorize = new URL("https://appleid.apple.com/auth/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", env.APPLE_SERVICES_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/auth/apple/callback`);
  authorize.searchParams.set("state", state);

  return redirect(authorize.toString(), [
    ["set-cookie", cookie(request, STATE_COOKIE, state, STATE_TTL_SECONDS, "/auth")],
  ]);
}

/**
 * `GET /auth/apple/callback` — Apple returns here with an authorization code.
 *
 * Every failure lands on `/?signin=failed`; the page turns that into a toast
 * and points back at the guide rather than showing a dead end.
 */
export async function handleAppleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const clearState = cookie(request, STATE_COOKIE, "", 0, "/auth");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirect("/?signin=failed", [["set-cookie", clearState]]);
  }

  try {
    const identity = await exchangeAuthorizationCode(
      env,
      code,
      `${url.origin}/auth/apple/callback`
    );
    const sessionId = await createSession(env, identity.sub);
    const unlocked = isLive(await readEntitlement(env, identity.sub));

    return redirect(unlocked ? "/?unlocked=1" : "/?signin=ok", [
      ["set-cookie", clearState],
      ["set-cookie", cookie(request, SESSION_COOKIE, sessionId, SESSION_TTL_SECONDS)],
    ]);
  } catch (e) {
    console.error("apple callback failed", e);
    return redirect("/?signin=failed", [["set-cookie", clearState]]);
  }
}

/**
 * `GET /auth/unlink` — sign out of this browser.
 *
 * The escape hatch for signing in here with a different Apple ID than the app
 * uses. It drops the session only: the entitlement belongs to the Apple ID
 * that bought the app, and the App Store purchase is untouched.
 */
export async function handleUnlink(request: Request, env: Env): Promise<Response> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (sessionId) await env.CACHE.delete(sessionKey(sessionId)).catch(() => {});
  return redirect("/?unlinked=1", [
    ["set-cookie", cookie(request, SESSION_COOKIE, "", 0)],
  ]);
}

/** Is this a transaction that entitles the buyer to the website? */
function acceptTransaction(
  env: Env,
  transaction: SignedTransaction,
  now: number
): boolean {
  if (transaction.bundleId !== bundleId(env)) return false;
  if (!transaction.productId || !proProductIds(env).includes(transaction.productId)) return false;
  if (transaction.revocationDate) return false;
  if (transaction.expiresDate && transaction.expiresDate <= now) return false;
  // Family Sharing is a legitimate way to hold this purchase.
  if (
    transaction.inAppOwnershipType &&
    transaction.inAppOwnershipType !== "PURCHASED" &&
    transaction.inAppOwnershipType !== "FAMILY_SHARED"
  ) {
    return false;
  }
  // TestFlight buys through the sandbox, so it stays accepted until the
  // App Store release, when APPLE_ALLOW_SANDBOX should be set to "0".
  if (transaction.environment === "Sandbox" && env.APPLE_ALLOW_SANDBOX === "0") return false;
  return true;
}

/** Prefer a lifetime purchase, then the subscription that runs longest. */
function bestEntitlement(candidates: Entitlement[]): Entitlement | null {
  return (
    candidates.sort((a, b) => {
      if (a.expiresAt === b.expiresAt) return 0;
      if (a.expiresAt === null) return -1;
      if (b.expiresAt === null) return 1;
      return b.expiresAt - a.expiresAt;
    })[0] ?? null
  );
}

/**
 * `POST /api/unlock-web` — the iOS app donates proof of purchase.
 *
 * Body: `{ identityToken, transactions: [signedTransactionJWS, ...] }`.
 * Returns a session token the app keeps so its own requests also carry the
 * unlocked quota.
 */
export async function handleUnlockWeb(request: Request, env: Env): Promise<Response> {
  let body: { identityToken?: string; transactions?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  let identity;
  try {
    identity = await verifyAppleIdToken(env, body.identityToken ?? "", bundleId(env));
  } catch (e) {
    if (!(e instanceof AppleAuthError)) console.error("identity verification failed", e);
    return json({ error: "bad token" }, 401);
  }

  const submitted = Array.isArray(body.transactions) ? body.transactions.slice(0, 20) : [];
  if (!submitted.length) return json({ error: "no transactions" }, 400);

  const now = Date.now();
  const candidates: Entitlement[] = [];
  for (const raw of submitted) {
    if (typeof raw !== "string") continue;
    try {
      const transaction = await verifyAppleJws<SignedTransaction>(raw);
      if (!acceptTransaction(env, transaction, now)) continue;
      candidates.push({
        productId: transaction.productId!,
        originalTransactionId:
          transaction.originalTransactionId ?? transaction.transactionId ?? "",
        expiresAt: transaction.expiresDate ?? null,
        environment: transaction.environment ?? "Production",
        updatedAt: now,
      });
    } catch (e) {
      if (!(e instanceof AppleJwsError)) console.error("transaction verification failed", e);
    }
  }

  const entitlement = bestEntitlement(candidates);
  if (!entitlement) return json({ error: "no active purchase" }, 402);

  const ttl =
    entitlement.expiresAt === null
      ? LIFETIME_TTL_SECONDS
      : Math.max(60, Math.ceil((entitlement.expiresAt - now) / 1000) + ENTITLEMENT_GRACE_SECONDS);
  await env.CACHE.put(entitlementKey(identity.sub), JSON.stringify(entitlement), {
    expirationTtl: ttl,
  });

  const sessionId = await createSession(env, identity.sub);
  return json(
    {
      ok: true,
      unlocked: true,
      productId: entitlement.productId,
      expiresAt: entitlement.expiresAt,
      token: sessionId,
    },
    200,
    [["set-cookie", cookie(request, SESSION_COOKIE, sessionId, SESSION_TTL_SECONDS)]]
  );
}
