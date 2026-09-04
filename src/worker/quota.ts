/**
 * Report allowances.
 *
 * An unlocked buyer is counted per Apple subject, per day. A verified purchase
 * is a strong identity, so nothing else is needed there.
 *
 * A free visitor gets a rolling weekly allowance instead, and the hard part is
 * deciding *who* they are. A per-IP counter is reset by a hotspot or a VPN and
 * a cookie is reset by incognito or "clear data", so neither is trusted alone.
 * Each request presents up to three signals, and every signal we have already
 * seen resolves to a cluster id. The request is checked and charged against
 * *every* cluster it resolves to, so clearing one signal does not mint a fresh
 * allowance while another still points at the old cluster:
 *
 *   cookie        `zb_vid`, HttpOnly so only the Worker can set or read it.
 *                 Unique per browser profile and survives an IP change.
 *   device signal a hash the client computes at generate time from ordinary
 *                 browser properties (or, in the iOS app, a random Keychain
 *                 id). Catches a cleared cookie *and* a new IP together — but
 *                 stock phones produce near-identical hashes, so a hash seen
 *                 from more than `FP_GENERIC_NETS` distinct networks is
 *                 demoted to a device class and from then on only links
 *                 requests inside one network.
 *   network       /24 (IPv4) or /48 (IPv6). Never an identity on its own —
 *                 carrier NAT would put a whole city in one bucket — so it
 *                 only qualifies a device signal, or stands in as the bucket
 *                 for a client that presents no signals at all.
 *
 * Residual risk, stated honestly: someone who changes network *and* device
 * signals at the same time (a different browser on a different machine) is a
 * new free identity. Perfect detection is not available without accounts.
 *
 * Retention: every key here carries a ~1 week TTL and holds counters, hashes,
 * and random ids only. See `/privacy`.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_TTL_SECONDS = 7 * 24 * 60 * 60 + 60;
const DAY_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_FREE_WEEKLY_LIMIT = 3;
const DEFAULT_PRO_DAILY_LIMIT = 25;

/** Above this many distinct networks a device signal is a model, not a person. */
const FP_GENERIC_NETS = 6;

export const VISITOR_COOKIE = "zb_vid";
const VISITOR_COOKIE_SECONDS = 60 * 60 * 24 * 400;

/** `X-ZenBuy-Device` — the native app's Keychain id, its device signal. */
const DEVICE_HEADER = "X-ZenBuy-Device";

function freeWeeklyLimit(env: Env): number {
  return Math.max(
    1,
    Number(env.RATE_LIMIT_FREE_WEEKLY || DEFAULT_FREE_WEEKLY_LIMIT)
  );
}

function proDailyLimit(env: Env): number {
  return Math.max(1, Number(env.RATE_LIMIT_PRO_DAILY || DEFAULT_PRO_DAILY_LIMIT));
}

