/**
 * Quiet TestFlight membership + Dist build assign for Dist CI.
 *
 * POST betaTesters / group membership only when the email is missing from
 * the target group. Existing members → one-line skip (no invite email).
 * Always ensure the latest Dist build is assigned to the group.
 */
const API = "https://api.appstoreconnect.apple.com";

export function normalizeTesterEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function groupHasTesterEmail(testers, email) {
  const want = normalizeTesterEmail(email);
  if (!want) return false;
  return (testers || []).some(
    (t) => normalizeTesterEmail(t.attributes?.email) === want
  );
}

export function quietSkipLog(email, groupName) {
  return `Quiet skip: ${normalizeTesterEmail(email)} already in ${groupName}.`;
}

export function toAscPath(urlOrPath) {
  if (!urlOrPath) return null;
  const raw = String(urlOrPath);
  if (raw.startsWith(API)) return raw.slice(API.length);
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const u = new URL(raw);
    return `${u.pathname}${u.search}`;
  }
  return raw;
}

export async function listGroupTesters(asc, groupId) {
  const testers = [];
  let path = `/v1/betaGroups/${groupId}/betaTesters?${new URLSearchParams({
    limit: "200",
  })}`;
  while (path) {
    const payload = await asc(path);
    testers.push(...(payload.data || []));
    path = toAscPath(payload.links?.next);
  }
  return testers;
}

export function pickLatestDistBuild(payload, platform) {
  for (const build of payload.data || []) {
    const preId = build.relationships?.preReleaseVersion?.data?.id;
    const preRel = (payload.included || []).find(
      (item) => item.type === "preReleaseVersions" && item.id === preId
    );
    const plat = preRel?.attributes?.platform;
    if (platform && plat && plat !== platform) continue;
    if (build.attributes?.expired) continue;
    return { build, marketing: preRel?.attributes?.version, platform: plat };
  }
  return null;
}

export async function assignLatestDistBuild(asc, { appId, group, platform }) {
  const groupName = group.attributes?.name || group.id;
  const auto = Boolean(group.attributes?.hasAccessToAllBuilds);

  const q = new URLSearchParams({
    "filter[app]": appId,
    include: "preReleaseVersion",
    sort: "-uploadedDate",
    limit: "20",
  });
  const payload = await asc(`/v1/builds?${q}`);
  const picked = pickLatestDistBuild(payload, platform);

  if (auto) {
    if (picked) {
      console.log(
        `Build assign: ${groupName} hasAccessToAllBuilds — Dist ${picked.build.attributes?.version} is auto-available.`
      );
    } else {
      console.log(
        `Build assign: ${groupName} hasAccessToAllBuilds — new Dist builds attach automatically.`
      );
    }
    return { assigned: "auto", build: picked?.build ?? null };
  }

  if (!picked) {
    console.log(`Build assign: no Dist build found yet for ${groupName}.`);
    return { assigned: false, build: null };
  }

  try {
    await asc(`/v1/betaGroups/${group.id}/relationships/builds`, {
      method: "POST",
      body: { data: [{ type: "builds", id: picked.build.id }] },
    });
    console.log(
      `Assigned Dist build ${picked.build.attributes?.version} (${picked.build.id}) to ${groupName}.`
    );
    return { assigned: true, build: picked.build };
  } catch (err) {
    const detail = String(err.message || "");
    if (err.status === 409 || /already/i.test(detail)) {
      console.log(
        `Dist build ${picked.build.attributes?.version} already assigned to ${groupName}.`
      );
      return { assigned: "already", build: picked.build };
    }
    throw err;
  }
}

export async function ensureQuietTester(asc, { email, group, groupName, findTester }) {
  const want = normalizeTesterEmail(email);
  const label = group.attributes?.name || groupName;
  const members = await listGroupTesters(asc, group.id);
  if (groupHasTesterEmail(members, want)) {
    console.log(quietSkipLog(want, label));
    return {
      skipped: true,
      invited: false,
      tester: members.find((t) => normalizeTesterEmail(t.attributes?.email) === want),
    };
  }

  let tester = await findTester(want);

  if (!tester) {
    console.log(`Creating beta tester ${want}…`);
    try {
      const created = await asc("/v1/betaTesters", {
        method: "POST",
        body: {
          data: {
            type: "betaTesters",
            attributes: {
              email: want,
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
      console.log(`Created tester ${tester.id} and added to ${label}`);
      return { skipped: false, invited: true, tester };
    } catch (err) {
      if (err.status !== 409) throw err;
      tester = await findTester(want);
      if (!tester) throw err;
      const again = await listGroupTesters(asc, group.id);
      if (groupHasTesterEmail(again, want)) {
        console.log(quietSkipLog(want, label));
        return { skipped: true, invited: false, tester };
      }
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
    console.log(`Tester ${want} is in ${label}.`);
  } catch (err) {
    const detail = String(err.message || "");
    if (err.status === 409 || /already/i.test(detail)) {
      console.log(quietSkipLog(want, label));
      return { skipped: true, invited: false, tester };
    }
    throw err;
  }
  return { skipped: false, invited: true, tester };
}
