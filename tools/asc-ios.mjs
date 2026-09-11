#!/usr/bin/env node
/**
 * App Store Connect helper for ZenBuy iOS (TestFlight + review submit).
 * Uses ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY — never prints key material.
 *
 * Commands:
 *   ensure-app      READ-ONLY check that ASC app exists (never creates Bundle ID or app)
 *   invite-tester   Internal TestFlight group + email invite (requires app already in ASC)
 *   status          Print latest iOS versions, Dist builds, and review submissions
 *   submit-review   Wait VALID, retract in-flight review, submit latest Dist build
 *
 * Justin creates Bundle ID + ASC app in Apple Developer / App Store Connect UI.
 * Admin ASC API key cannot CREATE apps — do not attempt API create.
 * submit-review is ASC REST only (no signing, no Dev certs).
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const API = "https://api.appstoreconnect.apple.com";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function normalizePem(raw) {
  let key = raw.replace(/\\n/g, "\n").trim();
  if (!key.includes("BEGIN")) {
    key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
  }
  return key;
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function makeToken() {
  const iss = requiredEnv("ASC_ISSUER_ID");
  const kid = requiredEnv("ASC_KEY_ID");
  const pem = normalizePem(requiredEnv("ASC_PRIVATE_KEY"));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss,
      iat: now,
      exp: now + 20 * 60,
      aud: "appstoreconnect-v1",
    })
  );
  const signingInput = `${header}.${payload}`;
  const sign = createSign("SHA256");
  sign.update(signingInput);
  const sig = sign.sign({ key: pem, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(sig)}`;
}

async function asc(path, { method = "GET", body } = {}) {
  const token = makeToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  if (!res.ok) {
    const detail =
      json?.errors?.map((e) => e.detail || e.title).join("; ") ||
      text.slice(0, 400);
    const err = new Error(`ASC ${method} ${path} → ${res.status}: ${detail}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function findApp(bundleId) {
  const q = new URLSearchParams({ "filter[bundleId]": bundleId, limit: "5" });
  const data = await asc(`/v1/apps?${q}`);
  return data.data?.[0] ?? null;
}

async function findBundleId(identifier) {
  const q = new URLSearchParams({
    "filter[identifier]": identifier,
    limit: "5",
  });
  const data = await asc(`/v1/bundleIds?${q}`);
  return data.data?.[0] ?? null;
}

/** READ-ONLY: never POST Bundle ID or apps. Justin creates those in the ASC UI. */
async function ensureApp() {
  const bundleId = process.env.ASC_BUNDLE_ID || "info.zenbuy.app";

  const app = await findApp(bundleId);
  if (app) {
    console.log(`ASC app exists: ${app.id} (${bundleId})`);
    return app;
  }

  let bundleNote = "not found via API";
  try {
    const bundle = await findBundleId(bundleId);
    if (bundle) {
      bundleNote = `registered as ${bundle.id} (app record still missing)`;
    }
  } catch (err) {
    bundleNote = `lookup failed (${err.message || err})`;
  }

  console.error(`::error::No App Store Connect app for ${bundleId}.`);
  console.error(`Bundle ID status: ${bundleNote}.`);
  console.error(
    "BLOCKER: Justin must create Bundle ID + ASC app in Apple Developer / App Store Connect UI first."
  );
  console.error(
    "  • Identifiers → App IDs → info.zenbuy.app (iOS)"
  );
  console.error(
    "  • App Store Connect → My Apps → New App → name ZenBuy, bundle info.zenbuy.app, SKU zenbuy-ios-001"
  );
  console.error(
    "Do NOT create via ASC API (key cannot CREATE apps). After UI create + ASC_* secrets stamped, re-run Actions → TestFlight."
  );
  process.exit(1);
}

