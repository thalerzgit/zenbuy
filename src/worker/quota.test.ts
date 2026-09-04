import assert from "node:assert/strict";
import { test } from "node:test";

import { networkKey, openQuotaGate, VISITOR_COOKIE } from "./quota.ts";

/**
 * The point of these tests is the free-tier identity clustering: a visitor
 * must not get a fresh allowance by dropping one signal. KV is faked in
 * memory (TTLs are irrelevant inside one test) and `crypto.randomUUID` is
 * already global on Node 22.
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

function envWith(kv: ReturnType<typeof fakeKv>, extra: Record<string, string> = {}) {
  return {
    CACHE: kv,
    RATE_LIMIT_FREE_WEEKLY: "3",
    RATE_LIMIT_PRO_DAILY: "25",
    ...extra,
  } as unknown as Env;
}

function request(options: { cookie?: string; device?: string } = {}): Request {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", `${VISITOR_COOKIE}=${options.cookie}`);
  if (options.device) headers.set("X-ZenBuy-Device", options.device);
  return new Request("https://zenbuy.info/api/research", { method: "POST", headers });
}

/** Read the id the Worker minted, the way a browser would. */
function mintedCookie(setCookie: string | undefined): string {
  return setCookie?.match(/zb_vid=([^;]+)/)?.[1] ?? "";
}

const SIGNAL = "a".repeat(32);
const OTHER_SIGNAL = "b".repeat(32);

async function spend(
  env: Env,
  times: number,
  req: Request,
  signal: string
): Promise<void> {
  for (let i = 0; i < times; i++) {
    const gate = await openQuotaGate(req, env, "203.0.113.7", null, signal);
    assert.equal(gate.allowed, true, `report ${i + 1} should be allowed`);
    await gate.consume();
  }
}

test("free tier allows exactly the weekly limit, then names the wait", async () => {
  const env = envWith(fakeKv());
  const first = await openQuotaGate(request(), env, "203.0.113.7", null, SIGNAL);
  const cookie = mintedCookie(first.setCookie);
  assert.match(first.setCookie ?? "", /HttpOnly/);
  assert.match(first.setCookie ?? "", /Secure/);
  await first.consume();

  const req = request({ cookie });
  await spend(env, 2, req, SIGNAL);

  const denied = await openQuotaGate(req, env, "203.0.113.7", null, SIGNAL);
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, "free_limit");
  assert.match(denied.message ?? "", /3 a week/);
  assert.match(denied.message ?? "", /in about 7 days/);
});

test("clearing the cookie does not mint a fresh allowance", async () => {
  const env = envWith(fakeKv());
  const seed = await openQuotaGate(request(), env, "203.0.113.7", null, SIGNAL);
  await seed.consume();
  await spend(env, 2, request({ cookie: mintedCookie(seed.setCookie) }), SIGNAL);

  // Incognito: no cookie at all, same device signal.
  const incognito = await openQuotaGate(request(), env, "203.0.113.7", null, SIGNAL);
  assert.equal(incognito.allowed, false);
  assert.equal(incognito.code, "free_limit");
});

test("a new IP with the same device signal stays in the same bucket", async () => {
  const env = envWith(fakeKv());
  const seed = await openQuotaGate(request(), env, "203.0.113.7", null, SIGNAL);
  await seed.consume();
  await spend(env, 2, request({ cookie: mintedCookie(seed.setCookie) }), SIGNAL);

  // Incognito on a hotspot: different /24 and no cookie.
  const roaming = await openQuotaGate(request(), env, "198.51.100.9", null, SIGNAL);
  assert.equal(roaming.allowed, false);
});

test("an unrelated visitor gets their own allowance", async () => {
  const env = envWith(fakeKv());
  const seed = await openQuotaGate(request(), env, "203.0.113.7", null, SIGNAL);
  await seed.consume();
  await spend(env, 2, request({ cookie: mintedCookie(seed.setCookie) }), SIGNAL);

  const stranger = await openQuotaGate(
    request(),
    env,
    "198.51.100.9",
    null,
    OTHER_SIGNAL
  );
  assert.equal(stranger.allowed, true);
});

