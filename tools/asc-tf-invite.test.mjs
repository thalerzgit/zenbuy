import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignLatestDistBuild,
  ensureQuietTester,
  groupHasTesterEmail,
  pickLatestDistBuild,
  quietSkipLog,
} from "./asc-tf-invite.mjs";

test("groupHasTesterEmail matches case-insensitively", () => {
  const testers = [
    { id: "t1", attributes: { email: "Thalerz@Me.com" } },
    { id: "t2", attributes: { email: "other@example.com" } },
  ];
  assert.equal(groupHasTesterEmail(testers, "thalerz@me.com"), true);
  assert.equal(groupHasTesterEmail(testers, " missing@example.com "), false);
});

test("quietSkipLog is a single line with the email and group", () => {
  assert.equal(
    quietSkipLog("Thalerz@Me.com", "Internal Testers"),
    "Quiet skip: thalerz@me.com already in Internal Testers."
  );
});

test("ensureQuietTester skips every invite POST when email is already a member", async () => {
  const calls = [];
  const testers = [{ id: "t1", attributes: { email: "thalerz@me.com" } }];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET" });
    if (path.includes("/betaTesters") && !opts.method) {
      return { data: testers };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  const out = await ensureQuietTester(asc, {
    email: "Thalerz@Me.com",
    group: { id: "g1", attributes: { name: "Internal Testers" } },
    groupName: "Internal Testers",
    findTester: async () => {
      throw new Error("should not look up tester when already a member");
    },
  });
  assert.equal(out.skipped, true);
  assert.equal(out.invited, false);
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false
  );
});

test("ensureQuietTester creates a tester when the email is missing from the group", async () => {
  const calls = [];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET", body: opts.body });
    if (path.includes("/betaTesters") && (opts.method || "GET") === "GET") {
      return { data: [] };
    }
    if (path === "/v1/betaTesters" && opts.method === "POST") {
      return { data: { id: "new-tester", attributes: { email: "new@example.com" } } };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  const out = await ensureQuietTester(asc, {
    email: "new@example.com",
    group: { id: "g1", attributes: { name: "Internal Testers" } },
    groupName: "Internal Testers",
    findTester: async () => null,
  });
  assert.equal(out.skipped, false);
  assert.equal(out.invited, true);
  assert.equal(out.tester.id, "new-tester");
  assert.ok(calls.some((c) => c.path === "/v1/betaTesters" && c.method === "POST"));
});

test("ensureQuietTester adds an existing tester who is missing from the group", async () => {
  const calls = [];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET", body: opts.body });
    if (path.includes("/betaTesters") && (opts.method || "GET") === "GET") {
      return { data: [] };
    }
    if (path === "/v1/betaGroups/g1/relationships/betaTesters" && opts.method === "POST") {
      return { data: [] };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  const out = await ensureQuietTester(asc, {
    email: "new@example.com",
    group: { id: "g1", attributes: { name: "Internal Testers" } },
    groupName: "Internal Testers",
    findTester: async () => ({ id: "existing", attributes: { email: "new@example.com" } }),
  });
  assert.equal(out.skipped, false);
  assert.equal(out.invited, true);
  assert.ok(
    calls.some(
      (c) =>
        c.method === "POST" &&
        c.path === "/v1/betaGroups/g1/relationships/betaTesters" &&
        c.body.data[0].id === "existing"
    )
  );
});

test("pickLatestDistBuild skips expired and other platforms", () => {
  const payload = {
    data: [
      {
        id: "tv-old",
        attributes: { version: "1", expired: false },
        relationships: { preReleaseVersion: { data: { id: "pre-tv" } } },
      },
      {
        id: "ios-expired",
        attributes: { version: "2", expired: true },
        relationships: { preReleaseVersion: { data: { id: "pre-ios" } } },
      },
      {
        id: "ios-ok",
        attributes: { version: "3", expired: false },
        relationships: { preReleaseVersion: { data: { id: "pre-ios" } } },
      },
    ],
    included: [
      { type: "preReleaseVersions", id: "pre-tv", attributes: { platform: "TV_OS", version: "1.6" } },
      { type: "preReleaseVersions", id: "pre-ios", attributes: { platform: "IOS", version: "1.6" } },
    ],
  };
  assert.equal(pickLatestDistBuild(payload, "IOS").build.id, "ios-ok");
  assert.equal(pickLatestDistBuild(payload, "TV_OS").build.id, "tv-old");
});

test("assignLatestDistBuild treats hasAccessToAllBuilds as auto-assign (no POST)", async () => {
  const calls = [];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET" });
    if (path.startsWith("/v1/builds")) {
      return {
        data: [
          {
            id: "b1",
            attributes: { version: "42", expired: false },
            relationships: { preReleaseVersion: { data: { id: "pre-ios" } } },
          },
        ],
        included: [
          {
            type: "preReleaseVersions",
            id: "pre-ios",
            attributes: { platform: "IOS", version: "1.6" },
          },
        ],
      };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  const out = await assignLatestDistBuild(asc, {
    appId: "app-1",
    group: {
      id: "g1",
      attributes: { name: "Internal Testers", hasAccessToAllBuilds: true },
    },
    platform: "IOS",
  });
  assert.equal(out.assigned, "auto");
  assert.equal(out.build.id, "b1");
  assert.ok(calls.every((c) => c.method === "GET"));
});

test("assignLatestDistBuild POSTs the latest Dist build when the group is not auto", async () => {
  const calls = [];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET", body: opts.body });
    if (path.startsWith("/v1/builds")) {
      return {
        data: [
          {
            id: "b9",
            attributes: { version: "99", expired: false },
            relationships: { preReleaseVersion: { data: { id: "pre-tv" } } },
          },
        ],
        included: [
          {
            type: "preReleaseVersions",
            id: "pre-tv",
            attributes: { platform: "TV_OS", version: "1.6" },
          },
        ],
      };
    }
    if (path === "/v1/betaGroups/g-ext/relationships/builds" && opts.method === "POST") {
      return { data: [] };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  const out = await assignLatestDistBuild(asc, {
    appId: "app-1",
    group: { id: "g-ext", attributes: { name: "External Testers", hasAccessToAllBuilds: false } },
    platform: "TV_OS",
  });
  assert.equal(out.assigned, true);
  assert.equal(out.build.id, "b9");
  assert.ok(
    calls.some(
      (c) =>
        c.method === "POST" &&
        c.path === "/v1/betaGroups/g-ext/relationships/builds" &&
        c.body.data[0].id === "b9"
    )
  );
});