async function findOrCreateInternalGroup(appId, groupName) {
  // ASC rejects filter[name] and filter[isInternalGroup] on this relationship
  // (400). List groups, match name / internal flag client-side.
  const listed = await asc(
    `/v1/apps/${appId}/betaGroups?${new URLSearchParams({ limit: "50" })}`
  );
  const groups = listed.data || [];
  const match = groups.find((g) => g.attributes?.name === groupName);
  if (match) {
    console.log(`Beta group exists: ${match.id} (${groupName})`);
    return match;
  }

  const internal = groups.find((g) => g.attributes?.isInternalGroup);
  if (internal) {
    console.log(
      `Using existing internal group ${internal.id} (${internal.attributes?.name || "internal"})`
    );
    return internal;
  }

  const created = await asc("/v1/betaGroups", {
    method: "POST",
    body: {
      data: {
        type: "betaGroups",
        attributes: {
          name: groupName,
          isInternalGroup: true,
          hasAccessToAllBuilds: true,
        },
        relationships: {
          app: { data: { type: "apps", id: appId } },
        },
      },
    },
  });
  console.log(`Created internal beta group ${created.data.id}`);
  return created.data;
}

async function findTester(email) {
  const q = new URLSearchParams({ "filter[email]": email, limit: "5" });
  const data = await asc(`/v1/betaTesters?${q}`);
  return data.data?.[0] ?? null;
}

async function inviteTester() {
  const bundleId = process.env.ASC_BUNDLE_ID || "info.zenbuy.app";
  const email = (process.env.ASC_TESTER_EMAIL || "thalerz@me.com").toLowerCase();
  const groupName = process.env.ASC_GROUP_NAME || "Internal Testers";

  const app = await findApp(bundleId);
  if (!app) {
    console.error(`::error::No ASC app for ${bundleId}.`);
    console.error(
      "BLOCKER: Justin must create Bundle ID + ASC app in App Store Connect UI first, then re-run TestFlight."
    );
    process.exit(1);
  }

  const group = await findOrCreateInternalGroup(app.id, groupName);
  let tester = await findTester(email);

  if (!tester) {
    console.log(`Creating beta tester ${email}…`);
    try {
      const created = await asc("/v1/betaTesters", {
        method: "POST",
        body: {
          data: {
            type: "betaTesters",
            attributes: {
              email,
              firstName: "Cyber",
              lastName: "Man",
            },
            relationships: {
              betaGroups: {
                data: [{ type: "betaGroups", id: group.id }],
              },
            },
          },
        },
      });
      tester = created.data;
      console.log(`Created tester ${tester.id} and added to ${groupName}`);
      return tester;
    } catch (err) {
      if (err.status !== 409) throw err;
      tester = await findTester(email);
      if (!tester) throw err;
    }
  }

  console.log(`Adding existing tester ${tester.id} to group…`);
  try {
    await asc(`/v1/betaGroups/${group.id}/relationships/betaTesters`, {
      method: "POST",
      body: {
        data: [{ type: "betaTesters", id: tester.id }],
      },
    });
    console.log(`Tester ${email} is in ${group.attributes?.name || groupName}.`);
  } catch (err) {
    const detail = String(err.message || "");
    if (err.status === 409 || /already/i.test(detail)) {
      console.log(`Tester ${email} already in group.`);
      return tester;
    }
    throw err;
  }
  return tester;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function marketingVersion() {
  const fromEnv = process.env.ASC_MARKETING_VERSION?.trim();
  if (fromEnv) return fromEnv;
  const text = readFileSync(
    new URL("../swift/Config/Shared.xcconfig", import.meta.url),
    "utf8"
  );
  const match = text.match(/^MARKETING_VERSION\s*=\s*(\S+)/m);
  if (!match) {
    throw new Error("MARKETING_VERSION not found in swift/Config/Shared.xcconfig");
  }
  return match[1];
}

function whatsNewText() {
  return (
    process.env.ASC_WHATS_NEW?.trim() ||
    "Report formatting polish for Grok as the primary research model."
  );
}

function waitValidMinutes() {
  const raw = process.env.ASC_WAIT_VALID_MINUTES?.trim() || "40";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("ASC_WAIT_VALID_MINUTES must be a positive number");
  }
  return n;
}

