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
wrangler secret put FINNHUB_API_KEY
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
| `CLOUDFLARE_API_TOKEN` | API token with **Edit Cloudflare Workers** ([create token](https://dash.cloudflare.com/?to=/:account/api-tokens)) |
| `CLOUDFLARE_ACCOUNT_ID` | From Workers & Pages → Account ID ([find IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)) |

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
| `/api/search?q=` | GET | Symbol autocomplete (Finnhub) |
| `/api/research` | POST | SSE stream `{ symbols, mode, turnstileToken }` |

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
