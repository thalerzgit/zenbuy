import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyWhitelistGrant,
  completeUnlockWeb,
  emailForWhitelist,
  isNormalEmail,
  isWhitelisted,
  resolveUnlock,
  type Entitlement,
} from "./unlock.ts";
import { unlockTraceActive } from "./unlock-trace.ts";

/**
 * `APPLE_ID_WHITELIST` is the only way to be unlocked without a purchase, so
 * these tests pin both halves of it: who it matches, and that the grant it
 * writes survives Apple later hiding the address it was matched on.
 *
 * Everything upstream of the identity — token signatures, StoreKit receipts —
 * belongs to `apple-jws.test.ts`; here an identity is taken as given.
 */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: string) {
      const raw = store.get(key);
      if (raw == null) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

const SUB = "001234.9f8e7d6c5b4a.1234";
const SESSION = "session-token-abc";

/** A browser that has signed in with Apple and holds a session for `sub`. */
function signedIn(kv: ReturnType<typeof fakeKv>, sub = SUB): Request {
  kv.store.set(`apple:session:${SESSION}`, sub);
  return new Request("https://zenbuy.info/api/me", {
    headers: { cookie: `zb_session=${SESSION}` },
  });
}

function envWith(kv: ReturnType<typeof fakeKv>, whitelist = "") {
  return { CACHE: kv, APPLE_ID_WHITELIST: whitelist } as unknown as Env;
}

function storedEntitlement(kv: ReturnType<typeof fakeKv>): Entitlement | null {
  const raw = kv.store.get(`apple:entitlement:${SUB}`);
  return raw ? (JSON.parse(raw) as Entitlement) : null;
}

test("a whitelisted email is unlocked without any purchase", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "friend@example.com, other@example.com");

  assert.equal(
    await applyWhitelistGrant(env, { sub: SUB, email: "friend@example.com" }),
    true
  );
  assert.equal(storedEntitlement(kv)?.productId, "whitelist");
  assert.equal(storedEntitlement(kv)?.expiresAt, null);

  const state = await resolveUnlock(signedIn(kv), env);
  assert.deepEqual(state, {
    signedIn: true,
    unlocked: true,
    sub: SUB,
    complimentary: true,
  });
});

test("email matching ignores case and surrounding space", () => {
  const env = envWith(fakeKv(), "  Friend@Example.COM  ");
  assert.equal(isWhitelisted(env, { sub: SUB, email: "friend@example.com" }), true);
  assert.equal(isWhitelisted(env, { sub: SUB, email: "FRIEND@example.com" }), true);
});

test("a whitelisted sub: entry unlocks even when Apple sends no email", async () => {
  const kv = fakeKv();
  const env = envWith(kv, `sub:${SUB}`);

  assert.equal(await applyWhitelistGrant(env, { sub: SUB }), true);
  const state = await resolveUnlock(signedIn(kv), env);
  assert.equal(state.unlocked, true);
  assert.equal(state.complimentary, true);
});

test("a sub: entry added after sign-in unlocks with no stored entitlement", async () => {
  const kv = fakeKv();
  const request = signedIn(kv);

  assert.equal((await resolveUnlock(request, envWith(kv))).unlocked, false);
  const later = await resolveUnlock(request, envWith(kv, `sub:${SUB}`));
  assert.equal(later.unlocked, true);
  assert.equal(later.complimentary, true);
});

test("a signed-in Apple ID that is not listed still needs a purchase", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "friend@example.com");

  assert.equal(
    await applyWhitelistGrant(env, { sub: SUB, email: "stranger@example.com" }),
    false
  );
  assert.equal(storedEntitlement(kv), null);

  const state = await resolveUnlock(signedIn(kv), env);
  assert.equal(state.signedIn, true);
  assert.equal(state.unlocked, false);
  assert.equal(state.complimentary, false);
});

test("an empty whitelist grants nobody", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "   ");
  assert.equal(isWhitelisted(env, { sub: SUB, email: "friend@example.com" }), false);
  assert.equal((await resolveUnlock(signedIn(kv), env)).unlocked, false);
});

test("Hide My Email after a grant stays unlocked on the stored entitlement", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "friend@example.com");
  await applyWhitelistGrant(env, { sub: SUB, email: "friend@example.com" });

  // Apple stops sending the address, so only the earlier grant can answer.
  assert.equal(isWhitelisted(env, { sub: SUB }), false);
  assert.equal(await applyWhitelistGrant(env, { sub: SUB }), false);

  const state = await resolveUnlock(signedIn(kv), env);
  assert.equal(state.unlocked, true);
  assert.equal(state.complimentary, true);
});

test("a real purchase is never overwritten by a complimentary grant", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "friend@example.com");
  const purchase: Entitlement = {
    productId: "info.zenbuy.app.lifetime",
    originalTransactionId: "2000000012345678",
    expiresAt: null,
    environment: "Production",
    updatedAt: Date.now(),
  };
  kv.store.set(`apple:entitlement:${SUB}`, JSON.stringify(purchase));

  await applyWhitelistGrant(env, { sub: SUB, email: "friend@example.com" });
  assert.deepEqual(storedEntitlement(kv), purchase);

  // A buyer is a buyer: the daily allowance, not the uncounted bypass.
  const state = await resolveUnlock(signedIn(kv), env);
  assert.equal(state.unlocked, true);
  assert.equal(state.complimentary, false);
});