function includedById(payload, type, id) {
  if (!id) return null;
  return (payload.included || []).find((item) => item.type === type && item.id === id) ?? null;
}

async function listIosVersions(appId) {
  const q = new URLSearchParams({
    "filter[platform]": "IOS",
    limit: "20",
  });
  const data = await asc(`/v1/apps/${appId}/appStoreVersions?${q}`);
  return data.data || [];
}

async function listReviewSubmissions(appId) {
  const q = new URLSearchParams({
    "filter[app]": appId,
    "filter[platform]": "IOS",
    limit: "20",
  });
  const data = await asc(`/v1/reviewSubmissions?${q}`);
  return data.data || [];
}

const OPEN_REVIEW_STATES = new Set([
  "READY_FOR_REVIEW",
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "UNRESOLVED_ISSUES",
]);

const EDITABLE_VERSION_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

async function retractOpenReviews(appId) {
  const open = (await listReviewSubmissions(appId)).filter((sub) =>
    OPEN_REVIEW_STATES.has(sub.attributes?.state)
  );
  if (!open.length) {
    console.log("No in-flight iOS review submission to retract.");
    return;
  }

  for (const sub of open) {
    const state = sub.attributes?.state;
    console.log(`Retracting review submission ${sub.id} (${state})…`);
    await asc(`/v1/reviewSubmissions/${sub.id}`, {
      method: "PATCH",
      body: {
        data: {
          type: "reviewSubmissions",
          id: sub.id,
          attributes: { canceled: true },
        },
      },
    });
  }

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const still = (await listReviewSubmissions(appId)).filter((sub) =>
      OPEN_REVIEW_STATES.has(sub.attributes?.state)
    );
    if (!still.length) {
      console.log("In-flight review retracted.");
      return;
    }
    console.log(
      `Waiting for retract (${still.map((s) => s.attributes?.state).join(", ")})…`
    );
    await sleep(15_000);
  }
  throw new Error("Timed out waiting for in-flight review retract to finish.");
}

async function waitForValidBuild(appId, { versionString, buildNumber }) {
  const minutes = waitValidMinutes();
  const deadline = Date.now() + minutes * 60 * 1000;
  let lastNote = "";

  while (Date.now() < deadline) {
    const q = new URLSearchParams({
      "filter[app]": appId,
      include: "preReleaseVersion",
      sort: "-uploadedDate",
      limit: "20",
    });
    if (buildNumber) q.set("filter[version]", buildNumber);
    const payload = await asc(`/v1/builds?${q}`);
    const builds = payload.data || [];

    for (const build of builds) {
      const preRel = includedById(
        payload,
        "preReleaseVersions",
        build.relationships?.preReleaseVersion?.data?.id
      );
      const marketing = preRel?.attributes?.version;
      if (marketing && marketing !== versionString) continue;

      const state = build.attributes?.processingState;
      const expired = build.attributes?.expired;
      const note = `build ${build.attributes?.version} / ${marketing || "?"} → ${state}${expired ? " (expired)" : ""}`;
      if (note !== lastNote) {
        console.log(note);
        lastNote = note;
      }

      if (expired) continue;
      if (state === "INVALID" || state === "FAILED") {
        throw new Error(`Dist build ${build.attributes?.version} is ${state}.`);
      }
      if (state === "VALID") {
        return { build, marketing: marketing || versionString };
      }
    }

    if (!builds.length) {
      const waiting = buildNumber
        ? `Waiting for Dist build ${buildNumber} to appear in ASC…`
        : `Waiting for a ${versionString} Dist build to appear in ASC…`;
      if (waiting !== lastNote) {
        console.log(waiting);
        lastNote = waiting;
      }
    }

    await sleep(30_000);
  }

  throw new Error(
    `Timed out after ${minutes}m waiting for VALID Dist build` +
      (buildNumber ? ` ${buildNumber}` : "") +
      ` on marketing ${versionString}.`
  );
}