/** Justin's own networks, so testing does not burn the public allowance. */
function isRateLimitExempt(env: Env, ip: string): boolean {
  const raw = env.RATE_LIMIT_WHITELIST?.trim();
  if (!raw) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(ip);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function visitorCookie(request: Request, value: string): string {
  // Localhost dev is plain http, where a Secure cookie is silently dropped.
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${VISITOR_COOKIE}=${value}; Max-Age=${VISITOR_COOKIE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

/** Coarse network, so a re-dialled address inside the same block still links. */
export function networkKey(ip: string): string {
  if (ip.includes(":")) {
    return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  }
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : ip;
}

function cleanHash(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{16,64}$/.test(v) ? v.slice(0, 32) : "";
}

function cleanId(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return /^[A-Za-z0-9._-]{8,64}$/.test(v) ? v : "";
}

function clusterKey(id: string): string {
  return `fqc:${id}`;
}

function signalKey(kind: "v" | "d" | "f" | "fn" | "n", value: string): string {
  return `fq:${kind}:${value}`;
}

function breadthKey(hash: string): string {
  return `fqf:${hash}`;
}

function proKey(subject: string): string {
  return `rl:sub:${subject}:${new Date().toISOString().slice(0, 10)}`;
}

interface FreeIdentity {
  /** Cluster the request is filed under when no signal matched anything yet. */
  primary: string;
  /** Every cluster this request resolves to. Any one of them can deny it. */
  clusters: string[];
  /** Signal keys with no cluster yet; they get pointed at `primary` on use. */
  unlinked: string[];
  /** Browser device-signal hash, "" for the native app or an old client. */
  hash: string;
  net: string;
  /** Present only when a visitor cookie has to be minted. */
  setCookie?: string;
}

/**
 * Is this hash discriminating enough to link across networks, or is it just
 * "iPhone on Safari" shared by thousands of people?
 */
async function signalLinksAcrossNetworks(env: Env, hash: string): Promise<boolean> {
  const nets = await env.CACHE.get<string[]>(breadthKey(hash), "json").catch(
    () => null
  );
  return !nets || nets.length <= FP_GENERIC_NETS;
}

async function resolveFreeIdentity(
  request: Request,
  env: Env,
  ip: string,
  clientSignal: string
): Promise<FreeIdentity> {
  const net = networkKey(ip);
  // The app's Keychain id is already stable and private, so it is used
  // directly; browsers send a hash of device properties.
  const device = cleanId(request.headers.get(DEVICE_HEADER));
  const hash = cleanHash(clientSignal);

  let visitor = cleanId(readCookie(request, VISITOR_COOKIE));
  let setCookie: string | undefined;
  if (!visitor) {
    visitor = crypto.randomUUID().replace(/-/g, "");
    setCookie = visitorCookie(request, visitor);
  }

  const keys = [signalKey("v", visitor)];
  if (device) keys.push(signalKey("d", device));
  if (hash) {
    keys.push(signalKey("fn", `${hash}.${net}`));
    if (await signalLinksAcrossNetworks(env, hash)) keys.push(signalKey("f", hash));
  }
  // No cookie, no device signal: nothing but the network to go on, and a free
  // report still has to cost something.
  if (setCookie && !device && !hash) keys.push(signalKey("n", net));

  const mapped = await Promise.all(
    keys.map((key) => env.CACHE.get(key).catch(() => null))
  );
  const found = [...new Set(mapped.filter((id): id is string => Boolean(id)))];
  const primary = found[0] ?? visitor;

  return {
    primary,
    clusters: found.length ? found : [primary],
    // A mapping from the visitor id to a cluster of the same name is what
    // `primary` already falls back to, so writing it would be a wasted put.
    unlinked: keys.filter(
      (key, i) => !mapped[i] && key !== signalKey("v", primary)
    ),
    hash,
    net,
    setCookie,
  };
}

async function readCluster(env: Env, id: string): Promise<number[]> {
  const raw = await env.CACHE.get<number[]>(clusterKey(id), "json").catch(
    () => null
  );
  return Array.isArray(raw) ? raw.filter((t) => typeof t === "number") : [];
}

/**
 * Milliseconds until this identity's next free report, or 0 when one is
 * available. Rolling window: the oldest report in the cluster frees its slot
 * exactly a week after it was generated.
 */
async function freeQuotaWaitMs(
  env: Env,
  identity: FreeIdentity,
  limit: number,
  now = Date.now()
): Promise<number> {
  const clusters = await Promise.all(
    identity.clusters.map((id) => readCluster(env, id))
  );

  let opensAt = 0;
  for (const hits of clusters) {
    const live = hits.filter((t) => now - t < WEEK_MS).sort((a, b) => a - b);
    if (live.length < limit) continue;
    const frees = live[live.length - limit] + WEEK_MS;
    opensAt = opensAt ? Math.min(opensAt, frees) : frees;
  }

  return opensAt ? Math.max(60_000, opensAt - now) : 0;
}

async function rememberSignalNetwork(env: Env, hash: string, net: string): Promise<void> {
  const nets =
    (await env.CACHE.get<string[]>(breadthKey(hash), "json").catch(() => null)) ?? [];
  if (nets.includes(net)) return;
  await env.CACHE.put(
    breadthKey(hash),
    JSON.stringify([...nets, net].slice(-(FP_GENERIC_NETS + 2))),
    { expirationTtl: WEEK_TTL_SECONDS }
  );
}

async function consumeFreeQuota(
  env: Env,
  identity: FreeIdentity,
  limit: number,
  now = Date.now()
): Promise<void> {
  await Promise.all([
    ...identity.clusters.map(async (id) => {
      const live = (await readCluster(env, id)).filter((t) => now - t < WEEK_MS);
      live.push(now);
      // Only the newest `limit` stamps can ever gate a request; the rest are
      // dead weight in a value that is read on every generate.
      await env.CACHE.put(
        clusterKey(id),
        JSON.stringify(live.sort((a, b) => a - b).slice(-limit)),
        { expirationTtl: WEEK_TTL_SECONDS }
      );
    }),
    ...identity.unlinked.map((key) =>
      env.CACHE.put(key, identity.primary, { expirationTtl: WEEK_TTL_SECONDS })
    ),
    identity.hash
      ? rememberSignalNetwork(env, identity.hash, identity.net)
      : Promise.resolve(),
  ]);
}

/** How long until the next report, in words a visitor can act on. */
function formatWait(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours <= 1) return "within the hour";
  if (hours < 24) return `in about ${hours} hours`;
  const days = Math.round(hours / 24);
  return days <= 1 ? "tomorrow" : `in about ${days} days`;
}

export interface QuotaGate {
  allowed: boolean;
  message?: string;
  code?: "free_limit" | "pro_limit";
  /** Attach to the response so a minted visitor id survives the request. */
  setCookie?: string;
  /** Spend the allowance. Called only once a report actually finishes. */
  consume: () => Promise<void>;
}

const noop = async (): Promise<void> => {};

/**
 * Decide whether this request may generate a report, and hand back the way to
 * charge it once one is delivered.
 */
export async function openQuotaGate(
  request: Request,
  env: Env,
  ip: string,
  subject: string | null,
  clientSignal: string
): Promise<QuotaGate> {
  if (subject) {
    const limit = proDailyLimit(env);
    const key = proKey(subject);
    const used = Number((await env.CACHE.get(key)) || 0);
    if (used >= limit) {
      return {
        allowed: false,
        code: "pro_limit",
        message: `That is all ${limit} reports for today, even on the unlocked plan. The zen garden reopens tomorrow.`,
        consume: noop,
      };
    }
    return {
      allowed: true,
      consume: async () => {
        const current = Number((await env.CACHE.get(key)) || 0);
        await env.CACHE.put(key, String(current + 1), {
          expirationTtl: DAY_TTL_SECONDS,
        });
      },
    };
  }

  if (isRateLimitExempt(env, ip)) return { allowed: true, consume: noop };

  const limit = freeWeeklyLimit(env);
  const identity = await resolveFreeIdentity(request, env, ip, clientSignal);
  const wait = await freeQuotaWaitMs(env, identity, limit);

  if (wait) {
    return {
      allowed: false,
      code: "free_limit",
      message: `Free reports run ${limit} a week, and this week's are spent. Your next one opens ${formatWait(wait)} — or the ZenBuy app unlocks ${proDailyLimit(env)} a day, here and on your iPhone.`,
      setCookie: identity.setCookie,
      consume: noop,
    };
  }

  return {
    allowed: true,
    setCookie: identity.setCookie,
    consume: () => consumeFreeQuota(env, identity, limit),
  };
}
