import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EDITABLE_VERSION_STATES,
  attachBuild,
  ensureVersionOnReviewSubmission,
  submissionHasAppStoreVersion,
  waitForEditableVersion,
} from "./asc-listing.mjs";

test("editable version states are the ones that accept a new Dist build", () => {
  assert.ok(EDITABLE_VERSION_STATES.has("PREPARE_FOR_SUBMISSION"));
  assert.ok(EDITABLE_VERSION_STATES.has("DEVELOPER_REJECTED"));
  assert.equal(EDITABLE_VERSION_STATES.has("WAITING_FOR_REVIEW"), false);
  assert.equal(EDITABLE_VERSION_STATES.has("IN_REVIEW"), false);
});

test("waitForEditableVersion returns immediately when already editable", async () => {
  const version = {
    id: "ver-1",
    attributes: { appStoreState: "DEVELOPER_REJECTED" },
  };
  const out = await waitForEditableVersion(
    async () => {
      throw new Error("should not refetch");
    },
    version,
    { label: "test version" }
  );
  assert.equal(out.id, "ver-1");
});

test("attachBuild skips PATCH when the build is already on the version", async () => {
  const calls = [];
  const asc = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET" });
    if (path.endsWith("/build")) return { data: { id: "build-9" } };
    throw new Error(`unexpected ${path}`);
  };
  await attachBuild(asc, "ver-1", "build-9", { label: "Dist tvOS build" });
  assert.deepEqual(calls, [{ path: "/v1/appStoreVersions/ver-1/build", method: "GET" }]);
});

test("submissionHasAppStoreVersion matches relationship id", () => {
  assert.equal(
    submissionHasAppStoreVersion(
      [
        {
          relationships: {
            appStoreVersion: { data: { type: "appStoreVersions", id: "ver-9" } },
          },
        },
      ],
      "ver-9"
    ),
    true
  );
  assert.equal(submissionHasAppStoreVersion([], "ver-9"), false);
  assert.equal(
    submissionHasAppStoreVersion(
      [{ relationships: { appStoreVersion: { data: { id: "other" } } } }],
      "ver-9"
    ),
    false
  );
});

test("ensureVersionOnReviewSubmission does not trust false already 409", async () => {
  const calls = [];
  let items = []; // empty — ASC lied with 409 already
  let posts = 0;
  const asc = async (path, opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ path, method });
    if (path.includes("/items")) return { data: items };
    if (path === "/v1/reviewSubmissionItems" && method === "POST") {
      posts += 1;
      if (posts === 1) {
        const err = new Error("ASC POST → 409: Entity already exists");
        err.status = 409;
        throw err;
      }
      // retry succeeds and items become populated
      items = [
        {
          relationships: {
            appStoreVersion: { data: { type: "appStoreVersions", id: "ver-tv" } },
          },
        },
      ];
      return { data: { id: "item-1" } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };

  const out = await ensureVersionOnReviewSubmission(asc, "sub-1", "ver-tv", {
    label: "tvOS version",
  });
  assert.equal(submissionHasAppStoreVersion(out, "ver-tv"), true);
  assert.equal(posts, 2); // first 409 (false already), then retry
  assert.ok(calls.some((c) => c.path.includes("/items")));
});

test("ensureVersionOnReviewSubmission refuses submitted:true when items stay empty", async () => {
  const asc = async (path, opts = {}) => {
    if (path.includes("/items")) return { data: [] };
    if (path === "/v1/reviewSubmissionItems" && opts.method === "POST") {
      return { data: { id: "item-ghost" } }; // POST "ok" but list still empty
    }
    throw new Error(`unexpected ${path}`);
  };
  await assert.rejects(
    () => ensureVersionOnReviewSubmission(asc, "sub-1", "ver-tv", { label: "tvOS version" }),
    /no appStoreVersion item|Refusing submitted:true/
  );
});
