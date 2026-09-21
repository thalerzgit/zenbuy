#!/usr/bin/env node
/**
 * App Store Connect helper for ZenBuy tvOS (TestFlight + review submit).
 * Uses ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY — never prints key material.
 *
 * Commands:
 *   ensure-app      READ-ONLY: app exists AND Apple TV / TV_OS platform is present
 *   invite-tester   Quiet ensure: assign Dist tvOS build; invite only if email is missing from the group
 *   status          Latest TV_OS versions + Dist builds
 *   wait-valid      Wait until the stamped Dist build is VALID
 *   submit-review   Wait VALID, retract in-flight TV review, submit latest Dist build
 *
 * Never CREATE Bundle IDs or apps via API. Create those in Apple Developer / App Store Connect UI.
 * submit-review is ASC REST only (no signing, no Dev certs).
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import {
  attachBuild,
  EDITABLE_VERSION_STATES,
  ensureVersionCopyright,
  fillAppPrivacy,
  fillVersionLocalization,
  formatAssociatedErrors,
  uploadAppleTvScreenshot,
  waitForEditableVersion,
} from "./asc-listing.mjs";
import { assignLatestDistBuild, ensureQuietTester } from "./asc-tf-invite.mjs";

const API = "https://api.appstoreconnect.apple.com";
const DEFAULT_BUNDLE = "info.zenbuy.app";

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
      json?.errors
        ?.map((e) => {
          const assoc = e.meta?.associatedErrors
            ? ` associated=${JSON.stringify(e.meta.associatedErrors).slice(0, 4000)}`
            : "";
          return `${e.detail || e.title}${assoc}`;
        })
        .join("; ") || text.slice(0, 400);
    const err = new Error(`ASC ${method} ${path} → ${res.status}: ${detail}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function printAscUiBlocker(bundleId, { hasApp, hasBundle }) {
  console.error(`::error::Apple TV / tvOS App Store Connect record is missing for ${bundleId}.`);
  console.error("Do NOT create the app or Bundle ID via API (Admin key cannot CREATE apps).");
  console.error("");
  console.error("Preferred (same product as iPhone): add the Apple TV platform");
  console.error("  1. App Store Connect → My Apps → ZenBuy (bundle info.zenbuy.app)");
  console.error("  2. Next to Platforms, click + → Apple TV");
  console.error("  3. Version 1.4 (match Config/Shared.xcconfig MARKETING_VERSION)");
  console.error("");
  if (!hasApp && !hasBundle) {
    console.error("If ZenBuy is not in My Apps yet:");
    console.error("  • Developer → Identifiers → App IDs → info.zenbuy.app (enable tvOS if asked)");
    console.error("  • App Store Connect → My Apps → New App → Apple TV");
    console.error("    name ZenBuy, bundle info.zenbuy.app, SKU zenbuy-tvos-001");
  }
  console.error("");
  console.error("Then stamp a tvOS App Store profile (Developer portal, not this VM):");
  console.error("  1. Profiles → + → tvOS App Store → App ID info.zenbuy.app");
  console.error("  2. Name it exactly: CI info.zenbuy.app tvOS AppStore");
  console.error("  3. Download the .mobileprovision");
  console.error("  4. GitHub → Settings → Secrets → Actions → ASC_PROFILE_TVOS_BASE64");
  console.error("     (base64 of that file; reuse ASC_DIST_P12_* from iOS Dist)");
  console.error("");
  console.error("After the ASC UI + secret exist: Actions → TestFlight tvOS → Run workflow.");
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

async function listTvVersions(appId) {
  const q = new URLSearchParams({
    "filter[platform]": "TV_OS",
    limit: "20",
  });
  const data = await asc(`/v1/apps/${appId}/appStoreVersions?${q}`);
  return data.data || [];
}

async function hasTvOsPlatform(appId) {
  const versions = await listTvVersions(appId);
  if (versions.length) return { ok: true, via: "appStoreVersions" };

  const q = new URLSearchParams({
    "filter[app]": appId,
    include: "preReleaseVersion",
    sort: "-uploadedDate",
    limit: "20",
  });
  const payload = await asc(`/v1/builds?${q}`);
  for (const pre of payload.included || []) {
    if (pre.type === "preReleaseVersions" && pre.attributes?.platform === "TV_OS") {
      return { ok: true, via: "builds" };
    }
  }
  return { ok: false, via: null };
}

async function ensureApp() {
  const bundleId = process.env.ASC_BUNDLE_ID || DEFAULT_BUNDLE;
  const app = await findApp(bundleId);
  if (!app) {
    let hasBundle = false;
    try {
      hasBundle = Boolean(await findBundleId(bundleId));
    } catch {
      hasBundle = false;
    }
    printAscUiBlocker(bundleId, { hasApp: false, hasBundle });
    process.exit(1);
  }

  const platform = await hasTvOsPlatform(app.id);
  if (!platform.ok) {
    console.error(`ASC iOS app exists (${app.id}) but no Apple TV / TV_OS platform.`);
    printAscUiBlocker(bundleId, { hasApp: true, hasBundle: true });
    process.exit(1);
  }

  console.log(`ASC tvOS ready: app ${app.id} (${bundleId}) via ${platform.via}.`);
  return app;
}

async function findOrCreateInternalGroup(appId, groupName) {
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
  const bundleId = process.env.ASC_BUNDLE_ID || DEFAULT_BUNDLE;
  const email = (process.env.ASC_TESTER_EMAIL || "thalerz@me.com").toLowerCase();
  const groupName = process.env.ASC_GROUP_NAME || "Internal Testers";

  const app = await findApp(bundleId);
  if (!app) {
    printAscUiBlocker(bundleId, { hasApp: false, hasBundle: false });
    process.exit(1);
  }

  const group = await findOrCreateInternalGroup(app.id, groupName);
  await assignLatestDistBuild(asc, { appId: app.id, group, platform: "TV_OS" });
  return ensureQuietTester(asc, { email, group, groupName, findTester });
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

function includedById(payload, type, id) {
  if (!id) return null;
  return (payload.included || []).find((item) => item.type === type && item.id === id) ?? null;
}

function waitValidMinutes() {
  const raw = process.env.ASC_WAIT_VALID_MINUTES?.trim() || "40";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("ASC_WAIT_VALID_MINUTES must be a positive number");
  }
  return n;
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
      const platform = preRel?.attributes?.platform;
      if (platform && platform !== "TV_OS") continue;
      const marketing = preRel?.attributes?.version;
      if (marketing && marketing !== versionString) continue;

      const state = build.attributes?.processingState;
      const expired = build.attributes?.expired;
      const note = `tvOS build ${build.attributes?.version} / ${marketing || "?"} → ${state}${expired ? " (expired)" : ""}`;
      if (note !== lastNote) {
        console.log(note);
        lastNote = note;
      }
      if (expired) continue;
      if (state === "INVALID" || state === "FAILED") {
        throw new Error(`Dist tvOS build ${build.attributes?.version} is ${state}.`);
      }
      if (state === "VALID") {
        return { build, marketing: marketing || versionString };
      }
    }

    if (!builds.length) {
      const waiting = buildNumber
        ? `Waiting for Dist tvOS build ${buildNumber} to appear in ASC…`
        : `Waiting for a ${versionString} Dist tvOS build to appear in ASC…`;
      if (waiting !== lastNote) {
        console.log(waiting);
        lastNote = waiting;
      }
    }
    await sleep(30_000);
  }

  throw new Error(
    `Timed out after ${minutes}m waiting for VALID Dist tvOS build` +
      (buildNumber ? ` ${buildNumber}` : "") +
      ` on marketing ${versionString}.`
  );
}

async function printStatus() {
  const bundleId = process.env.ASC_BUNDLE_ID || DEFAULT_BUNDLE;
  const app = await findApp(bundleId);
  if (!app) {
    printAscUiBlocker(bundleId, { hasApp: false, hasBundle: false });
    process.exit(1);
  }
  console.log(`ASC app ${app.id} (${bundleId})`);

  const versions = await listTvVersions(app.id);
  if (!versions.length) {
    console.log("  TV_OS App Store versions: none");
  }
  for (const v of versions.slice(0, 8)) {
    console.log(
      `  tvOS version ${v.attributes?.versionString} → ${v.attributes?.appStoreState}`
    );
  }

  const q = new URLSearchParams({
    "filter[app]": app.id,
    include: "preReleaseVersion",
    sort: "-uploadedDate",
    limit: "12",
  });
  const payload = await asc(`/v1/builds?${q}`);
  let seen = 0;
  for (const build of payload.data || []) {
    const preRel = includedById(
      payload,
      "preReleaseVersions",
      build.relationships?.preReleaseVersion?.data?.id
    );
    if (preRel?.attributes?.platform && preRel.attributes.platform !== "TV_OS") {
      continue;
    }
    console.log(
      `  build ${build.attributes?.version} / ${preRel?.attributes?.version || "?"} (${preRel?.attributes?.platform || "?"}) → ${build.attributes?.processingState}`
    );
    seen += 1;
    if (seen >= 8) break;
  }
  if (!seen) console.log("  tvOS Dist builds: none listed");
}

async function waitValid() {
  const bundleId = process.env.ASC_BUNDLE_ID || DEFAULT_BUNDLE;
  const versionString = marketingVersion();
  const buildNumber = process.env.TVOS_BUILD_NUMBER?.trim() || "";
  const app = await findApp(bundleId);
  if (!app) {
    printAscUiBlocker(bundleId, { hasApp: false, hasBundle: false });
    process.exit(1);
  }
  const { build, marketing } = await waitForValidBuild(app.id, {
    versionString,
    buildNumber,
  });
  console.log(
    `VALID tvOS Dist build ${build.attributes?.version} on train ${marketing} (${build.id}).`
  );
}

function whatsNewText() {
  return (
    process.env.ASC_WHATS_NEW?.trim() ||
    "Email PDF now sends the address you typed on Apple TV. A valid iCloud address is no longer rejected as incomplete."
  );
}

async function listReviewSubmissions(appId) {
  const q = new URLSearchParams({
    "filter[app]": appId,
    "filter[platform]": "TV_OS",
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

async function retractOpenReviews(appId) {
  const open = (await listReviewSubmissions(appId)).filter((sub) =>
    OPEN_REVIEW_STATES.has(sub.attributes?.state)
  );
  if (!open.length) {
    console.log("No in-flight tvOS review submission to retract.");
    return;
  }

  for (const sub of open) {
    const state = sub.attributes?.state;
    console.log(`Retracting tvOS review submission ${sub.id} (${state})…`);
    try {
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
    } catch (err) {
      const detail = String(err.message || "");
      if (err.status === 409 && /cancellable|canceled/i.test(detail)) {
        console.log(
          `tvOS review ${sub.id} is not cancellable; submit will reuse it.`
        );
        continue;
      }
      throw err;
    }
  }

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const still = (await listReviewSubmissions(appId)).filter((sub) =>
      OPEN_REVIEW_STATES.has(sub.attributes?.state)
    );
    if (!still.length) {
      console.log("In-flight tvOS review retracted.");
      return;
    }
    const states = still.map((s) => s.attributes?.state).join(", ");
    if (still.every((s) => s.attributes?.state === "READY_FOR_REVIEW")) {
      console.log(`Leaving open tvOS review(s) in place for reuse (${states}).`);
      return;
    }
    console.log(`Waiting for retract (${states})…`);
    await sleep(15_000);
  }
  const leftover = (await listReviewSubmissions(appId)).filter((sub) =>
    OPEN_REVIEW_STATES.has(sub.attributes?.state)
  );
  if (leftover.length) {
    console.log("Open tvOS review still present; submit will reuse it.");
    return;
  }
  throw new Error("Timed out waiting for in-flight tvOS review retract to finish.");
}

async function ensureAppStoreVersion(appId, versionString) {
  const versions = await listTvVersions(appId);
  const exact = versions.find((v) => v.attributes?.versionString === versionString);
  if (exact) {
    const state = exact.attributes?.appStoreState;
    console.log(`tvOS App Store version ${versionString} exists (${state}).`);
    return exact;
  }

  const editable = versions.find((v) =>
    EDITABLE_VERSION_STATES.has(v.attributes?.appStoreState)
  );
  if (editable) {
    const from = editable.attributes?.versionString;
    console.log(
      `Retargeting editable tvOS version ${from} (${editable.attributes?.appStoreState}) → ${versionString}…`
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
          platform: "TV_OS",
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
  console.log(`Created tvOS App Store version ${versionString} (${created.data.id}).`);
  return created.data;
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
    console.log("No tvOS localizations yet — skipping What’s New (first version often has none).");
    return;
  }
  for (const loc of rows) {
    try {
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
    } catch (err) {
      const detail = String(err.message || "");
      // First Apple TV version has no What’s New field.
      if (err.status === 409 && /whatsNew|cannot be edited/i.test(detail)) {
        console.log(
          `What’s New not editable for ${loc.attributes?.locale || loc.id} (first tvOS version). Continuing.`
        );
        continue;
      }
      throw err;
    }
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
          attributes: { platform: "TV_OS" },
          relationships: {
            app: { data: { type: "apps", id: appId } },
          },
        },
      },
    });
    submission = created.data;
    console.log(`Created tvOS review submission ${submission.id}.`);
  } catch (err) {
    if (err.status !== 409) throw err;
    const existing = (await listReviewSubmissions(appId)).find((sub) =>
      OPEN_REVIEW_STATES.has(sub.attributes?.state)
    );
    if (!existing) throw err;
    submission = existing;
    console.log(
      `Reusing open tvOS review submission ${submission.id} (${submission.attributes?.state}).`
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
    console.log(`Added tvOS version ${versionId} to review submission.`);
  } catch (err) {
    const detail = String(err.message || "");
    if (err.status === 409 && /already/i.test(detail)) {
      console.log("tvOS version already on the review submission.");
    } else {
      if (/cannot be reviewed/i.test(detail)) {
        console.error(
          "tvOS listing is not review-ready after listing prep. Associated: " +
            formatAssociatedErrors(err)
        );
      }
      throw err;
    }
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
  console.log(`tvOS App Store review state: ${state} (submission ${submission.id}).`);
  return submitted.data;
}

async function submitReview() {
  const bundleId = process.env.ASC_BUNDLE_ID || DEFAULT_BUNDLE;
  const versionString = marketingVersion();
  const buildNumber = process.env.TVOS_BUILD_NUMBER?.trim() || "";
  const notes = whatsNewText();

  const app = await findApp(bundleId);
  if (!app) {
    printAscUiBlocker(bundleId, { hasApp: false, hasBundle: false });
    process.exit(1);
  }

  const platform = await hasTvOsPlatform(app.id);
  if (!platform.ok) {
    console.error(`ASC iOS app exists (${app.id}) but no Apple TV / TV_OS platform.`);
    printAscUiBlocker(bundleId, { hasApp: true, hasBundle: true });
    process.exit(1);
  }

  console.log(
    `Submit tvOS review for ${bundleId} marketing ${versionString}` +
      (buildNumber ? ` Dist build ${buildNumber}` : " (latest VALID Dist)") +
      "."
  );

  const { build, marketing } = await waitForValidBuild(app.id, {
    versionString,
    buildNumber,
  });
  console.log(
    `VALID tvOS Dist build ${build.attributes?.version} on train ${marketing} (${build.id}).`
  );

  await retractOpenReviews(app.id);
  let version = await ensureAppStoreVersion(app.id, versionString);
  let state = version.attributes?.appStoreState;
  if (state === "WAITING_FOR_REVIEW" || state === "IN_REVIEW") {
    await retractOpenReviews(app.id);
    version = await waitForEditableVersion(asc, version, { label: "tvOS version" });
    state = version.attributes?.appStoreState;
  } else if (
    state === "PENDING_DEVELOPER_RELEASE" ||
    state === "READY_FOR_SALE" ||
    state === "PROCESSING_FOR_APP_STORE"
  ) {
    throw new Error(
      `tvOS version ${versionString} is already ${state}; not attaching a new review.`
    );
  }
  if (!EDITABLE_VERSION_STATES.has(state)) {
    throw new Error(
      `tvOS version ${versionString} is ${state}; cannot attach Dist build ${build.attributes?.version}.`
    );
  }

  await attachBuild(asc, version.id, build.id, { label: "Dist tvOS build" });
  await markEncryptionExempt(build.id);
  version = await ensureVersionCopyright(asc, version);
  await fillAppPrivacy(asc, app.id);
  await fillVersionLocalization(asc, app.id, version.id, { tvCopy: true });
  await uploadAppleTvScreenshot(asc, version.id);
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
  } else if (cmd === "wait-valid") {
    await waitValid();
  } else if (cmd === "submit-review") {
    await submitReview();
  } else {
    console.error(
      "Usage: node tools/asc-tvos.mjs <ensure-app|invite-tester|status|wait-valid|submit-review>"
    );
    process.exit(2);
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
