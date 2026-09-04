# ZenBuy.info

Calm equity research — **Know before you trade.**

Alpha stack: Cloudflare Workers, Finnhub fundamentals, Claude Opus (Anthropic) with xAI Grok backup, KV cache.

## Quick start

```bash
npm install
cp .env.example .dev.vars   # add secrets locally
npm run dev                 # http://localhost:5173
```

## Secrets (Wrangler)

```bash
wrangler secret put FINNHUB_API_KEY   # one key, or "key1,key2" to pool budgets
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put XAI_API_KEY             # optional; enables grok-4.5 failover
wrangler secret put AI_GATEWAY_ACCOUNT_ID   # optional
wrangler secret put AI_GATEWAY_ID           # optional
wrangler secret put AI_GATEWAY_TOKEN        # optional
wrangler secret put TURNSTILE_SECRET_KEY    # optional
```

Create a KV namespace and set the id in `wrangler.jsonc`:

```bash
wrangler kv namespace create CACHE
```

Client Turnstile site key:

- **Production:** Worker secret `TURNSTILE_SITE_KEY` → exposed via `GET /api/config`
- **Optional local override:**

```bash
# .env (local only)
VITE_TURNSTILE_SITE_KEY=your_site_key
```

Turnstile tips (esp. mobile Safari):

- Prefer a **Managed** widget in the Cloudflare dashboard (not Invisible-only).
- The client runs the challenge on Generate (`execution: execute`) so iOS gets a user gesture.
- Hostnames on the sitekey must include `zenbuy.info` (and `www` if used).

## Deploy

Production deploys from GitHub Actions on every push to `main`
(`.github/workflows/deploy.yml`), via `wrangler deploy`.

### One-time GitHub secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|--------|
| `CLOUDFLARE_API_TOKEN` | API token with **Edit Cloudflare Workers** + zone **Workers Routes/DNS** on `zenbuy.info` |

Account ID is already in `wrangler.jsonc` (`7841b36fdc9d3c3ae48bd119503d3df5`).

Recommended token (dashboard → API Tokens → Create Custom Token), name e.g. `GitHub to Cloudflare - ZenBuy`:

- **All accounts** — D1 Edit, Cloudflare Pages Edit, Workers R2 Storage Edit, Workers KV Storage Edit, Workers Scripts Edit, Account Settings Read
- **thalerz → zenbuy.info** — Workers Routes Edit, DNS Edit
- **All users** — User Details Read

