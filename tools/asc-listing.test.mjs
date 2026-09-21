import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EDITABLE_VERSION_STATES,
  attachBuild,
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
