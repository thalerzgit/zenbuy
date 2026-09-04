import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { AppleJwsError, verifyAppleJws } from "./apple-jws.ts";

/**
 * Apple's real chain cannot be reproduced offline, so the fixture is a
 * synthetic chain with the same shape: a P-384 self-signed root, a P-256
 * intermediate it signed, and a P-256 leaf that signed the JWS. Tests pin the
 * synthetic root; production pins Apple's.
 */
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/apple-jws-chain.json", import.meta.url), "utf8")
) as { rootCertificate: string; payload: Record<string, unknown>; jws: string };

const options = { rootCertificate: fixture.rootCertificate };

function tamperPayload(jws: string, patch: Record<string, unknown>): string {
  const [header, payload, signature] = jws.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  const swapped = Buffer.from(JSON.stringify({ ...decoded, ...patch })).toString("base64url");
  return `${header}.${swapped}.${signature}`;
}

test("verifies a well-formed chain and returns the payload", async () => {
  const payload = await verifyAppleJws<Record<string, unknown>>(fixture.jws, options);
  assert.deepEqual(payload, fixture.payload);
});

test("rejects a payload edited after signing", async () => {
  await assert.rejects(
    verifyAppleJws(tamperPayload(fixture.jws, { productId: "info.zenbuy.app.free" }), options),
    AppleJwsError
  );
});

test("rejects a chain that does not reach the pinned root", async () => {
  // No override, so the real Apple root is expected and the fixture's is not it.
  await assert.rejects(verifyAppleJws(fixture.jws), AppleJwsError);
});

test("rejects a chain stripped down to its leaf", async () => {
  const [header, payload, signature] = fixture.jws.split(".");
  const decoded = JSON.parse(Buffer.from(header, "base64url").toString());
  const trimmed = Buffer.from(
    JSON.stringify({ ...decoded, x5c: [decoded.x5c[0]] })
  ).toString("base64url");
  await assert.rejects(verifyAppleJws(`${trimmed}.${payload}.${signature}`, options), AppleJwsError);
});

test("rejects certificates outside their validity window", async () => {
  await assert.rejects(
    verifyAppleJws(fixture.jws, { ...options, now: Date.parse("2100-01-01T00:00:00Z") }),
    AppleJwsError
  );
});

test("rejects an algorithm the verifier does not implement", async () => {
  const [, payload, signature] = fixture.jws.split(".");
  const header = Buffer.from(JSON.stringify({ alg: "none", x5c: [] })).toString("base64url");
  await assert.rejects(verifyAppleJws(`${header}.${payload}.${signature}`, options), AppleJwsError);
});

test("rejects input that is not a JWS at all", async () => {
  await assert.rejects(verifyAppleJws("not-a-token", options), AppleJwsError);
});
