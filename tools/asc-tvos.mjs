#!/usr/bin/env node
/**
 * App Store Connect helper for ZenBuy tvOS (TestFlight only — no review submit).
 * Uses ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY — never prints key material.
 *
 * Commands:
 *   ensure-app      READ-ONLY: app exists AND Apple TV / TV_OS platform is present
 *   invite-tester   Internal TestFlight group + email (list groups client-side)
 *   status          Latest TV_OS versions + Dist builds
 *   wait-valid      Wait until the stamped Dist build is VALID
 *
 * Never CREATE Bundle IDs or apps via API. Justin does that in ASC UI.
 * Internal TestFlight is enough — this tool does not submit App Store review.
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

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
      json?.errors?.map((e) => e.detail || e.title).join("; ") ||
      text.slice(0, 400);
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
  } else {
    console.error(
      "Usage: node tools/asc-tvos.mjs <ensure-app|invite-tester|status|wait-valid>"
    );
    process.exit(2);
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
