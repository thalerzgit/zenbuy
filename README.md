# ZenBuy.info

Calm equity research — **Know before you trade.**

Alpha stack: Cloudflare Pages + Workers, Finnhub fundamentals, Claude Sonnet (via AI Gateway), KV cache.

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

Worker runtime secrets (`FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, …) stay in the Cloudflare Worker — set once with `wrangler secret put`. The client loads the public Turnstile site key from `GET /api/config`.

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
| `/api/config` | GET | Public client config (Turnstile site key) |
| `/api/health` | GET | Config summary; `?deep=1` also probes upstreams (costs quota, cached 60s). Statuses only, never key material |
| `/api/prefetch?symbol=` | GET | Warms a symbol's fundamentals into KV so they're not on the critical path |
| `/api/research` | POST | SSE stream `{ symbols, mode, turnstileToken }` |

## Rate limits and resilience

The Finnhub free tier allows roughly 60 requests/minute, and a single
multi-ticker report costs ~11 calls per symbol. Several things keep that
within budget:

- **Search results are KV-cached** (24h for hits, 1h for misses) and the
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
  model id from `/v1/models`, retries once, and caches the result for a day.

## Latency

Wall time is dominated by output tokens, so:

- Separate reports for N tickers run as N concurrent requests, making wall
  time track the slowest report rather than the sum.
- Word caps are hard limits (1500/company, 2200 comparative) with
  `max_tokens` sized to match.
- `/api/prefetch` and a background Turnstile pre-solve fire when a ticker is
  picked, keeping data fetching and verification off the critical path.
- Body repaints are throttled rather than re-rendering markdown per token.

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
- KV 24h cache + AI Gateway cache on Claude
- Print-to-PDF with logo watermark
- 5 reports / IP / day (configurable)
