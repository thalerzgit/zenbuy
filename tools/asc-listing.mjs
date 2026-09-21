/**
 * Shared App Store listing prep for Dist review submit.
 * Fills required localization / privacy fields and the first Apple TV screenshot
 * so submit-review can attach a VALID Dist build without a browser ASC pass.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SUPPORT_URL = "https://zenbuy.info/support";
export const MARKETING_URL = "https://zenbuy.info";
export const PRIVACY_URL = "https://zenbuy.info/privacy";
export const COPYRIGHT = "2026 ZenBuy";
export const KEYWORDS = "stocks,research,investing,equity,finance,reports";

export const DESCRIPTION = `ZenBuy is calm equity research on your TV. Know before you trade.

Pick a goal, choose a profit window, and read a plain-English report. Search tickers, compare a handful of names, and email the finished PDF to yourself with the Siri Remote.

ZenBuy is a research tool — not a broker, bank, or registered investment advisor. We do not open accounts, hold money, or place trades. There are no passwords and no personal research history.

One App Store purchase unlocks the full daily allowance. Email PDF sends the report you just ran to the address you type.`;

/** App Store privacyPolicyText — condensed live policy at /privacy. Keep under 4000. */
export const PRIVACY_POLICY_TEXT = `ZenBuy (zenbuy.info and the ZenBuy apps) is a research tool. We help you read equity research before you decide anything. We are not a broker, bank, or registered investment advisor. We do not open accounts, hold money, or place trades.

There are no passwords, no email sign-ups, and no personal profiles. We do not keep a personal research history. We do not run an ads or product-analytics suite. We do not sell personal information.

A research request is processed in the moment. What remains is short-lived operational data in Cloudflare KV that expires automatically: a shared result cache (about 1 hour), free-allowance counters (about one week), a prefetch budget (within 24 hours), optional share snapshots (up to 24 hours), and a launch pass (about 3 minutes). Device preferences stay on your device.

Free reports are capped per visitor per rolling week. To recognise the same visitor without an account we keep three abuse-prevention identifiers: a first-party zb_vid cookie, a one-way device-signal hash (not the raw properties), and a coarsened network block. We do not use this for advertising, profiling, or resale. Keys expire about a week after your last report.

Unlocking is optional. If you sign in with Apple, Apple sends an opaque subject identifier. We store your unlock record and a 90-day session. Payment details stay with Apple. Unlink deletes the session; you can ask us to delete the unlock record via https://zenbuy.info/support.

Traffic uses TLS. Helpers: Cloudflare (hosting and Turnstile), Finnhub (market data), xAI / Anthropic (one-off reports), and Apple (only if you unlock).

ZenBuy is not directed at children under 13 (or under 16 in the EEA). Full policy: https://zenbuy.info/privacy (updated September 11, 2026).`;

