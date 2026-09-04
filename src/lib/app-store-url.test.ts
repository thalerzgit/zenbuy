import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  configuredAppUrl,
  isTestFlightUrl,
  storeRowCopy,
} from "./app-store-url.ts";

const TESTFLIGHT = "https://testflight.apple.com/join/kMJsdtWY";
const APP_STORE = "https://apps.apple.com/app/id6807960678";

test("empty APP_STORE_URL hides Get the App surfaces", () => {
  assert.equal(configuredAppUrl(""), "");
  assert.equal(configuredAppUrl("  "), "");
  assert.equal(configuredAppUrl(undefined), "");
});

test("TestFlight copy does not claim App Store availability", () => {
  assert.equal(isTestFlightUrl(TESTFLIGHT), true);
  const copy = storeRowCopy(TESTFLIGHT);
  assert.match(copy.linkText, /TestFlight/i);
  assert.match(copy.note, /TestFlight/i);
  assert.doesNotMatch(copy.linkText, /App Store/i);
  assert.doesNotMatch(copy.note, /Available on the Apple App Store/i);
});

test("App Store URL restores store listing copy after the one-knob swap", () => {
  assert.equal(isTestFlightUrl(APP_STORE), false);
  const copy = storeRowCopy(APP_STORE);
  assert.match(copy.linkText, /App Store/);
  assert.match(copy.note, /Available on the Apple App Store/);
});

test("wrangler APP_STORE_URL is the public download knob", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "../../wrangler.jsonc");
  const stripped = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
  const url = (JSON.parse(stripped) as { vars: { APP_STORE_URL?: string } }).vars
    .APP_STORE_URL;
  assert.ok(configuredAppUrl(url), "empty hides the header pill and store row");
  assert.match(
    configuredAppUrl(url),
    /^https:\/\/(testflight\.apple\.com\/join\/|apps\.apple\.com\/)/
  );
});
