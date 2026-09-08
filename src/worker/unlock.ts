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
 *
 * `APPLE_ID_WHITELIST` is the one way past the App Store: an Apple ID listed
 * there is granted the same entitlement complimentarily, no purchase involved.
 */

// Extension-qualified so `node --experimental-strip-types` can load this
// chain directly from the unit tests; the bundler is happy either way.
import type { AppleIdentity } from "./apple-id.ts";
import { AppleAuthError, exchangeAuthorizationCode, verifyAppleIdToken } from "./apple-id.ts";
import { AppleJwsError, verifyAppleJws } from "./apple-jws.ts";
import {
  USER_FACING_APP_BAD_TOKEN,
  USER_FACING_APP_NO_PURCHASE,
  USER_FACING_WEB_SIGNIN_FAILED,
  USER_FACING_WEB_UNLINKED,
  emailDomainOnly,
  logUnlockTrace,
  subPrefixOnly,
  unlockCaller,
  unlockTraceActive,
} from "./unlock-trace.ts";

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
  /** Unlocked by `APPLE_ID_WHITELIST` rather than by an App Store purchase. */
  complimentary: boolean;
}

/** Product id recorded for a complimentary grant, in place of a real one. */
export const COMPLIMENTARY_PRODUCT_ID = "whitelist";

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
 * Is this Apple ID on the complimentary whitelist?
 *
 * `APPLE_ID_WHITELIST` is comma-separated, and each entry is either an email
 * address — matched case-insensitively against the claim Apple sends, real or
 * private-relay — or `sub:<subject id>`, which keeps working when Apple sends
 * no address at all.
 */
export function isWhitelisted(env: Env, identity: AppleIdentity): boolean {
  const email = identity.email?.trim().toLowerCase();
  return (env.APPLE_ID_WHITELIST ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) =>
      /^sub:/i.test(entry)
        ? entry.slice(4).trim() === identity.sub
        : Boolean(email) && entry.toLowerCase() === email
    );
}

/**
 * A normal email string — not a display name, not empty, not a `sub:`.
 * Used only to decide whether a client-supplied address may be shown to
 * `isWhitelisted` when the identity token omitted the claim.
 */
export function isNormalEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim();
  // One @, no spaces, a dot in the domain. Rejects "Justin Morgenthaler".
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Email used solely for complimentary whitelist matching.
 *
 * The verified token email always wins. A client `email` is consulted only
 * when Apple omitted the claim (repeat SIWA) and the value looks like an
 * address — never a name, and never as an identity of its own.
 */
export function emailForWhitelist(
  tokenEmail: string | undefined,
  clientEmail: unknown
): string | undefined {
  const fromToken = tokenEmail?.trim();
  if (fromToken) return fromToken;
  if (!isNormalEmail(clientEmail)) return undefined;
  return clientEmail.trim();
}

function complimentaryEntitlement(now: number): Entitlement {
  return {
    productId: COMPLIMENTARY_PRODUCT_ID,
    originalTransactionId: "",
    expiresAt: null,
    environment: "Complimentary",
    updatedAt: now,
  };
}