export const TV_SCREENSHOT_PATH = fileURLToPath(
  new URL("./store/tvos-APP_APPLE_TV-1920x1080.png", import.meta.url)
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function missingAttr(value) {
  return !String(value || "").trim();
}

export function formatAssociatedErrors(err) {
  const assoc = err?.body?.errors?.flatMap((e) => {
    const rows = e.meta?.associatedErrors
      ? Object.entries(e.meta.associatedErrors).flatMap(([path, list]) =>
          (list || []).map(
            (item) =>
              `${path} ${item.code || ""} ${item.detail || item.title || ""}`.trim()
          )
        )
      : [];
    return rows.length ? rows : [e.detail || e.title || ""];
  });
  return (assoc || []).filter(Boolean).join(" | ").slice(0, 4000);
}

export async function fillAppPrivacy(asc, appId) {
  const infos = await asc(`/v1/apps/${appId}/appInfos?${new URLSearchParams({ limit: "10" })}`);
  const rows = infos.data || [];
  if (!rows.length) {
    console.log("No appInfos to set privacyPolicyText on.");
    return;
  }

  const preferred = rows.filter((info) =>
    ["PREPARE_FOR_SUBMISSION", "READY_FOR_SALE", "WAITING_FOR_REVIEW", "DEVELOPER_REJECTED"].includes(
      info.attributes?.appStoreState
    )
  );
  const targets = preferred.length ? preferred : rows;

  for (const info of targets) {
    const locs = await asc(`/v1/appInfos/${info.id}/appInfoLocalizations`);
    for (const loc of locs.data || []) {
      const attrs = loc.attributes || {};
      const patch = {};
      if (missingAttr(attrs.privacyPolicyText)) patch.privacyPolicyText = PRIVACY_POLICY_TEXT;
      if (missingAttr(attrs.privacyPolicyUrl)) patch.privacyPolicyUrl = PRIVACY_URL;
      if (!Object.keys(patch).length) {
        console.log(
          `App privacy already set for ${attrs.locale || loc.id} (${info.attributes?.appStoreState}).`
        );
        continue;
      }
      await asc(`/v1/appInfoLocalizations/${loc.id}`, {
        method: "PATCH",
        body: {
          data: {
            type: "appInfoLocalizations",
            id: loc.id,
            attributes: patch,
          },
        },
      });
      console.log(
        `Set ${Object.keys(patch).join(", ")} on appInfo ${attrs.locale || loc.id} (${info.attributes?.appStoreState}).`
      );
    }
  }
}

export async function ensureVersionCopyright(asc, version) {
  if (!missingAttr(version.attributes?.copyright)) return version;
  const patched = await asc(`/v1/appStoreVersions/${version.id}`, {
    method: "PATCH",
    body: {
      data: {
        type: "appStoreVersions",
        id: version.id,
        attributes: { copyright: COPYRIGHT },
      },
    },
  });
  console.log(`Set copyright on version ${version.id}.`);
  return patched.data || version;
}

async function copyFromIosLocalization(asc, appId) {
  const q = new URLSearchParams({ "filter[platform]": "IOS", limit: "20" });
  const versions = (await asc(`/v1/apps/${appId}/appStoreVersions?${q}`)).data || [];
  const ranked = [...versions].sort((a, b) => {
    const rank = (state) =>
      ({
        READY_FOR_SALE: 0,
        PENDING_DEVELOPER_RELEASE: 1,
        WAITING_FOR_REVIEW: 2,
        IN_REVIEW: 3,
        PREPARE_FOR_SUBMISSION: 4,
      })[state] ?? 9;
    return rank(a.attributes?.appStoreState) - rank(b.attributes?.appStoreState);
  });
  for (const version of ranked) {
    const locs = await asc(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
    const en = (locs.data || []).find((loc) => loc.attributes?.locale === "en-US") || locs.data?.[0];
    if (en && !missingAttr(en.attributes?.description)) {
      return en.attributes;
    }
  }
  return null;
}

export async function fillVersionLocalization(asc, appId, versionId, { tvCopy = false } = {}) {
  let locs = (await asc(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`)).data || [];
  const donor = await copyFromIosLocalization(asc, appId);
  const description = tvCopy
    ? DESCRIPTION
    : donor?.description || DESCRIPTION;
  const keywords = donor?.keywords || KEYWORDS;
  const supportUrl = donor?.supportUrl || SUPPORT_URL;
  const marketingUrl = donor?.marketingUrl || MARKETING_URL;

  if (!locs.length) {
    const created = await asc("/v1/appStoreVersionLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: {
            locale: "en-US",
            description,
            keywords,
            supportUrl,
            marketingUrl,
          },
          relationships: {
            appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
          },
        },
      },
    });
    console.log(`Created en-US version localization ${created.data.id}.`);
    return [created.data];
  }

  for (const loc of locs) {
    const attrs = loc.attributes || {};
    const patch = {};
    if (missingAttr(attrs.description)) patch.description = description;
    if (missingAttr(attrs.keywords)) patch.keywords = keywords;
    if (missingAttr(attrs.supportUrl)) patch.supportUrl = supportUrl;
    if (missingAttr(attrs.marketingUrl)) patch.marketingUrl = marketingUrl;
    if (!Object.keys(patch).length) {
      console.log(`Version localization ${attrs.locale || loc.id} already has required fields.`);
      continue;
    }
    await asc(`/v1/appStoreVersionLocalizations/${loc.id}`, {
      method: "PATCH",
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          id: loc.id,
          attributes: patch,
        },
      },
    });
    console.log(
      `Set ${Object.keys(patch).join(", ")} on version localization ${attrs.locale || loc.id}.`
    );
  }
  return locs;
}

async function uploadParts(fileBuffer, operations) {
  for (const op of operations || []) {
    const start = Number(op.offset) || 0;
    const length = Number(op.length) || fileBuffer.length;
    const chunk = fileBuffer.subarray(start, start + length);
    const headers = {};
    for (const header of op.requestHeaders || []) {
      headers[header.name] = header.value;
    }
    const res = await fetch(op.url, {
      method: op.method || "PUT",
      headers,
      body: chunk,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Screenshot upload ${res.status}: ${text.slice(0, 300)}`);
    }
  }
}

async function waitScreenshotComplete(asc, screenshotId) {
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const row = await asc(
      `/v1/appScreenshots/${screenshotId}?${new URLSearchParams({
        "fields[appScreenshots]": "assetDeliveryState,imageAsset,sourceFileChecksum",
      })}`
    );
    const state = row.data?.attributes?.assetDeliveryState?.state;
    if (state === "COMPLETE") {
      console.log(`Apple TV screenshot ${screenshotId} COMPLETE.`);
      return;
    }
    if (state === "FAILED") {
      throw new Error(`Apple TV screenshot ${screenshotId} failed processing.`);
    }
    console.log(`Waiting for Apple TV screenshot (${state || "unknown"})…`);
    await sleep(8_000);
  }
  throw new Error(`Timed out waiting for Apple TV screenshot ${screenshotId}.`);
}

