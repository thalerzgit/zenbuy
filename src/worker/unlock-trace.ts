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

/** Which unlock half this request is. Web SIWA never sees StoreKit JWS. */
export type UnlockPath = "web_siwa" | "app_unlock_web" | "api_me";

export function sandboxConfigFields(allowSandbox: string | undefined): Record<string, unknown> {
  return {
    apple_allow_sandbox: allowSandbox ?? "(unset)",
    sandbox_policy: allowSandbox === "0" ? "reject_sandbox" : "accept_sandbox",
  };
}

export function sandboxGateForTrace(
  environment: string | null | undefined,
  allowSandbox: string | undefined
): "sandbox_allowed" | "sandbox_blocked" | "not_sandbox" | "unknown" {
  if (!environment) return "unknown";
  if (environment !== "Sandbox") return "not_sandbox";
  return allowSandbox === "0" ? "sandbox_blocked" : "sandbox_allowed";
}

/**
 * Did APPLE_ALLOW_SANDBOX decide this transaction, or did another check?
 * Does not change accept/reject — it only labels what already happened.
 */
export function sandboxGateEffect(
  environment: string | null | undefined,
  accepted: boolean,
  skipReason: string | null,
  allowSandbox: string | undefined
):
  | "rejected_by_apple_allow_sandbox"
  | "accepted_by_apple_allow_sandbox"
  | "not_sandbox_not_gated"
  | "not_the_deciding_check" {
  if (skipReason === "sandbox_blocked") return "rejected_by_apple_allow_sandbox";
  const gate = sandboxGateForTrace(environment, allowSandbox);
  if (accepted && gate === "sandbox_allowed") return "accepted_by_apple_allow_sandbox";
  if (accepted && (gate === "not_sandbox" || gate === "unknown")) {
    return "not_sandbox_not_gated";
  }
  return "not_the_deciding_check";
}

export function transactionSeenFields(
  productId: string | null | undefined,
  environment: string | null | undefined,
  accepted: boolean,
  skipReason: string | null,
  allowSandbox: string | undefined
): Record<string, unknown> {
  return {
    product_id: productId ?? null,
    environment: environment ?? null,
    accepted,
    skip_reason: skipReason,
    sandbox_gate: sandboxGateForTrace(environment, allowSandbox),
    sandbox_gate_effect: sandboxGateEffect(environment, accepted, skipReason, allowSandbox),
  };
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
