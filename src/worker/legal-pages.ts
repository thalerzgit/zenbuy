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
      h3 { font-size: 0.95rem; margin: 1.1rem 0 0.35rem; }
      p, li { font-size: 0.95rem; }
      ul, ol { padding-left: 1.2rem; }
      li { margin-bottom: 0.3rem; }
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
    "ZenBuy does not keep personal research history. Operational caches and abuse counters expire automatically.",
    `
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated September 4, 2026</p>
      <p>ZenBuy (the website at zenbuy.info and the ZenBuy iOS app) is a <strong>research tool</strong>. We help you read equity research before you decide anything. We are <strong>not a broker</strong>, bank, or registered investment advisor. We do not open accounts, hold money, or place trades.</p>
      <p>There are <strong>no passwords, no email sign-ups, and no personal profiles</strong>. We do <strong>not</strong> keep a personal research history. We do not run an ads or product-analytics suite. We do not sell personal information.</p>
      <p>The one optional exception is <strong>unlocking</strong>. If you bought ZenBuy on the App Store, you can sign in with Apple — in the app and again here — so the website recognizes the purchase. That is described under <a href="#unlocking">Unlocking with your Apple ID</a>. Everything else on this page applies whether or not you ever unlock.</p>

      <h2>What we store (operational only)</h2>
      <p>A research request is processed in the moment to produce a report. We do not attach that request to an identity or keep a per-person dossier. What remains on our side is short-lived operational data, stored in Cloudflare KV and deleted automatically when its TTL expires:</p>
      <ul>
        <li><strong>Shared result cache (~1 hour)</strong> — a finished report (and a plain-English rewrite, if you asked for one) may be reused for the same tickers and settings so we do not regenerate it immediately. That cache is global to the lookup, not tied to you. Anyone who can guess or reuse the cache id can read it until it expires. Search hits last up to 1 hour; empty search results up to 15 minutes. Discover picks last up to 1 hour.</li>
        <li><strong>Free-allowance counters (about one week)</strong> — free reports are capped per visitor per rolling week. A limit counted only against an IP address means nothing (a hotspot resets it), so to recognise the same visitor we keep three abuse-prevention identifiers, described in <a href="#free-limit">How the free limit recognises you</a>. They expire about a week after your last report.</li>
        <li><strong>Prefetch budget (purged within 24 hours)</strong> — your IP is counted against a daily market-data prefetch budget. That counter expires within 24 hours.</li>
        <li><strong>Optional share snapshot (up to 24 hours)</strong> — if you create a share link, we store that HTML snapshot for at most 24 hours, then it disappears.</li>
        <li><strong>Launch pass (about 3 minutes)</strong> — “show more like this” uses a one-time pass that expires in about 180 seconds.</li>
        <li><strong>On your device only</strong> — the website may remember your last investment style and profit-window preference in the browser. We do not store tickers in local storage. Those preferences do not leave your device.</li>
      </ul>
      <p>Market-data caches (company fundamentals, 13F context, and macro series) are operational copies of public market feeds, not user records. They expire within 24 hours (macro snapshot within 12 hours).</p>

      <h2 id="free-limit">How the free limit recognises you</h2>
      <p>Free reports are limited to a small number per visitor per rolling week. Reports are expensive to produce, so the limit has to survive the obvious resets — a private window, a cleared cache, a different network. That means we need to tell one visitor from another <em>without</em> asking you to make an account. We do it with three abuse-prevention identifiers, and nothing else:</p>
      <ul>
        <li><strong>A first-party cookie</strong> — <code>zb_vid</code>, a random identifier with no meaning outside ZenBuy. It is <code>HttpOnly</code>, so only our server can read it, and it is never sent anywhere else.</li>
        <li><strong>A device-signal hash</strong> — when you generate a report, your browser hashes ordinary properties it already exposes to every website (user-agent string, language, time zone and locale, screen size, processor and memory class) into a one-way fingerprint. <strong>We store the hash, not the properties</strong>, and it cannot be reversed into them. We deliberately do <em>not</em> read your canvas or WebGL output, the two signals normally used to make a fingerprint sharper. In the iOS app this is a random identifier held in the device keychain instead, which is simpler and reveals less.</li>
        <li><strong>The network your request came from</strong> — a coarsened form of your IP address (the surrounding /24 or /48 block, not the exact address). On its own it is never treated as an identity, because thousands of people share one mobile carrier address.</li>
      </ul>
      <p>Those identifiers are grouped so that the same visitor is recognised when one of them changes, and the group holds nothing but timestamps of how many free reports it has used. We do <strong>not</strong> use any of it for advertising, cross-site tracking, profiling, personalisation, or resale, we do not sell or share it, and we never combine it with your name, email, or phone number — we do not have those. Every key expires about a week after your last report, and unlocking with an App Store purchase replaces this mechanism entirely: an unlocked visitor is counted against their Apple identifier instead.</p>
      <p>To be straight with you about the limits of this: it is <em>abuse prevention, not surveillance</em>, and it is imperfect in both directions. Someone determined to get extra free reports can still do it by changing machines, and, rarely, two different people on very similar devices and the same network may be treated as one visitor. We tune it to keep the free tier alive, not to catch everybody.</p>

      <h2 id="unlocking">Unlocking with your Apple ID</h2>
      <p>One ZenBuy App Store purchase includes the website, and we sometimes grant the same access to an Apple ID directly, without a purchase. Either way it is optional — the free site works without it — and it is the only part of ZenBuy that stores anything tied to you across visits.</p>
      <p>When you sign in with Apple, Apple sends us a <strong>subject identifier</strong>: an opaque string that identifies you to ZenBuy only, and cannot be used to identify you anywhere else. We do not ask Apple for your name, and if you use Apple’s <em>Hide My Email</em> we never see a real address. Against that identifier we keep:</p>
      <ul>
        <li><strong>Your unlock record</strong> — which product you bought and, for the monthly plan, when it next needs renewing. It expires on its own when a subscription lapses; a lifetime purchase is kept until you ask us to remove it. If we granted you complimentary access instead of a purchase, the record says only that, and holds nothing more than a purchased one does.</li>
        <li><strong>A sign-in session (90 days)</strong> — a random identifier in a cookie on the website, and stored on your device in the app. It points at the record above and holds nothing else.</li>
        <li><strong>A daily research counter (purged within 24 hours)</strong> — once unlocked, your daily limit is counted against your Apple identifier instead of the free-tier identifiers above, so a changing network or a new browser does not cost you access you paid for.</li>
      </ul>
      <p>Your purchase itself stays with Apple. We verify the signed receipt Apple issues and never see your payment details. Signing out with <strong>Unlink</strong> deletes the session immediately; your purchase is untouched and you can sign in again at any time.</p>

      <h2>In transit and at rest</h2>
      <p>Traffic uses TLS. At rest, the keys above live only in Cloudflare KV and auto-expire via TTL. We do not keep a year-long verdict archive or any other personal research history.</p>

      <h2>Who helps us run ZenBuy</h2>
      <ul>
        <li><strong>Cloudflare</strong> — hosts the site and API, stores the ephemeral KV keys above, and provides security. The website uses Cloudflare Turnstile (a bot check). The iOS app sends a client marker so it can skip that web check; rate limits still apply.</li>
        <li><strong>Finnhub</strong> — market data for ticker search and company fundamentals.</li>
        <li><strong>Anthropic (Claude)</strong> — writes research reports from the tickers and settings in that request.</li>
        <li><strong>xAI (Grok)</strong> — used only if the primary model is unavailable, for the same one-off report job.</li>
        <li><strong>Apple</strong> — only if you choose to unlock. Apple handles the sign-in and the purchase, and tells us the subject identifier described above.</li>
      </ul>
      <p>We send these providers what they need to do that job — not a customer profile. Cookies are first-party and functional only: our own <code>zb_vid</code> free-allowance identifier and <code>zb_session</code> if you unlock, plus a short-lived bot-management cookie Cloudflare may set. There are no advertising or analytics cookies.</p>

      <h2>Your choices (California, GDPR, and similar)</h2>
      <p>Because there are no passwords and no personal research history, there is usually nothing durable to export or delete. Operational keys expire on the windows above. If you unlocked, the only lasting record is the unlock described above: <strong>Unlink</strong> ends the session at once, and you can ask us to delete the unlock record itself through the <a href="/support">Support page</a>. We do not publish a personal email or phone number.</p>
      <p>Clearing cookies removes <code>zb_vid</code> from your browser, but by design that does not hand out a new free allowance — the <a href="#free-limit">other identifiers</a> still recognise the week you are in. Those expire on their own about a week after your last report.</p>
      <p>California: we do not sell personal information, and we do not “share” it for cross-context advertising.</p>
      <p>EEA/UK: we process the operational data above to provide the report you asked for and to keep the service secure and fairly rate-limited.</p>

      <h2>Children</h2>
      <p>ZenBuy is not directed at children under 13 (or under 16 in the EEA).</p>

      <h2>Changes</h2>
      <p>If our practices change, we will update this page. The date at the top is the latest version.</p>

      <h2>Contact</h2>
      <p>Use the <a href="/support">Support page</a>. We do not list a personal email or phone number.</p>
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
      <p>Questions about the website or the iOS app? We do not publish a personal email address or phone number, and we do not collect contact details on this page.</p>
      <p>If you have the iOS app (TestFlight or the App Store), send feedback through Apple’s TestFlight or App Store feedback for ZenBuy. Mention whether you were on the web or iOS app. Do not send brokerage passwords or account numbers — we cannot access trading accounts, and we do not need them.</p>

      <h2>Unlocking the website with your app purchase</h2>
      <p>One ZenBuy App Store purchase — lifetime or monthly — includes the full research desk on this website. Unlocked, you get <strong>25 reports a day</strong> instead of the <strong>three a week</strong> the free tier allows, and the human check stops interrupting you.</p>
      <p>It takes two steps, once, and <strong>the app step has to come first</strong>. Signing in on the website by itself proves who you are, not what you bought.</p>
      <ol>
        <li><strong>In the ZenBuy app on your iPhone:</strong> tap the globe in the top right, then <em>Sign in with Apple</em>. That ties your purchase to your Apple ID.</li>
        <li><strong>Here on the website:</strong> choose <em>Unlock this site</em> and sign in with the same Apple ID. The site unlocks on every device you sign in from.</li>
      </ol>

      <h3>Complimentary access</h3>
      <p>ZenBuy occasionally grants the unlocked site to an Apple ID directly — testers, reviewers, and people we have invited. If yours is one of them there is nothing to buy and no app step: choose <em>Unlock this site</em>, sign in with the Apple ID the access was granted on, and the site unlocks. It stays that way on every device you sign in from with that Apple ID.</p>

      <h3>If it does not unlock</h3>
      <ul>
        <li><strong>You signed in here but nothing changed.</strong> Step 1 has not been done, or it was done with a different Apple ID. The banner at the bottom of the site says which step is outstanding.</li>
        <li><strong>You have two Apple IDs.</strong> Use <em>Unlink</em> in that banner to sign out, then sign in again with the Apple ID that made the purchase.</li>
        <li><strong>New iPhone, or the app forgot the purchase.</strong> Use <em>Restore purchases</em> on the app’s unlock screen. Apple restores it at no charge, and the website follows.</li>
        <li><strong>Refunds, receipts, and cancelling the monthly plan</strong> are handled by Apple, not by us — use Settings → your name → Subscriptions, or reportaproblem.apple.com.</li>
      </ul>
      <p>Payment happens through the App Store only. Google Play and card payments are not available yet.</p>

      <h2>What ZenBuy is (and is not)</h2>
      <ul>
        <li>Independent equity research to help you think before you trade.</li>
        <li>Not a brokerage, bank, or registered investment advisor.</li>
        <li>Not financial, tax, or legal advice. You decide what to do with the information.</li>
      </ul>

      <h2>Privacy</h2>
      <p>We do not have passwords or a personal research history. Operational caches expire on their own, and the free weekly allowance is enforced with abuse-prevention identifiers that expire about a week after your last report — see <a href="/privacy#free-limit">How the free limit recognises you</a>. If you unlock, we store an opaque Apple subject identifier and your unlock record — see <a href="/privacy#unlocking">Unlocking with your Apple ID</a> for exactly what that covers, and the <a href="/privacy">Privacy Policy</a> for the retention windows and who helps us run the service (Cloudflare, Finnhub, Anthropic, and xAI as a failover).</p>
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
