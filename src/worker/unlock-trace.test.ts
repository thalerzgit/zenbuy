import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UNLOCK_TRACE_EXPIRES_AT,
  UNLOCK_TRACE_EXPIRES_MS,
  emailDomainOnly,
  logUnlockTrace,
  sandboxConfigFields,
  sandboxGateEffect,
  sandboxGateForTrace,
  subPrefixOnly,
  transactionSeenFields,
  unlockCaller,
  unlockTraceActive,
} from "./unlock-trace.ts";

test("the extra unlock traces hard-stop at 2026-09-09T01:10:00Z", () => {
  assert.equal(UNLOCK_TRACE_EXPIRES_AT, "2026-09-09T01:10:00Z");
  assert.equal(unlockTraceActive(UNLOCK_TRACE_EXPIRES_MS - 1), true);
  assert.equal(unlockTraceActive(UNLOCK_TRACE_EXPIRES_MS), false);
  assert.equal(unlockTraceActive(UNLOCK_TRACE_EXPIRES_MS + 60_000), false);
});

test("emailDomainOnly never returns a local part", () => {
  assert.equal(emailDomainOnly("thalerz@me.com"), "me.com");
  assert.equal(emailDomainOnly("tdmorgenthaler@icloud.com"), "icloud.com");
  assert.equal(emailDomainOnly("someone@privaterelay.appleid.com"), "privaterelay.appleid.com");
  assert.equal(emailDomainOnly("  Friend@Example.COM  "), "example.com");
  assert.equal(emailDomainOnly(undefined), null);
  assert.equal(emailDomainOnly(""), null);
  assert.equal(emailDomainOnly("Justin Morgenthaler"), "(no-domain)");
});

test("subPrefixOnly never returns the full Apple subject", () => {
  const sub = "001234.9f8e7d6c5b4a.1234";
  assert.equal(subPrefixOnly(sub), "001234.9…");
  assert.notEqual(subPrefixOnly(sub), sub);
  assert.equal(sub.includes(subPrefixOnly(sub)!.replace("…", "")), true);
  assert.equal(subPrefixOnly("short-sub"), "(short)");
  assert.equal(subPrefixOnly(null), null);
});

test("logUnlockTrace is a no-op after the expiry instant", () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    logUnlockTrace("unlock_trace.unlock_web", { branch: "after" }, UNLOCK_TRACE_EXPIRES_MS);
    assert.equal(lines.length, 0);
    logUnlockTrace(
      "unlock_trace.siwa_callback",
      { branch: "before", sub_prefix: subPrefixOnly("001234.9f8e7d6c5b4a.1234") },
      UNLOCK_TRACE_EXPIRES_MS - 1
    );
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]) as { event: string; sub_prefix: string };
    assert.equal(payload.event, "unlock_trace.siwa_callback");
    assert.equal(payload.sub_prefix, "001234.9…");
    assert.equal(lines[0].includes("001234.9f8e7d6c5b4a.1234"), false);
  } finally {
    console.log = original;
  }
});

test("unlockCaller treats X-ZenBuy-Client ios as the app", () => {
  assert.equal(
    unlockCaller(
      new Request("https://zenbuy.info/api/unlock-web", {
        headers: { "X-ZenBuy-Client": "ios" },
      })
    ),
    "ios_app"
  );
  assert.equal(unlockCaller(new Request("https://zenbuy.info/auth/apple/callback")), "web");
});

test("sandbox gate labels accept vs reject without changing the rule", () => {
  assert.deepEqual(sandboxConfigFields("1"), {
    apple_allow_sandbox: "1",
    sandbox_policy: "accept_sandbox",
  });
  assert.deepEqual(sandboxConfigFields("0"), {
    apple_allow_sandbox: "0",
    sandbox_policy: "reject_sandbox",
  });
  assert.equal(sandboxGateForTrace("Sandbox", "1"), "sandbox_allowed");
  assert.equal(sandboxGateForTrace("Sandbox", "0"), "sandbox_blocked");
  assert.equal(sandboxGateForTrace("Production", "0"), "not_sandbox");
  assert.equal(sandboxGateForTrace(undefined, "1"), "unknown");
  assert.equal(
    sandboxGateEffect("Sandbox", false, "sandbox_blocked", "0"),
    "rejected_by_apple_allow_sandbox"
  );
  assert.equal(
    sandboxGateEffect("Sandbox", true, null, "1"),
    "accepted_by_apple_allow_sandbox"
  );
  assert.equal(
    sandboxGateEffect("Production", true, null, "1"),
    "not_sandbox_not_gated"
  );
  assert.equal(
    sandboxGateEffect("Sandbox", false, "product_not_pro", "1"),
    "not_the_deciding_check"
  );
  const seen = transactionSeenFields(
    "info.zenbuy.app.lifetime",
    "Sandbox",
    false,
    "sandbox_blocked",
    "0"
  );
  assert.equal(seen.product_id, "info.zenbuy.app.lifetime");
  assert.equal(seen.environment, "Sandbox");
  assert.equal(seen.sandbox_gate_effect, "rejected_by_apple_allow_sandbox");
});