function unlockRequest(): Request {
  return new Request("https://zenbuy.info/api/unlock-web", { method: "POST" });
}

test("token email on the whitelist grants complimentary unlock", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "tdmorgenthaler@icloud.com,thalerz@me.com,thalerz@icloud.com");
  const response = await completeUnlockWeb(
    unlockRequest(),
    env,
    { sub: SUB, email: "thalerz@me.com" },
    []
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { unlocked: boolean; productId: string };
  assert.equal(body.unlocked, true);
  assert.equal(body.productId, "whitelist");
  assert.equal(storedEntitlement(kv)?.productId, "whitelist");
});

test("token email missing + body email on whitelist grants under the verified sub", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "tdmorgenthaler@icloud.com,thalerz@me.com,thalerz@icloud.com");
  const response = await completeUnlockWeb(
    unlockRequest(),
    env,
    { sub: SUB },
    [],
    "thalerz@icloud.com"
  );
  assert.equal(response.status, 200);
  assert.equal(storedEntitlement(kv)?.productId, "whitelist");

  // Later sign-in with no email still unlocks from the stored sub grant.
  const later = envWith(kv, "tdmorgenthaler@icloud.com,thalerz@me.com,thalerz@icloud.com");
  assert.equal(isWhitelisted(later, { sub: SUB }), false);
  const state = await resolveUnlock(signedIn(kv), later);
  assert.equal(state.unlocked, true);
  assert.equal(state.complimentary, true);
});

test("body email not on the whitelist still 402", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "tdmorgenthaler@icloud.com,thalerz@me.com,thalerz@icloud.com");
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  let response: Response;
  try {
    response = await completeUnlockWeb(
      unlockRequest(),
      env,
      { sub: SUB },
      [],
      "stranger@example.com"
    );
  } finally {
    console.log = original;
  }
  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), { error: "no active purchase" });
  assert.equal(storedEntitlement(kv), null);
  const joined = lines.join("\n");
  assert.equal(joined.includes("stranger@example.com"), false);
  assert.equal(joined.includes(SUB), false);
  if (unlockTraceActive()) {
    assert.equal(joined.includes("unlock_trace.unlock_web"), true);
    assert.equal(joined.includes("no_purchase_and_no_complimentary"), true);
    assert.equal(joined.includes("miss_email_not_listed"), true);
    assert.equal(joined.includes("\"unlock_path\":\"app_unlock_web\""), true);
    assert.equal(joined.includes("\"storekit_on_this_path\":true"), true);
    assert.equal(joined.includes("apple_allow_sandbox"), true);
  } else {
    assert.equal(joined.includes("unlock_trace."), false);
  }
});

test("empty email still 402", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "tdmorgenthaler@icloud.com,thalerz@me.com,thalerz@icloud.com");
  const noField = await completeUnlockWeb(unlockRequest(), env, { sub: SUB }, []);
  assert.equal(noField.status, 402);
  const empty = await completeUnlockWeb(unlockRequest(), env, { sub: SUB }, [], "");
  assert.equal(empty.status, 402);
  const blank = await completeUnlockWeb(unlockRequest(), env, { sub: SUB }, [], "   ");
  assert.equal(blank.status, 402);
  assert.equal(storedEntitlement(kv), null);
});

test("a display name is not a whitelist identity", () => {
  assert.equal(isNormalEmail("Justin Morgenthaler"), false);
  assert.equal(emailForWhitelist(undefined, "Justin Morgenthaler"), undefined);
  const env = envWith(fakeKv(), "tdmorgenthaler@icloud.com,thalerz@me.com,thalerz@icloud.com");
  assert.equal(
    isWhitelisted(env, {
      sub: SUB,
      email: emailForWhitelist(undefined, "Justin Morgenthaler"),
    }),
    false
  );
});

test("a client email cannot override a different token email", async () => {
  const kv = fakeKv();
  const env = envWith(kv, "thalerz@me.com");
  const response = await completeUnlockWeb(
    unlockRequest(),
    env,
    { sub: SUB, email: "stranger@example.com" },
    [],
    "thalerz@me.com"
  );
  assert.equal(response.status, 402);
  assert.equal(storedEntitlement(kv), null);
});

test("a lapsed subscription is not treated as a complimentary grant", async () => {
  const kv = fakeKv();
  kv.store.set(
    `apple:entitlement:${SUB}`,
    JSON.stringify({
      productId: "info.zenbuy.app.pro.monthly",
      originalTransactionId: "2000000012345678",
      expiresAt: Date.now() - 1000,
      environment: "Production",
      updatedAt: Date.now(),
    })
  );

  const state = await resolveUnlock(signedIn(kv), envWith(kv));
  assert.equal(state.unlocked, false);
  assert.equal(state.complimentary, false);
});
