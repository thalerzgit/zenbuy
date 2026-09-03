/** App Store / web legal pages — Worker HTML, never the SPA catch-all. */

export function legalPageResponse(pathname: string): Response | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/privacy") return htmlPage(privacyPolicyHtml());
  if (path === "/support") return htmlPage(supportHtml());
  return null;
}

function htmlPage(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function shell(page: "privacy" | "support", title: string, description: string, inner: string): string {
  const path = page === "privacy" ? "/privacy" : "/support";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="https://zenbuy.info${path}" />
    <link rel="icon" href="/logo.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      :root {
        color-scheme: light;
        --green: #3d862d;
        --forest: #061a0f;
        --ink: #1a1a1a;
        --muted: #5c5c5c;
        --bg: #f7faf6;
        --border: #e0e0e0;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Outfit", system-ui, sans-serif;
        color: var(--ink);
        background: var(--bg);
        line-height: 1.55;
      }
      header {
        padding: 1.1rem 1.25rem;
        background: linear-gradient(165deg, #0a2416 0%, var(--forest) 55%, #04140c 100%);
        color: #fff;
      }
      header a { color: #fff; text-decoration: none; font-weight: 600; }
      main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
      h1 { font-size: 1.65rem; margin: 0 0 0.35rem; }
      .updated { color: var(--muted); font-size: 0.85rem; margin: 0 0 1.5rem; }
      h2 { font-size: 1.05rem; margin: 1.6rem 0 0.45rem; }
      p, li { font-size: 0.95rem; }
      ul { padding-left: 1.2rem; }
      a { color: var(--green); }
      footer {
        max-width: 40rem;
        margin: 0 auto;
        padding: 0 1.25rem 2.5rem;
        color: var(--muted);
        font-size: 0.8rem;
        border-top: 1px solid var(--border);
      }
      footer p { margin: 0.85rem 0 0; }
    </style>
  </head>
  <body data-zenbuy-page="${page}">
    <header><a href="/">ZenBuy.info</a></header>
    <main>
${inner}
    </main>
    <footer>
      <p><a href="/privacy">Privacy</a> · <a href="/support">Support</a> · <a href="/">Home</a></p>
      <p>Research only. Not a brokerage. Not financial advice.</p>
    </footer>
  </body>
</html>
`;
}

function privacyPolicyHtml(): string {
  return shell(
    "privacy",
    "Privacy Policy — ZenBuy.info",
    "How ZenBuy handles ticker queries, research reports, and the small amount of technical data we need to run the service.",
    `
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated September 3, 2026</p>
      <p>ZenBuy (the website at zenbuy.info and the ZenBuy iOS app) is a <strong>research tool</strong>. We help you read equity research before you decide anything. We are <strong>not a broker</strong>, bank, or registered investment advisor. We do not open accounts, hold money, or place trades.</p>
      <p>There are <strong>no logins or user accounts</strong> today. This page explains the little we do collect to run the service.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Research requests</strong> — ticker symbols you look up, plus options such as report mode, investment style, and time horizon.</li>
        <li><strong>Technical data</strong> — IP address (used for a daily report limit), approximate request time, and standard browser or app headers. The iOS app also sends a client marker so we can skip the website bot check.</li>
        <li><strong>Optional share links</strong> — if you create a share or “show more like this” link, we store that snapshot for a limited time.</li>
        <li><strong>On your device</strong> — the website may remember your last research preferences in local storage. That does not leave your browser.</li>
      </ul>
      <p>We do <strong>not</strong> run advertising SDKs or a product-analytics suite. We do not sell personal information.</p>

      <h2>Who helps us run ZenBuy</h2>
      <ul>
        <li><strong>Cloudflare</strong> — hosts the site and app API, and provides security (including Turnstile bot checks on the website only).</li>
        <li><strong>Finnhub</strong> — market data used for ticker search and company fundamentals.</li>
        <li><strong>Anthropic (Claude)</strong> — writes the research reports from the tickers and settings you submit.</li>
      </ul>
      <p>We send these providers what they need to do that job — not a customer profile. Cloudflare may set a short-lived bot-management cookie on the website.</p>

      <h2>Your choices (California, GDPR, and similar)</h2>
      <p>You can ask what we hold about you, or ask us to delete it, via the <a href="/support">Support page</a>. Because there are no accounts, we usually match a request to an IP address and time window.</p>
      <p>California: we do not sell personal information, and we do not “share” it for cross-context advertising.</p>
      <p>EEA/UK: we process the data above to provide the research you asked for, and to keep the service secure and fairly rate-limited.</p>

      <h2>Children</h2>
      <p>ZenBuy is not directed at children under 13 (or under 16 in the EEA).</p>

      <h2>Changes</h2>
      <p>If our practices change, we will update this page. The date at the top is the latest version.</p>

      <h2>Contact</h2>
      <p>Contact us via the <a href="/support">Support page</a>.</p>
    `
  );
}

function supportHtml(): string {
  return shell(
    "support",
    "Support — ZenBuy.info",
    "How to reach ZenBuy for questions about the research site or iOS app.",
    `
      <h1>Support</h1>
      <p class="updated">ZenBuy.info · research only</p>
      <p>Questions about the website or the iOS app? We do not publish a personal email address or phone number.</p>
      <p>If you have the iOS app (TestFlight or the App Store), send feedback through Apple’s TestFlight or App Store feedback for ZenBuy. Include the ticker(s) you were researching and whether you were on the web or iOS app. Do not send brokerage passwords or account numbers — we cannot access trading accounts, and we do not need them.</p>
      <p>Privacy requests (what we hold, or a deletion request) use the same path: mark the note as a privacy request and include an approximate time so we can match it to an IP window.</p>

      <h2>What ZenBuy is (and is not)</h2>
      <ul>
        <li>Independent equity research to help you think before you trade.</li>
        <li>Not a brokerage, bank, or registered investment advisor.</li>
        <li>Not financial, tax, or legal advice. You decide what to do with the information.</li>
      </ul>

      <h2>Privacy</h2>
      <p>We do not have logins today. See the <a href="/privacy">Privacy Policy</a> for what we collect and who helps us run the service (Cloudflare, Finnhub, Anthropic).</p>
    `
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