test("a device signal seen from many networks stops linking across them", async () => {
  const kv = fakeKv();
  const env = envWith(kv);
  // Stock-phone hash: pretend it has already been observed widely.
  kv.store.set(
    `fqf:${SIGNAL}`,
    JSON.stringify([
      "1.1.1.0/24",
      "2.2.2.0/24",
      "3.3.3.0/24",
      "4.4.4.0/24",
      "5.5.5.0/24",
      "6.6.6.0/24",
      "7.7.7.0/24",
    ])
  );

  const seed = await openQuotaGate(request(), env, "203.0.113.7", null, SIGNAL);
  await seed.consume();
  await spend(env, 2, request({ cookie: mintedCookie(seed.setCookie) }), SIGNAL);

  // Same generic hash, different network, no cookie: a different person.
  const elsewhere = await openQuotaGate(request(), env, "198.51.100.9", null, SIGNAL);
  assert.equal(elsewhere.allowed, true);

  // Same network is still linked, so the cleared cookie is still caught.
  const sameNetwork = await openQuotaGate(request(), env, "203.0.113.8", null, SIGNAL);
  assert.equal(sameNetwork.allowed, false);
});

test("native app requests are counted per keychain device id", async () => {
  const env = envWith(fakeKv());
  const device = "6F9619FF-8B86-D011-B42D-00CF4FC964FF";
  for (let i = 0; i < 3; i++) {
    const gate = await openQuotaGate(
      request({ device }),
      env,
      `203.0.113.${i + 1}`,
      null,
      ""
    );
    assert.equal(gate.allowed, true);
    await gate.consume();
  }

  const denied = await openQuotaGate(request({ device }), env, "198.51.100.4", null, "");
  assert.equal(denied.allowed, false);

  const otherPhone = await openQuotaGate(
    request({ device: "11111111-2222-3333-4444-555555555555" }),
    env,
    "198.51.100.4",
    null,
    ""
  );
  assert.equal(otherPhone.allowed, true);
});

test("a signal-less client falls back to its network", async () => {
  const env = envWith(fakeKv());
  for (let i = 0; i < 3; i++) {
    const gate = await openQuotaGate(request(), env, "203.0.113.7", null, "");
    assert.equal(gate.allowed, true);
    await gate.consume();
  }
  const denied = await openQuotaGate(request(), env, "203.0.113.90", null, "");
  assert.equal(denied.allowed, false);
});

test("unlocked buyers get the daily pro allowance, counted per Apple subject", async () => {
  const env = envWith(fakeKv(), { RATE_LIMIT_PRO_DAILY: "25" });
  for (let i = 0; i < 25; i++) {
    const gate = await openQuotaGate(request(), env, "203.0.113.7", "apple-sub-1", SIGNAL);
    assert.equal(gate.allowed, true);
    await gate.consume();
  }

  const denied = await openQuotaGate(request(), env, "203.0.113.7", "apple-sub-1", SIGNAL);
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, "pro_limit");
  assert.match(denied.message ?? "", /all 25 reports/);

  const otherBuyer = await openQuotaGate(
    request(),
    env,
    "203.0.113.7",
    "apple-sub-2",
    SIGNAL
  );
  assert.equal(otherBuyer.allowed, true);
});

test("whitelisted IPs are never counted", async () => {
  const env = envWith(fakeKv(), { RATE_LIMIT_WHITELIST: "203.0.113.7, 198.51.100.1" });
  for (let i = 0; i < 10; i++) {
    const gate = await openQuotaGate(request(), env, "203.0.113.7", null, SIGNAL);
    assert.equal(gate.allowed, true);
    await gate.consume();
  }
  assert.equal(
    (await openQuotaGate(request(), env, "203.0.113.7", null, SIGNAL)).allowed,
    true
  );
});

test("a complimentary Apple ID is never counted either", async () => {
  const env = envWith(fakeKv(), { RATE_LIMIT_PRO_DAILY: "25" });
  for (let i = 0; i < 40; i++) {
    const gate = await openQuotaGate(
      request(),
      env,
      "203.0.113.7",
      "apple-sub-1",
      SIGNAL,
      true
    );
    assert.equal(gate.allowed, true, `report ${i + 1} should be allowed`);
    await gate.consume();
  }
});

test("networkKey coarsens to /24 and /48", () => {
  assert.equal(networkKey("203.0.113.7"), "203.0.113.0/24");
  assert.equal(networkKey("2001:db8:1234:5678::1"), "2001:db8:1234::/48");
  assert.equal(networkKey("unknown"), "unknown");
});
