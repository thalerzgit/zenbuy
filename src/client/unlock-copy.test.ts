import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appLinkCopy } from "./unlock.ts";

describe("appLinkCopy", () => {
  it("calls a TestFlight link a beta, never an App Store listing", () => {
    const copy = appLinkCopy("https://testflight.apple.com/join/kMJsdtWY");
    assert.match(copy.link, /TestFlight/);
    assert.doesNotMatch(copy.link, /App Store/);
    assert.doesNotMatch(copy.note, /Available on the Apple App Store/);
    assert.match(copy.note, /beta/i);
  });

  it("switches to store wording once the URL is the listing", () => {
    const copy = appLinkCopy("https://apps.apple.com/app/id6807960678");
    assert.match(copy.link, /App Store/);
    assert.match(copy.note, /Available on the Apple App Store/);
  });

  it("stays on the default wording when the URL cannot be read", () => {
    assert.deepEqual(
      appLinkCopy("not a url"),
      appLinkCopy("https://apps.apple.com/app/id6807960678"),
    );
  });
});
