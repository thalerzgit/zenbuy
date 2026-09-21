import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  INTERNAL_QUIET_GROUP_ID,
  INTERNAL_QUIET_GROUP_NAME,
  assignLatestDistBuild,
  ensureQuietTester,
  groupHasTesterEmail,
  isExternalGroup,
  loadInternalQuietGroup,
  pickLatestDistBuild,
  quietSkipLog,
  resolveInternalQuietGroup,
  resolveQuietGroupEnv,
  runQuietInvite,
  shouldAssignBuild,
} from "./asc-tf-invite.mjs";

const QUIET = {
  id: INTERNAL_QUIET_GROUP_ID,
  attributes: {
    name: INTERNAL_QUIET_GROUP_NAME,
    isInternalGroup: true,
    hasAccessToAllBuilds: false,
  },
};

test("defaults are the COO Internal Quiet id and name", () => {
  assert.equal(INTERNAL_QUIET_GROUP_ID, "13d2bec7-2568-4bf3-91cc-5e99f48fdf17");
  assert.equal(INTERNAL_QUIET_GROUP_NAME, "Internal Quiet");
  const env = resolveQuietGroupEnv({});
  assert.equal(env.groupId, INTERNAL_QUIET_GROUP_ID);
  assert.equal(env.groupName, INTERNAL_QUIET_GROUP_NAME);
  assert.equal(env.assignBuild, false);
});

test("shouldAssignBuild is explicit-only", () => {
  assert.equal(shouldAssignBuild(undefined), false);
  assert.equal(shouldAssignBuild(""), false);
  assert.equal(shouldAssignBuild("false"), false);
  assert.equal(shouldAssignBuild("0"), false);
  assert.equal(shouldAssignBuild("1"), true);
  assert.equal(shouldAssignBuild("true"), true);
  assert.equal(shouldAssignBuild("YES"), true);
});

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
    quietSkipLog("Thalerz@Me.com", "Internal Quiet"),
    "Quiet skip: thalerz@me.com already in Internal Quiet."
  );
});

test("resolveInternalQuietGroup prefers the wired id over any other internal group", () => {
  const oldInternal = {
    id: "old-all-builds",
    attributes: { name: "Internal Testers", isInternalGroup: true, hasAccessToAllBuilds: true },
  };
  const match = resolveInternalQuietGroup([oldInternal, QUIET], {
    groupId: INTERNAL_QUIET_GROUP_ID,
    groupName: INTERNAL_QUIET_GROUP_NAME,
  });
  assert.equal(match.id, INTERNAL_QUIET_GROUP_ID);
});

test("resolveInternalQuietGroup matches exact name when id is absent from the list", () => {
  const named = {
    id: "other-uuid",
    attributes: { name: "Internal Quiet", isInternalGroup: true },
  };
  const match = resolveInternalQuietGroup([named], {
    groupId: INTERNAL_QUIET_GROUP_ID,
    groupName: INTERNAL_QUIET_GROUP_NAME,
  });
  assert.equal(match.id, "other-uuid");
});

test("resolveInternalQuietGroup does not invent or fall back to Internal Testers", () => {
  const oldInternal = {
    id: "old-all-builds",
    attributes: { name: "Internal Testers", isInternalGroup: true },
  };
  assert.equal(
    resolveInternalQuietGroup([oldInternal], {
      groupId: INTERNAL_QUIET_GROUP_ID,
      groupName: INTERNAL_QUIET_GROUP_NAME,
    }),
    null
  );
});

test("loadInternalQuietGroup throws instead of creating a replacement group", async () => {
  const calls = [];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET" });
    if (path.includes("/betaGroups") && (opts.method || "GET") === "GET") {
      return {
        data: [
          {
            id: "old-all-builds",
            attributes: { name: "Internal Testers", isInternalGroup: true },
          },
        ],
      };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  await assert.rejects(
    () => loadInternalQuietGroup(asc, "app-1"),
    /Do not invent another group/
  );
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false
  );
});

