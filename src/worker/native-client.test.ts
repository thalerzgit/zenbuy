import { test } from "node:test";
import assert from "node:assert/strict";
import { isNativeAppleClient } from "./native-client.ts";

function req(client?: string): Request {
  return new Request("https://zenbuy.info/api/research", {
    headers: client ? { "X-ZenBuy-Client": client } : {},
  });
}

test("isNativeAppleClient accepts ios and tvos only", () => {
  assert.equal(isNativeAppleClient(req("ios")), true);
  assert.equal(isNativeAppleClient(req("tvos")), true);
  assert.equal(isNativeAppleClient(req("IOS")), true);
  assert.equal(isNativeAppleClient(req("web")), false);
  assert.equal(isNativeAppleClient(req()), false);
});