export async function uploadAppleTvScreenshot(asc, versionId) {
  const locs =
    (await asc(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`)).data || [];
  const loc =
    locs.find((row) => row.attributes?.locale === "en-US") || locs[0];
  if (!loc) {
    throw new Error("No tvOS localization to attach an APP_APPLE_TV screenshot to.");
  }

  let sets =
    (await asc(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data || [];
  let set = sets.find((row) => row.attributes?.screenshotDisplayType === "APP_APPLE_TV");
  if (!set) {
    try {
      const created = await asc("/v1/appScreenshotSets", {
        method: "POST",
        body: {
          data: {
            type: "appScreenshotSets",
            attributes: { screenshotDisplayType: "APP_APPLE_TV" },
            relationships: {
              appStoreVersionLocalization: {
                data: { type: "appStoreVersionLocalizations", id: loc.id },
              },
            },
          },
        },
      });
      set = created.data;
      console.log(`Created APP_APPLE_TV screenshot set ${set.id}.`);
    } catch (err) {
      if (err.status !== 409) throw err;
      sets =
        (await asc(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data || [];
      set = sets.find((row) => row.attributes?.screenshotDisplayType === "APP_APPLE_TV");
      if (!set) throw err;
    }
  }

  const existing = await asc(`/v1/appScreenshotSets/${set.id}/appScreenshots`);
  const complete = (existing.data || []).find(
    (shot) => shot.attributes?.assetDeliveryState?.state === "COMPLETE"
  );
  if (complete) {
    console.log(`APP_APPLE_TV screenshot already COMPLETE (${complete.id}).`);
    return complete;
  }

  const fileBuffer = readFileSync(TV_SCREENSHOT_PATH);
  const checksum = createHash("md5").update(fileBuffer).digest("hex");
  const reserved = await asc("/v1/appScreenshots", {
    method: "POST",
    body: {
      data: {
        type: "appScreenshots",
        attributes: {
          fileName: "tvos-APP_APPLE_TV-1920x1080.png",
          fileSize: fileBuffer.length,
        },
        relationships: {
          appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } },
        },
      },
    },
  });
  const screenshot = reserved.data;
  console.log(`Reserved Apple TV screenshot ${screenshot.id} (${fileBuffer.length} bytes).`);
  await uploadParts(fileBuffer, screenshot.attributes?.uploadOperations || []);
  await asc(`/v1/appScreenshots/${screenshot.id}`, {
    method: "PATCH",
    body: {
      data: {
        type: "appScreenshots",
        id: screenshot.id,
        attributes: {
          uploaded: true,
          sourceFileChecksum: checksum,
        },
      },
    },
  });
  await waitScreenshotComplete(asc, screenshot.id);
  return screenshot;
}