test("isExternalGroup detects External by flag or name", () => {
  assert.equal(
    isExternalGroup({ attributes: { name: "Friends", isInternalGroup: false } }),
    true
  );
  assert.equal(
    isExternalGroup({ attributes: { name: "External Testers", isInternalGroup: true } }),
    true
  );
  assert.equal(isExternalGroup(QUIET), false);
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
    group: QUIET,
    groupName: INTERNAL_QUIET_GROUP_NAME,
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
    group: QUIET,
    groupName: INTERNAL_QUIET_GROUP_NAME,
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
    if (
      path === `/v1/betaGroups/${INTERNAL_QUIET_GROUP_ID}/relationships/betaTesters` &&
      opts.method === "POST"
    ) {
      return { data: [] };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  const out = await ensureQuietTester(asc, {
    email: "new@example.com",
    group: QUIET,
    groupName: INTERNAL_QUIET_GROUP_NAME,
    findTester: async () => ({ id: "existing", attributes: { email: "new@example.com" } }),
  });
  assert.equal(out.skipped, false);
  assert.equal(out.invited, true);
  assert.ok(
    calls.some(
      (c) =>
        c.method === "POST" &&
        c.path === `/v1/betaGroups/${INTERNAL_QUIET_GROUP_ID}/relationships/betaTesters` &&
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
    if (
      path === `/v1/betaGroups/${INTERNAL_QUIET_GROUP_ID}/relationships/builds` &&
      opts.method === "POST"
    ) {
      return { data: [] };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  const out = await assignLatestDistBuild(asc, {
    appId: "app-1",
    group: QUIET,
    platform: "TV_OS",
  });
  assert.equal(out.assigned, true);
  assert.equal(out.build.id, "b9");
  assert.ok(
    calls.some(
      (c) =>
        c.method === "POST" &&
        c.path === `/v1/betaGroups/${INTERNAL_QUIET_GROUP_ID}/relationships/builds` &&
        c.body.data[0].id === "b9"
    )
  );
});

test("assignLatestDistBuild refuses External groups (no POST)", async () => {
  const calls = [];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET" });
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  const out = await assignLatestDistBuild(asc, {
    appId: "app-1",
    group: { id: "g-ext", attributes: { name: "External Testers", isInternalGroup: false } },
    platform: "IOS",
  });
  assert.equal(out.assigned, false);
  assert.equal(out.reason, "external");
  assert.equal(calls.length, 0);
});

function quietAsc({ members = [{ id: "t1", attributes: { email: "thalerz@me.com" } }] } = {}) {
  const calls = [];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET", body: opts.body });
    if (path.includes("/betaGroups") && path.includes("/apps/") && !opts.method) {
      return { data: [QUIET] };
    }
    if (path.includes("/betaTesters") && (opts.method || "GET") === "GET") {
      return { data: members };
    }
    if (path.startsWith("/v1/builds")) {
      return {
        data: [
          {
            id: "b-new",
            attributes: { version: "77", expired: false },
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
    if (path.includes("/relationships/builds") && opts.method === "POST") {
      return { data: [] };
    }
    throw new Error(`unexpected ${opts.method || "GET"} ${path}`);
  };
  return { asc, calls };
}

test("runQuietInvite is a silent no-op assign on the routine path", async () => {
  const { asc, calls } = quietAsc();
  const out = await runQuietInvite(asc, {
    appId: "app-1",
    email: "thalerz@me.com",
    platform: "IOS",
    findTester: async () => {
      throw new Error("already a member");
    },
    assignBuild: false,
  });
  assert.equal(out.skipped, true);
  assert.equal(out.invited, false);
  assert.equal(out.assigned, null);
  assert.equal(out.group.id, INTERNAL_QUIET_GROUP_ID);
  assert.equal(
    calls.some((c) => c.method === "POST"),
    false
  );
  assert.equal(
    calls.some((c) => String(c.path).includes("/relationships/builds")),
    false
  );
});

test("runQuietInvite assigns only when assignBuild is explicit", async () => {
  const { asc, calls } = quietAsc();
  const out = await runQuietInvite(asc, {
    appId: "app-1",
    email: "thalerz@me.com",
    platform: "IOS",
    findTester: async () => {
      throw new Error("already a member");
    },
    assignBuild: true,
  });
  assert.equal(out.skipped, true);
  assert.equal(out.invited, false);
  assert.equal(out.assigned.assigned, true);
  assert.ok(
    calls.some(
      (c) => c.method === "POST" && String(c.path).includes("/relationships/builds")
    )
  );
});

function assertQuietWorkflow(relPath) {
  const yml = readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8");
  assert.match(yml, /ASC_GROUP_NAME:\s*Internal Quiet/);
  assert.match(yml, /ASC_GROUP_ID:\s*13d2bec7-2568-4bf3-91cc-5e99f48fdf17/);
  assert.match(yml, /assign_build:/);
  assert.match(yml, /default:\s*false/);
  assert.match(yml, /Ensure Internal Quiet tester \(quiet\)/);
  assert.match(yml, /Assign Dist build to Internal Quiet/);
  assert.match(yml, /github\.event\.inputs\.assign_build == 'true'/);
  assert.doesNotMatch(yml, /ASC_GROUP_NAME:\s*Internal Testers/);
  assert.doesNotMatch(yml, /invite-tester[\s\S]*ASC_ASSIGN_BUILD/);
}

test("ios-testflight.yml wires Internal Quiet and no routine assign-build", () => {
  assertQuietWorkflow(".github/workflows/ios-testflight.yml");
});

test("tvos-testflight.yml wires Internal Quiet and no routine assign-build", () => {
  assertQuietWorkflow(".github/workflows/tvos-testflight.yml");
});