/** Decision fields for the temporary RCA window. Never includes email/sub/JWT. */
function whitelistTraceFields(
  env: Env,
  identity: AppleIdentity,
  clientEmail: unknown,
  matching: "token_only" | "token_then_body"
): Record<string, unknown> {
  const entries = (env.APPLE_ID_WHITELIST ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const emailEntries = entries.filter((entry) => !/^sub:/i.test(entry));
  const subEntries = entries.filter((entry) => /^sub:/i.test(entry));
  const email =
    matching === "token_then_body"
      ? emailForWhitelist(identity.email, clientEmail)
      : identity.email?.trim() || undefined;
  const matched = isWhitelisted(env, { sub: identity.sub, email });
  const bodyPresent = clientEmail != null && String(clientEmail).trim() !== "";
  let why: string;
  if (matched) {
    why = subEntries.some((entry) => entry.slice(4).trim() === identity.sub)
      ? "matched_sub"
      : "matched_email";
  } else if (entries.length === 0) {
    why = "whitelist_empty";
  } else if (!email) {
    why =
      bodyPresent && !isNormalEmail(clientEmail)
        ? "miss_no_usable_email_body_not_address"
        : "miss_no_email_and_no_sub_match";
  } else {
    why = "miss_email_not_listed";
  }
  return {
    whitelist_match: matched,
    whitelist_why: why,
    whitelist_matching: matching,
    whitelist_entry_count: entries.length,
    whitelist_email_entry_count: emailEntries.length,
    whitelist_sub_entry_count: subEntries.length,
    whitelist_email_domains: emailEntries.map((entry) => emailDomainOnly(entry)),
    token_email_claim: Boolean(identity.email?.trim()),
    token_email_domain: emailDomainOnly(identity.email),
    body_email_present: bodyPresent,
    body_email_looks_like_address: isNormalEmail(clientEmail),
    whitelist_email_source: email ? (identity.email?.trim() ? "token" : "body") : "none",
    identity_email_domain: emailDomainOnly(email),
    sub_present: Boolean(identity.sub),
    sub_prefix: subPrefixOnly(identity.sub),
  };
}

function entitlementTraceFields(entitlement: Entitlement | null, now = Date.now()) {
  return {
    purchase_lookup: "kv_apple_entitlement_by_sub",
    purchase_found: Boolean(entitlement),
    purchase_live: isLive(entitlement, now),
    purchase_product_id: entitlement?.productId ?? null,
    purchase_environment: entitlement?.environment ?? null,
    purchase_expired: Boolean(entitlement?.expiresAt && entitlement.expiresAt <= now),
    purchase_complimentary_record: entitlement?.productId === COMPLIMENTARY_PRODUCT_ID,
  };
}

function transactionSkipReason(
  env: Env,
  transaction: SignedTransaction,
  now: number
): string {
  if (transaction.bundleId !== bundleId(env)) return "bundle_mismatch";
  if (!transaction.productId || !proProductIds(env).includes(transaction.productId)) {
    return "product_not_pro";
  }
  if (transaction.revocationDate) return "revoked";
  if (transaction.expiresDate && transaction.expiresDate <= now) return "expired";
  if (
    transaction.inAppOwnershipType &&
    transaction.inAppOwnershipType !== "PURCHASED" &&
    transaction.inAppOwnershipType !== "FAMILY_SHARED"
  ) {
    return "ownership_not_accepted";
  }
  if (transaction.environment === "Sandbox" && env.APPLE_ALLOW_SANDBOX === "0") {
    return "sandbox_blocked";
  }
  return "rejected";
}

/**
 * Give a whitelisted Apple ID the entitlement a purchase would have earned.
 *
 * Stored under the `sub`, so someone first matched by email stays unlocked on
 * every later sign-in — including after they switch on Hide My Email, when
 * there is no address left to match. A real purchase is never overwritten.
 *
 * @returns whether this Apple ID is whitelisted at all.
 */
export async function applyWhitelistGrant(
  env: Env,
  identity: AppleIdentity
): Promise<boolean> {
  if (!isWhitelisted(env, identity)) return false;
  if (isLive(await readEntitlement(env, identity.sub))) return true;

  await env.CACHE.put(
    entitlementKey(identity.sub),
    JSON.stringify(complimentaryEntitlement(Date.now())),
    { expirationTtl: LIFETIME_TTL_SECONDS }
  ).catch(() => {});
  return true;
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
  const empty = { signedIn: false, unlocked: false, sub: null, complimentary: false };
  if (!sessionId) return empty;

  const sub = await env.CACHE.get(sessionKey(sessionId)).catch(() => null);
  if (!sub) return empty;

  const entitlement = await readEntitlement(env, sub);
  const purchased = isLive(entitlement) && entitlement!.productId !== COMPLIMENTARY_PRODUCT_ID;
  // A `sub:` entry added after this session was created applies immediately;
  // an email entry cannot, because the address is never stored.
  const complimentary = (isLive(entitlement) && !purchased) || isWhitelisted(env, { sub });

  return { signedIn: true, unlocked: purchased || complimentary, sub, complimentary };
}

async function createSession(env: Env, sub: string): Promise<string> {
  const id = randomToken();
  await env.CACHE.put(sessionKey(id), sub, { expirationTtl: SESSION_TTL_SECONDS });
  return id;
}

/** `GET /api/me` — the website's one source of truth for pro mode. */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const state = await resolveUnlock(request, env);
  if (unlockTraceActive() && state.signedIn) {
    const entitlement = state.sub ? await readEntitlement(env, state.sub) : null;
    const unlinked = !state.unlocked;
    logUnlockTrace("unlock_trace.me", {
      route: "/api/me",
      http_status: 200,
      caller: unlockCaller(request),
      branch: unlinked ? "signed_in_unlinked" : "unlocked",
      signed_in: true,
      unlocked: state.unlocked,
      complimentary: state.complimentary,
      has_bearer: Boolean(request.headers.get("authorization")),
      has_session_cookie: Boolean(readCookie(request, SESSION_COOKIE)),
      sub_present: Boolean(state.sub),
      sub_prefix: subPrefixOnly(state.sub),
      whitelist_match: state.sub ? isWhitelisted(env, { sub: state.sub }) : false,
      whitelist_why: state.sub
        ? isWhitelisted(env, { sub: state.sub })
          ? "matched_sub"
          : "session_has_no_email_to_match"
        : "no_sub",
      ...entitlementTraceFields(entitlement),
      user_facing_error: unlinked ? USER_FACING_WEB_UNLINKED : null,
    });
  }
  return json({ signedIn: state.signedIn, unlocked: state.unlocked });
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
    logUnlockTrace("unlock_trace.siwa_callback", {
      route: "/auth/apple/callback",
      http_status: 302,
      caller: "web",
      branch: "state_mismatch",
      has_code: Boolean(code),
      has_state: Boolean(state),
      has_expected_state: Boolean(expectedState),
      redirect: "/?signin=failed",
      user_facing_error: USER_FACING_WEB_SIGNIN_FAILED,
    });
    return redirect("/?signin=failed", [["set-cookie", clearState]]);
  }

  try {
    const identity = await exchangeAuthorizationCode(
      env,
      code,
      `${url.origin}/auth/apple/callback`
    );
    const whitelist = whitelistTraceFields(env, identity, undefined, "token_only");
    logUnlockTrace("unlock_trace.whitelist", {
      route: "/auth/apple/callback",
      caller: "web",
      ...whitelist,
    });
    const complimentary = await applyWhitelistGrant(env, identity);
    const sessionId = await createSession(env, identity.sub);
    const entitlement = await readEntitlement(env, identity.sub);
    const unlocked = complimentary || isLive(entitlement);
    const redirectTo = unlocked ? "/?unlocked=1" : "/?signin=ok";
    logUnlockTrace("unlock_trace.siwa_callback", {
      route: "/auth/apple/callback",
      http_status: 302,
      caller: "web",
      branch: unlocked
        ? complimentary
          ? "session_created_complimentary"
          : "session_created_purchase_linked"
        : "session_created_signed_in_unlinked",
      session_created: true,
      complimentary_grant: complimentary,
      unlocked,
      redirect: redirectTo,
      ...whitelist,
      ...entitlementTraceFields(entitlement),
      user_facing_error: unlocked ? null : USER_FACING_WEB_UNLINKED,
    });

    return redirect(redirectTo, [
      ["set-cookie", clearState],
      ["set-cookie", cookie(request, SESSION_COOKIE, sessionId, SESSION_TTL_SECONDS)],
    ]);
  } catch (e) {
    console.error("apple callback failed", e);
    logUnlockTrace("unlock_trace.siwa_callback", {
      route: "/auth/apple/callback",
      http_status: 302,
      caller: "web",
      branch: "apple_exchange_failed",
      apple_auth_error: e instanceof AppleAuthError ? e.message : "unexpected",
      redirect: "/?signin=failed",
      user_facing_error: USER_FACING_WEB_SIGNIN_FAILED,
    });
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
 * Body: `{ identityToken, transactions: [signedTransactionJWS, ...], email? }`.
 * `email` is the SIWA button address (first authorization only). It is used
 * only for complimentary whitelist matching when the identity token omitted
 * the claim. Returns a session token the app keeps so its own requests also
 * carry the unlocked quota.
 */
export async function handleUnlockWeb(request: Request, env: Env): Promise<Response> {
  let body: { identityToken?: string; transactions?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    logUnlockTrace("unlock_trace.unlock_web", {
      route: "/api/unlock-web",
      http_status: 400,
      caller: unlockCaller(request),
      branch: "bad_request",
      response_error: "bad request",
      user_facing_error: "Linking failed (HTTP 400). Try again in a moment.",
    });
    return json({ error: "bad request" }, 400);
  }

  let identity;
  try {
    identity = await verifyAppleIdToken(env, body.identityToken ?? "", bundleId(env));
  } catch (e) {
    if (!(e instanceof AppleAuthError)) console.error("identity verification failed", e);
    logUnlockTrace("unlock_trace.unlock_web", {
      route: "/api/unlock-web",
      http_status: 401,
      caller: unlockCaller(request),
      branch: "bad_token",
      has_identity_token: Boolean(body.identityToken),
      body_email_present: body.email != null && String(body.email).trim() !== "",
      transaction_submitted_count: Array.isArray(body.transactions)
        ? body.transactions.length
        : 0,
      apple_auth_error: e instanceof AppleAuthError ? e.message : "unexpected",
      response_error: "bad token",
      user_facing_error: USER_FACING_APP_BAD_TOKEN,
    });
    return json({ error: "bad token" }, 401);
  }

  return completeUnlockWeb(request, env, identity, body.transactions, body.email);
}

/**
 * After the identity token has been verified: match a purchase or a
 * complimentary whitelist grant. Entitlements are always stored under the
 * verified `sub`, so a later sign-in with no email still unlocks.
 *
 * Exported for tests — token signatures belong to `apple-id.ts`.
 */
export async function completeUnlockWeb(
  request: Request,
  env: Env,
  identity: AppleIdentity,
  transactions: unknown,
  clientEmail?: unknown
): Promise<Response> {
  // Token email wins. Client email is whitelist-only, and only when Apple
  // omitted the claim. A name or a non-whitelist address never unlocks.
  const email = emailForWhitelist(identity.email, clientEmail);
  const whitelisted = isWhitelisted(env, { sub: identity.sub, email });
  const whitelist = whitelistTraceFields(env, identity, clientEmail, "token_then_body");
  logUnlockTrace("unlock_trace.whitelist", {
    route: "/api/unlock-web",
    caller: unlockCaller(request),
    ...whitelist,
  });
  const priorEntitlement = unlockTraceActive()
    ? await readEntitlement(env, identity.sub)
    : null;
  const submitted = Array.isArray(transactions) ? transactions.slice(0, 20) : [];

  const now = Date.now();
  const candidates: Entitlement[] = [];
  const transactionSkipReasons: string[] = [];
  const acceptedProductIds: string[] = [];
  for (const raw of submitted) {
    if (typeof raw !== "string") {
      if (unlockTraceActive()) transactionSkipReasons.push("not_jws_string");
      continue;
    }
    try {
      const transaction = await verifyAppleJws<SignedTransaction>(raw);
      if (!acceptTransaction(env, transaction, now)) {
        if (unlockTraceActive()) {
          transactionSkipReasons.push(transactionSkipReason(env, transaction, now));
        }
        continue;
      }
      candidates.push({
        productId: transaction.productId!,
        originalTransactionId:
          transaction.originalTransactionId ?? transaction.transactionId ?? "",
        expiresAt: transaction.expiresDate ?? null,
        environment: transaction.environment ?? "Production",
        updatedAt: now,
      });
      if (unlockTraceActive() && transaction.productId) {
        acceptedProductIds.push(transaction.productId);
      }
    } catch (e) {
      if (unlockTraceActive()) {
        transactionSkipReasons.push(e instanceof AppleJwsError ? "jws_invalid" : "jws_error");
      }
      if (!(e instanceof AppleJwsError)) console.error("transaction verification failed", e);
    }
  }

  const entitlement =
    bestEntitlement(candidates) ?? (whitelisted ? complimentaryEntitlement(now) : null);
  if (!entitlement) {
    logUnlockTrace("unlock_trace.unlock_web", {
      route: "/api/unlock-web",
      http_status: 402,
      caller: unlockCaller(request),
      branch: "no_purchase_and_no_complimentary",
      session_created: false,
      sandbox_allowed: env.APPLE_ALLOW_SANDBOX !== "0",
      transaction_submitted_count: submitted.length,
      transaction_accepted_count: 0,
      transaction_skip_reasons: transactionSkipReasons,
      response_error: "no active purchase",
      user_facing_error: USER_FACING_APP_NO_PURCHASE,
      ...whitelist,
      ...entitlementTraceFields(priorEntitlement, now),
    });
    return json({ error: "no active purchase" }, 402);
  }

  const ttl =
    entitlement.expiresAt === null
      ? LIFETIME_TTL_SECONDS
      : Math.max(60, Math.ceil((entitlement.expiresAt - now) / 1000) + ENTITLEMENT_GRACE_SECONDS);
  await env.CACHE.put(entitlementKey(identity.sub), JSON.stringify(entitlement), {
    expirationTtl: ttl,
  });

  const sessionId = await createSession(env, identity.sub);
  logUnlockTrace("unlock_trace.unlock_web", {
    route: "/api/unlock-web",
    http_status: 200,
    caller: unlockCaller(request),
    branch: entitlement.productId === COMPLIMENTARY_PRODUCT_ID
      ? "complimentary_grant"
      : "purchase_linked",
    session_created: true,
    sandbox_allowed: env.APPLE_ALLOW_SANDBOX !== "0",
    transaction_submitted_count: submitted.length,
    transaction_accepted_count: candidates.length,
    transaction_skip_reasons: transactionSkipReasons,
    accepted_product_ids: acceptedProductIds,
    response_error: null,
    user_facing_error: null,
    ...whitelist,
    ...entitlementTraceFields(entitlement, now),
  });
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
