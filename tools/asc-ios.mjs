#!/usr/bin/env node
/**
 * App Store Connect helper for ZenBuy iOS (TestFlight).
 * Uses ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY — never prints key material.
 *
 * Commands:
 *   ensure-app      READ-ONLY check that ASC app exists (never creates Bundle ID or app)
 *   invite-tester   Internal TestFlight group + email invite (requires app already in ASC)
 *
 * Justin creates Bundle ID + ASC app in Apple Developer / App Store Connect UI.
 * Admin ASC API key cannot CREATE apps — do not attempt API create.
 */
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

const cmd = process.argv[2];
try {
  if (cmd === "ensure-app") {
    await ensureApp();
  } else if (cmd === "invite-tester") {
    await inviteTester();
  } else {
    console.error("Usage: node tools/asc-ios.mjs <ensure-app|invite-tester>");
    process.exit(2);
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