async function ensureAppStoreVersion(appId, versionString) {
  const versions = await listIosVersions(appId);
  const exact = versions.find((v) => v.attributes?.versionString === versionString);
  if (exact) {
    const state = exact.attributes?.appStoreState;
    console.log(`App Store version ${versionString} exists (${state}).`);
    return exact;
  }

  const editable = versions.find((v) =>
    EDITABLE_VERSION_STATES.has(v.attributes?.appStoreState)
  );
  if (editable) {
    const from = editable.attributes?.versionString;
    console.log(
      `Retargeting editable version ${from} (${editable.attributes?.appStoreState}) → ${versionString}…`
    );
    const patched = await asc(`/v1/appStoreVersions/${editable.id}`, {
      method: "PATCH",
      body: {
        data: {
          type: "appStoreVersions",
          id: editable.id,
          attributes: { versionString },
        },
      },
    });
    return patched.data;
  }

  const donor = versions.find((v) => v.attributes?.copyright);
  const created = await asc("/v1/appStoreVersions", {
    method: "POST",
    body: {
      data: {
        type: "appStoreVersions",
        attributes: {
          platform: "IOS",
          versionString,
          ...(donor?.attributes?.copyright
            ? { copyright: donor.attributes.copyright }
            : {}),
        },
        relationships: {
          app: { data: { type: "apps", id: appId } },
        },
      },
    },
  });
  console.log(`Created App Store version ${versionString} (${created.data.id}).`);
  return created.data;
}

async function attachBuild(versionId, buildId) {
  await asc(`/v1/appStoreVersions/${versionId}/relationships/build`, {
    method: "PATCH",
    body: {
      data: { type: "builds", id: buildId },
    },
  });
  console.log(`Attached Dist build ${buildId} to version ${versionId}.`);
}

async function markEncryptionExempt(buildId) {
  try {
    await asc(`/v1/builds/${buildId}`, {
      method: "PATCH",
      body: {
        data: {
          type: "builds",
          id: buildId,
          attributes: { usesNonExemptEncryption: false },
        },
      },
    });
    console.log("Export compliance: usesNonExemptEncryption=false.");
  } catch (err) {
    const detail = String(err.message || "");
    if (err.status === 409 || /already/i.test(detail)) {
      console.log("Export compliance already set.");
      return;
    }
    throw err;
  }
}