Worker runtime secrets (`FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, …) stay in the Cloudflare Worker — set once with `wrangler secret put`. The client loads the public Turnstile site key from `GET /api/config`.

Optional Worker vars (also in `wrangler.jsonc`; `ZENBUY_MODEL` **must** stay `claude-opus-5` there so a deploy cannot reset production to Sonnet):

| Var | Default | Role |
|-----|---------|------|
| `ZENBUY_MODEL` | `claude-opus-5` | Primary Anthropic model |
| `ZENBUY_BACKUP_MODEL` | `grok-4.5` | Cross-provider backup when Anthropic is down |
| `ZENBUY_BACKUP_PROVIDER` | `xai` | Backup provider id |
| `APP_STORE_URL` | `https://testflight.apple.com/join/kMJsdtWY` | Where the header **Get the App** pill and the unlock guide's download row point. Swap for `https://apps.apple.com/app/id6807960678` on release day (the guide's wording follows the host, so TestFlight is never called an App Store listing); empty hides both |

`XAI_API_KEY` is optional at runtime. Without it, reports stay Anthropic-only and failover is skipped.

Manual redeploy: Actions → **Deploy** → **Run workflow**.

```bash
# Local deploy (same as CI)
npm run deploy
```

### Legacy / dashboard notes

1. Push to `thalerzgit/zenbuy` on GitHub (`main`)
2. Confirm the **Deploy** workflow is green
3. `zenbuy.info` / `www.zenbuy.info` are Worker custom domains
4. Set Worker secrets in the CF dashboard or via Wrangler

## API

| Route | Method | Description |
|-------|--------|-------------|
| `/api/search?q=` | GET | Symbol autocomplete (Finnhub), KV-cached per query |
| `/api/discover` | GET | Goal-fit ticker picks (`directive`, optional `horizon` / `limit`) |
| `/api/config` | GET | Public client config (Turnstile site key) |
| `/api/health` | GET | Primary `model`, `backupModel`, key presence booleans (`anthropic`, `xai`, …). `?deep=1` also probes upstreams (costs quota, cached 60s). Statuses only, never key material |
| `/api/prefetch?symbol=` | GET | Warms a symbol's fundamentals into KV so they're not on the critical path |
| `/api/research` | POST | SSE stream `{ symbols, mode, turnstileToken? }` — Turnstile required for web; native iOS sends `X-ZenBuy-Client: ios` and skips it |
| `/privacy` | GET | Privacy policy HTML (Worker, not the SPA) |
| `/support` | GET | Support / contact HTML (Worker, not the SPA) |

## Native iOS

SwiftUI app in `swift/` (not a WebView). Pushes to `main` that touch `swift/**` run **TestFlight** (`.github/workflows/ios-testflight.yml`) on `macos-26` / Xcode 26.6 — archive + upload only, no App Store review.

**Blockers before first upload:** (1) stamp `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY` on this repo from Mini; (2) Justin creates Bundle ID + ASC app for `info.zenbuy.app` in Apple Developer / App Store Connect UI (API key cannot CREATE apps — CI never tries). Then `workflow_dispatch` TestFlight to invite `thalerz@me.com`. See `swift/README.md`.

## Report allowances

| Who | Allowance | Counted against |
|-----|-----------|-----------------|
| Unlocked buyer | `RATE_LIMIT_PRO_DAILY` (25) per day | Apple `sub` |
| Free visitor | `RATE_LIMIT_FREE_WEEKLY` (3) per rolling 7×24h | Identity cluster |
| `APPLE_ID_WHITELIST` Apple IDs | unlimited | — |

No IP address is exempt: an unlimited allowance is granted only by Apple ID,
never by network. `APPLE_ID_WHITELIST` is complimentary unlock — signing in
with Apple is enough, no App Store purchase. Entries are emails or
`sub:<subject id>`, see
[docs/APPLE_UNLOCK_SETUP.md](docs/APPLE_UNLOCK_SETUP.md#complimentary-unlock--apple_id_whitelist).

A free allowance is only worth as much as the identity behind it, and both
obvious identities are trivially reset: an IP counter dies to a hotspot, a
cookie dies to incognito. So `src/worker/quota.ts` takes up to three signals
per request and files it under **every** cluster any of them already resolves
to, denying it if **any** of those clusters is out of allowance:

- **`zb_vid` cookie** — random id, `HttpOnly` so only the Worker can set or
  read it. Strongest signal: unique per browser profile, survives IP changes.
- **Device signal** — `src/client/device-signals.ts` hashes user-agent,
  language, time zone/locale, screen size, and CPU/memory class at generate
  time (SHA-256, truncated to 32 hex). Native iOS sends a random Keychain
  UUID as `X-ZenBuy-Device` instead. This is what catches a cleared cookie
  **and** a new IP at the same time. Every property is picked for stability
  over entropy: no canvas or WebGL readback (Safari Private Browsing and
  Firefox RFP add per-session noise, so the hash would reset on every private
  window) and no `devicePixelRatio` (browser zoom moves it). The resulting
  hash is low-entropy and stock phones share it, which is why a hash seen
  from more than 6 distinct networks is demoted to a device class and from
  then on only links within one network.
- **Network** — `/24` (IPv4) or `/48` (IPv6). Never an identity on its own
  (carrier NAT would bucket a whole city); it qualifies a device signal, and
  is the only bucket for a client that sends no signals at all.

Rolling window, not calendar week: each cluster stores the timestamps of its
last few reports, and the oldest frees its slot exactly 7×24h later, so the
error can say when the next report opens. Every key carries a ~1 week TTL.

**Residual risk, honestly:** a visitor who changes network *and* device
signals together (different browser on a different machine) is a new free
identity, and KV's eventual consistency leaves a small burst window. Perfect
detection is not available without accounts. Conversely, two people on very
similar devices behind one network can be treated as one visitor — the
6-network demotion exists to keep that rare.

## Rate limits and resilience

The Finnhub free tier allows roughly 60 requests/minute, and a single
multi-ticker report costs ~11 calls per symbol. Several things keep that
within budget:

- **Search results are KV-cached** (1h for hits, 15m for misses) and the
  client debounces, memoizes, and aborts superseded lookups. Typeahead used
  to spend one call per keystroke, which alone could exhaust the quota.
- **`FINNHUB_API_KEY` accepts a comma-separated pool.** Each key carries its
  own budget, so a `429` fails over to the next key immediately instead of
  sleeping through a backoff.
- **Throttled calls retry** with backoff honouring `Retry-After`, and
  non-essential calls degrade to `null` rather than failing the report.
- **Per-symbol isolation:** one unavailable ticker is reported as skipped and
  the remaining tickers still produce a report.
- **Keyless backup feed:** if Finnhub has no profile or quote for a symbol,
  identity and price come from Yahoo's chart endpoint. The payload is marked
  `dataQuality: "degraded"` and the report says which figures are
  unavailable rather than estimating them. Price only — it is a last resort,
  not a substitute.
- **Model retirement self-heals:** a `404` on `ZENBUY_MODEL` resolves a live
  Anthropic model id from `/v1/models`, retries once, and caches the result
  for a day. If Opus still fails, one `claude-sonnet-5` attempt runs, then
  (when `XAI_API_KEY` is set) the request fails over to xAI `grok-4.5`.
  Ordinary `400` prompt errors do not fail over.

## Latency

Wall time is dominated by output tokens, so:

- Separate reports for N tickers run as N concurrent requests, making wall
  time track the slowest report rather than the sum.
- Word caps are hard limits (1500/company, 2200 comparative) with
  `max_tokens` sized to match.
- `/api/prefetch` and a background Turnstile pre-solve fire when a ticker is
  picked, keeping data fetching and verification off the critical path.
- Body repaints are throttled rather than re-rendering markdown per token.
- BOTTOM LINE sticky is emitted as soon as that section is parseable (do
  not wait for FUNDAMENTALS), so the verdict paints well before the full
  ~85s report. Scorecard still arrives with SUMMARY / `done`.

## Typecheck

`vite build` uses esbuild and does **not** typecheck, so run:

```bash
npm run typecheck
```

This generates `worker-configuration.d.ts` via `wrangler types`, then checks
the client (`tsconfig.json`, DOM libs) and the worker
(`tsconfig.worker.json`, Workers globals) separately — one shared config
makes the two sets of globals collide. CI runs this before deploying.

## Smoke test

```bash
node tools/smoke-test.mjs comparative AAPL CSCO PANW NET
ANTHROPIC_API_KEY=... node tools/smoke-test.mjs --llm comparative AAPL CSCO PANW NET
```

## Spec (locked alpha)

- 1–4 tickers, global Finnhub symbols
- Multi-ticker modal: separate vs comparative (required)
- Hidden aggressive-growth thesis in server prompt
- Soft cap report length, section streaming, sage green UI
- KV 1h shared report cache + AI Gateway cache on the analysis providers
- Print-to-PDF with logo watermark
- 3 free reports / visitor / rolling week (`RATE_LIMIT_FREE_WEEKLY`), 25 / day
  unlocked (`RATE_LIMIT_PRO_DAILY`); exempt Apple IDs via `APPLE_ID_WHITELIST`
  (no IP-based exemption)
