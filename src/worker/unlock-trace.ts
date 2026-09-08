/**
 * Temporary unlock RCA traces. Hard-stop after UNLOCK_TRACE_EXPIRES_AT.
 * After that instant every helper is a no-op — no extra logs, no extra reads.
 *
 * Delete this file (and its call sites) once the 2026-09-08 linkage retry
 * has been read from Workers logs. Not a permanent debug flag.
 */

export const UNLOCK_TRACE_EXPIRES_AT = "2026-09-09T01:10:00Z";
export const UNLOCK_TRACE_EXPIRES_MS = Date.parse(UNLOCK_TRACE_EXPIRES_AT);

/** Exact copy the iOS app shows on HTTP 402 from POST /api/unlock-web. */
export const USER_FACING_APP_NO_PURCHASE =
  "No active ZenBuy purchase on this Apple ID, and it has no complimentary access. Buy or restore first, then link.";

/** Exact copy the website banner shows when /api/me is signed-in, not unlocked. */
export const USER_FACING_WEB_UNLINKED =
  'You\'re signed in, but your purchase isn\'t linked yet. Open ZenBuy on your iPhone → tap "Unlock Web" → Sign in with Apple. Then refresh here.';

export const USER_FACING_WEB_SIGNIN_FAILED =
  "Sign-in didn't complete — try again anytime.";

export const USER_FACING_APP_BAD_TOKEN =
  "Apple couldn't verify that sign-in. Try again.";

export function unlockTraceActive(now = Date.now()): boolean {
  return now < UNLOCK_TRACE_EXPIRES_MS;
}

/** Domain only — never the local part. */
export function emailDomainOnly(email: string | null | undefined): string | null {
  if (!email?.trim()) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return "(no-domain)";
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * Prefix only. Apple `sub` values are long dotted ids; a short value is
 * treated as present-but-redacted so this never echoes the full subject.
 */
export function subPrefixOnly(sub: string | null | undefined): string | null {
  if (!sub) return null;
  if (sub.length <= 12) return "(short)";
  return `${sub.slice(0, 8)}…`;
}

export function unlockCaller(request: Request): "ios_app" | "web" {
  return request.headers.get("X-ZenBuy-Client")?.toLowerCase() === "ios"
    ? "ios_app"
    : "web";
}

/** Structured JSON so Cloudflare Workers logs stay greppable. */
export function logUnlockTrace(
  event: string,
  fields: Record<string, unknown>,
  now = Date.now()
): void {
  if (!unlockTraceActive(now)) return;
  console.log(JSON.stringify({ event, ...fields }));
}