async function setWhatsNew(versionId, text) {
  const locs = await asc(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`);
  const rows = locs.data || [];
  if (!rows.length) {
    throw new Error("No App Store version localizations to set What’s New on.");
  }
  for (const loc of rows) {
    await asc(`/v1/appStoreVersionLocalizations/${loc.id}`, {
      method: "PATCH",
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          id: loc.id,
          attributes: { whatsNew: text },
        },
      },
    });
    console.log(`What’s New set for ${loc.attributes?.locale || loc.id}.`);
  }
}

async function submitVersionForReview(appId, versionId) {
  let submission;
  try {
    const created = await asc("/v1/reviewSubmissions", {
      method: "POST",
      body: {
        data: {
          type: "reviewSubmissions",
          attributes: { platform: "IOS" },
          relationships: {
            app: { data: { type: "apps", id: appId } },
          },
        },
      },
    });
    submission = created.data;
    console.log(`Created review submission ${submission.id}.`);
  } catch (err) {
    if (err.status !== 409) throw err;
    const existing = (await listReviewSubmissions(appId)).find((sub) =>
      OPEN_REVIEW_STATES.has(sub.attributes?.state)
    );
    if (!existing) throw err;
    submission = existing;
    console.log(
      `Reusing open review submission ${submission.id} (${submission.attributes?.state}).`
    );
  }

  try {
    await asc("/v1/reviewSubmissionItems", {
      method: "POST",
      body: {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: {
              data: { type: "reviewSubmissions", id: submission.id },
            },
            appStoreVersion: {
              data: { type: "appStoreVersions", id: versionId },
            },
          },
        },
      },
    });
    console.log(`Added version ${versionId} to review submission.`);
  } catch (err) {
    const detail = String(err.message || "");
    if (err.status !== 409 && !/already/i.test(detail)) throw err;
    console.log("Version already on the review submission.");
  }

  const submitted = await asc(`/v1/reviewSubmissions/${submission.id}`, {
    method: "PATCH",
    body: {
      data: {
        type: "reviewSubmissions",
        id: submission.id,
        attributes: { submitted: true },
      },
    },
  });
  const state = submitted.data?.attributes?.state || "submitted";
  console.log(`App Store review state: ${state} (submission ${submission.id}).`);
  return submitted.data;
}

async function printStatus() {
  const bundleId = process.env.ASC_BUNDLE_ID || "info.zenbuy.app";
  const app = await findApp(bundleId);
  if (!app) {
    console.error(`::error::No ASC app for ${bundleId}.`);
    process.exit(1);
  }
  console.log(`ASC app ${app.id} (${bundleId})`);

  const versions = await listIosVersions(app.id);
  for (const v of versions.slice(0, 8)) {
    console.log(
      `  version ${v.attributes?.versionString} → ${v.attributes?.appStoreState}`
    );
  }

  const q = new URLSearchParams({
    "filter[app]": app.id,
    include: "preReleaseVersion",
    sort: "-uploadedDate",
    limit: "8",
  });
  const payload = await asc(`/v1/builds?${q}`);
  for (const build of payload.data || []) {
    const preRel = includedById(
      payload,
      "preReleaseVersions",
      build.relationships?.preReleaseVersion?.data?.id
    );
    console.log(
      `  build ${build.attributes?.version} / ${preRel?.attributes?.version || "?"} → ${build.attributes?.processingState}`
    );
  }

  const subs = await listReviewSubmissions(app.id);
  if (!subs.length) {
    console.log("  review submissions: none listed");
    return;
  }
  for (const sub of subs.slice(0, 8)) {
    console.log(`  review ${sub.id} → ${sub.attributes?.state}`);
  }
}

async function submitReview() {
  const bundleId = process.env.ASC_BUNDLE_ID || "info.zenbuy.app";
  const versionString = marketingVersion();
  const buildNumber = process.env.IOS_BUILD_NUMBER?.trim() || "";
  const notes = whatsNewText();

  const app = await findApp(bundleId);
  if (!app) {
    console.error(`::error::No ASC app for ${bundleId}.`);
    process.exit(1);
  }

  console.log(
    `Submit review for ${bundleId} marketing ${versionString}` +
      (buildNumber ? ` Dist build ${buildNumber}` : " (latest VALID Dist)") +
      "."
  );

  const { build, marketing } = await waitForValidBuild(app.id, {
    versionString,
    buildNumber,
  });
  console.log(
    `VALID Dist build ${build.attributes?.version} on train ${marketing} (${build.id}).`
  );

  await retractOpenReviews(app.id);
  const version = await ensureAppStoreVersion(app.id, versionString);
  const state = version.attributes?.appStoreState;
  if (!EDITABLE_VERSION_STATES.has(state) && state !== "PREPARE_FOR_SUBMISSION") {
    if (state === "WAITING_FOR_REVIEW" || state === "IN_REVIEW") {
      await retractOpenReviews(app.id);
    } else if (
      state === "PENDING_DEVELOPER_RELEASE" ||
      state === "READY_FOR_SALE" ||
      state === "PROCESSING_FOR_APP_STORE"
    ) {
      throw new Error(
        `Version ${versionString} is already ${state}; not attaching a new review.`
      );
    }
  }

  await attachBuild(version.id, build.id);
  await markEncryptionExempt(build.id);
  await setWhatsNew(version.id, notes);
  await submitVersionForReview(app.id, version.id);
}

const cmd = process.argv[2];
try {
  if (cmd === "ensure-app") {
    await ensureApp();
  } else if (cmd === "invite-tester") {
    await inviteTester();
  } else if (cmd === "status") {
    await printStatus();
  } else if (cmd === "submit-review") {
    await submitReview();
  } else {
    console.error(
      "Usage: node tools/asc-ios.mjs <ensure-app|invite-tester|status|submit-review>"
    );
    process.exit(2);
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
