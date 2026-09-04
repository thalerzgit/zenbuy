/**
 * Sign in with Apple: identity-token verification and the ES256 client secret
 * Apple's token endpoint expects.
 *
 * Two audiences share this code. The iOS app presents an identity token whose
 * `aud` is the bundle id; the website's OAuth callback presents one whose
 * `aud` is the Services ID. Both are issued to the same Apple Developer team,
 * so — provided the Services ID is grouped under the primary App ID — Apple
 * returns the *same* `sub` for a given person in both. That shared `sub` is
 * what ties an App Store purchase to a browser session.
 */

import { base64ToBytes } from "./apple-jws";

const APPLE_ISSUER = "https://appleid.apple.com";
const JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const JWKS_CACHE_KEY = "apple:jwks";
const JWKS_TTL_SECONDS = 43_200;
/** Apple caps client secrets at six months; short-lived is plenty here. */
const CLIENT_SECRET_TTL_SECONDS = 300;
/** Absorbs modest clock skew between Apple and the edge. */
const CLOCK_SKEW_SECONDS = 60;

export class AppleAuthError extends Error {}

export interface AppleIdentity {
  sub: string;
  email?: string;
}

interface AppleJwk {
  kty: string;
  kid: string;
  n: string;
  e: string;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64ToBytes(segment)));
  } catch {
    throw new AppleAuthError("unreadable token segment");
  }
}

async function fetchJwks(env: Env, allowCache: boolean): Promise<AppleJwk[]> {
  if (allowCache) {
    const cached = await env.CACHE.get(JWKS_CACHE_KEY, "json").catch(() => null);
    if (cached) return (cached as { keys: AppleJwk[] }).keys ?? [];
  }

  const response = await fetch(JWKS_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new AppleAuthError(`Apple key set unavailable (${response.status})`);

  const body = (await response.json()) as { keys?: AppleJwk[] };
  const keys = body.keys ?? [];
  await env.CACHE.put(JWKS_CACHE_KEY, JSON.stringify({ keys }), {
    expirationTtl: JWKS_TTL_SECONDS,
  }).catch(() => {});
  return keys;
}

/**
 * Verify an Apple ID token and return the identity it asserts.
 *
 * @param audience the client id the token was issued to — bundle id for the
 *   app, Services ID for the website.
 */
export async function verifyAppleIdToken(
  env: Env,
  token: string,
  audience: string
): Promise<AppleIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AppleAuthError("malformed identity token");

  const header = decodeSegment(parts[0]) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") throw new AppleAuthError("unexpected identity token algorithm");
  if (!header.kid) throw new AppleAuthError("identity token has no key id");

  // A rotated key is the one legitimate reason a cached set can miss, so
  // refetch once before rejecting the token.
  let jwk = (await fetchJwks(env, true)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await fetchJwks(env, false)).find((k) => k.kid === header.kid);
  if (!jwk) throw new AppleAuthError("identity token signed by an unknown key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signatureOk = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64ToBytes(parts[2]).slice().buffer as ArrayBuffer,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`).buffer as ArrayBuffer
  );
  if (!signatureOk) throw new AppleAuthError("identity token signature does not verify");

  const claims = decodeSegment(parts[1]) as {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    sub?: string;
    email?: string;
  };

  if (claims.iss !== APPLE_ISSUER) throw new AppleAuthError("identity token has the wrong issuer");

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) {
    throw new AppleAuthError("identity token was issued for a different client");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) {
    throw new AppleAuthError("identity token has expired");
  }
  if (!claims.sub) throw new AppleAuthError("identity token has no subject");

  return { sub: claims.sub, email: claims.email };
}

/**
 * Mint the ES256 JWT Apple accepts in place of a client secret, signed with
 * the Sign in with Apple `.p8` key.
 */
export async function appleClientSecret(env: Env): Promise<string> {
  const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_SERVICES_ID } = env;
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY || !APPLE_SERVICES_ID) {
    throw new AppleAuthError("Sign in with Apple is not configured");
  }

  const pkcs8 = base64ToBytes(
    APPLE_PRIVATE_KEY.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8.slice().buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const issuedAt = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const signingInput = [
    { alg: "ES256", kid: APPLE_KEY_ID },
    {
      iss: APPLE_TEAM_ID,
      iat: issuedAt,
      exp: issuedAt + CLIENT_SECRET_TTL_SECONDS,
      aud: APPLE_ISSUER,
      sub: APPLE_SERVICES_ID,
    },
  ]
    .map((part) => encodeBase64Url(encoder.encode(JSON.stringify(part))))
    .join(".");

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput).buffer as ArrayBuffer
  );

  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/** Trade an authorization code from the web callback for an identity token. */
export async function exchangeAuthorizationCode(
  env: Env,
  code: string,
  redirectUri: string
): Promise<AppleIdentity> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.APPLE_SERVICES_ID ?? "",
      client_secret: await appleClientSecret(env),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    id_token?: string;
    error?: string;
  };
  if (!response.ok || !body.id_token) {
    throw new AppleAuthError(`Apple rejected the authorization code (${body.error ?? response.status})`);
  }

  return verifyAppleIdToken(env, body.id_token, env.APPLE_SERVICES_ID ?? "");
}
