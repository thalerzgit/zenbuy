#!/usr/bin/env node
/**
 * App Store Connect helper for ZenBuy iOS (TestFlight).
 * Uses ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY — never prints key material.
 *
 * Commands:
 *   ensure-app      Create bundle ID + ASC app if missing
 *   invite-tester   Internal TestFlight group + email invite
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

async function ensureApp() {
  const bundleId = process.env.ASC_BUNDLE_ID || "info.zenbuy.app";
  const name = process.env.ASC_APP_NAME || "ZenBuy";
  const sku = process.env.ASC_SKU || "zenbuy-ios-001";

  let app = await findApp(bundleId);
  if (app) {
    console.log(`ASC app exists: ${app.id} (${bundleId})`);
    return app;
  }

  let bundle = await findBundleId(bundleId);
  if (!bundle) {
    console.log(`Registering bundle ID ${bundleId}…`);
    const created = await asc("/v1/bundleIds", {
      method: "POST",
      body: {
        data: {
          type: "bundleIds",
          attributes: {
            identifier: bundleId,
            name,
            platform: "IOS",
          },
        },
      },
    });
    bundle = created.data;
    console.log(`Created bundle ID ${bundle.id}`);
  } else {
    console.log(`Bundle ID already registered: ${bundle.id}`);
  }

  console.log(`Creating ASC app ${name} / ${bundleId}…`);
  try {
    const createdApp = await asc("/v1/apps", {
      method: "POST",
      body: {
        data: {
          type: "apps",
          attributes: {
            bundleId,
            name,
            primaryLocale: "en-US",
            sku,
          },
        },
      },
    });
    app = createdApp.data;
    console.log(`Created ASC app ${app.id}`);
    return app;
  } catch (err) {
    if (err.status === 403 || /does not allow 'CREATE'/i.test(String(err.message))) {
      console.error(`::error::ASC API key cannot CREATE apps (bundle ${bundleId} is registered).`);
      console.error(
        "BLOCKER: Create the iOS app once in App Store Connect UI — name ZenBuy, bundle info.zenbuy.app, SKU zenbuy-ios-001 — or elevate the ASC API key role to Admin/App Manager so CREATE is allowed."
      );
      console.error(
        "Then re-run Actions → TestFlight. Secrets are present; only the ASC app record is missing."
      );
    }
    throw err;
  }
}

async function findOrCreateInternalGroup(appId, groupName) {
  const q = new URLSearchParams({
    "filter[name]": groupName,
    limit: "10",
  });
  const existing = await asc(`/v1/apps/${appId}/betaGroups?${q}`);
  const match = (existing.data || []).find(
    (g) => g.attributes?.name === groupName
  );
  if (match) {
    console.log(`Beta group exists: ${match.id} (${groupName})`);
    return match;
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
    throw new Error(
      `No ASC app for ${bundleId}. Run ensure-app first (or wait for create).`
    );
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

  console.log(`Adding existing tester ${tester.id} to ${groupName}…`);
  try {
    await asc(`/v1/betaGroups/${group.id}/relationships/betaTesters`, {
      method: "POST",
      body: {
        data: [{ type: "betaTesters", id: tester.id }],
      },
    });
    console.log(`Tester ${email} is in ${groupName}.`);
  } catch (err) {
    const detail = String(err.message || "");
    if (err.status === 409 || /already/i.test(detail)) {
      console.log(`Tester ${email} already in ${groupName}.`);
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
