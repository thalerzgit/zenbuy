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

Client Turnstile site key (build-time):

```bash
# .env
VITE_TURNSTILE_SITE_KEY=your_site_key
```

## Deploy

1. Push to `thalerzgit/zenbuy` on GitHub
2. Connect repo to Cloudflare Pages (or `npm run deploy`)
3. Point `zenbuy.info` apex to Pages; redirect `www` → apex
4. Set secrets in CF dashboard

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
