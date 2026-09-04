import { configuredAppUrl, storeRowCopy } from "../lib/app-store-url";

/**
 * Web unlock — the browser half of "one purchase, both surfaces".
 *
 * The ZenBuy iOS purchase includes the website. The app ties that purchase to
 * an Apple ID; signing in here with the same Apple ID recognizes it. This
 * module owns every state a visitor can be in:
 *
 *   anonymous            every "unlock" affordance opens the GUIDE, which
 *                        spells out that the APP step comes first — nobody is
 *                        sent to Apple's sign-in page without seeing that.
 *   ?signin=ok           signed in, purchase not linked: toast plus the
 *                        persistent LINK BANNER naming the app step.
 *   signedIn, !unlocked  the same banner on every later visit.
 *   ?unlocked=1 / flip   welcome toast; the banner never shows.
 *   ?signin=failed       toast, with the guide as the way to try again.
 *
 * Pro is strictly additive: if `/api/me` fails, the page stays on the free
 * view rather than breaking.
 */

const APPLE_MARK = `<svg viewBox="0 0 16 20" width="14" height="17" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13.3 10.6c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.8-3.6 2.1-1.5 2.7-.4 6.6 1.1 8.8.7 1 1.6 2.2 2.7 2.2 1.1 0 1.5-.7 2.8-.7s1.7.7 2.8.7c1.2 0 1.9-1.1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.2-.9-2.2-3.4zM11.1 3.6c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-.9 2.6 1 .1 2-.5 2.6-1.2z"/></svg>`;

let pro = false;
let storeUrlPromise: Promise<void> | null = null;

/** Header affordances. Get the App stays visible whenever APP_STORE_URL is set. */
export const UNLOCK_HEADER_HTML = `
  <div class="header-pills">
    <a class="get-app-cta" id="get-app-cta" href="#" target="_blank" rel="noopener" hidden>Get the App</a>
    <a class="unlock-cta" href="/auth/apple" data-unlock-guide>Own it?&nbsp;<b>Unlock this site</b></a>
    <a class="unlock-status" href="/auth/unlink" title="Unlocked on this browser — sign out">Unlocked</a>
  </div>
`;

const GUIDE_HTML = `
  <div class="unlock-overlay" id="unlock-overlay" role="dialog" aria-modal="true" aria-label="How unlocking works">
    <div class="unlock-card">
      <h3>Unlock this site — included with the app</h3>
      <div class="unlock-scroll">
        <p class="u-sub">Your ZenBuy purchase includes the full research desk on the web. Here is what unlocks:</p>
        <ul class="u-feats">
          <li><b>25 reports a day</b><span class="u-feat-why"> — instead of the three a week that everyone gets for free.</span></li>
          <li><b>No human check</b><span class="u-feat-why"> — signed in, the Turnstile challenge stops interrupting you before every report.</span></li>
          <li><b>Every device you use</b><span class="u-feat-why"> — one Apple ID covers the iPhone app and this website together.</span></li>
        </ul>
        <p class="u-sub u-sub-steps">Two quick steps, one time:</p>
        <div class="u-step"><span class="u-num">1</span>
          <p><b>In the ZenBuy app on your iPhone:</b> tap the globe <b>🌐</b> (top right) and Sign in with Apple. <span>That links your purchase to your Apple&nbsp;ID.</span></p>
        </div>
        <div class="u-step"><span class="u-num">2</span>
          <p><b>Here on the website:</b> Sign in with Apple. <span>Everything unlocks, on every device you sign in from.</span></p>
        </div>
        <div class="u-step u-step-store" id="unlock-store" hidden><span class="u-num"></span>
          <p><span>Don't have the app yet?</span> <a id="unlock-store-link" href="#" target="_blank" rel="noopener">Get the iOS app →</a><br>
          <span class="store-note">Download on iPhone · Google Play &amp; card payments coming soon</span></p>
        </div>
        <p class="u-comp">Been given complimentary access? Skip both steps — sign in with Apple below using the Apple&nbsp;ID it was granted on, and the site unlocks with nothing to buy.</p>
      </div>
      <div class="u-actions">
        <a class="u-signin" href="/auth/apple">${APPLE_MARK} Sign in with Apple</a>
        <button type="button" class="u-close" id="unlock-close">Not now</button>
      </div>
    </div>
  </div>

  <div class="link-banner" id="link-banner">
    <p>You're signed in, but your purchase isn't linked yet. <b>Open ZenBuy on your iPhone → tap "Unlock Web" → Sign in with Apple.</b> Then refresh here.
      <span class="link-banner-alt">Signed in here with a different Apple&nbsp;ID than the app uses? <a href="/auth/unlink">Unlink</a> and sign in again with the matching one.</span></p>
    <button type="button" id="link-refresh">Refresh</button>
  </div>

  <div class="zb-toast" id="zb-toast" role="status" aria-live="polite"></div>
`;

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function isUnlocked(): boolean {
  return pro;
}

export function toast(message: string, ms = 4200): void {
  const node = byId("zb-toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), ms);
}

function applyAppUrl(url: string): void {
  const href = configuredAppUrl(url);
  if (!href) return;

  const header = document.getElementById("get-app-cta") as HTMLAnchorElement | null;
  if (header) {
    header.href = href;
    header.hidden = false;
  }

  const store = document.getElementById("unlock-store");
  const link = document.getElementById("unlock-store-link") as HTMLAnchorElement | null;
  if (store && link) {
    const copy = storeRowCopy(href);
    link.href = href;
    link.textContent = copy.linkText;
    const note = store.querySelector(".store-note");
    if (note) note.textContent = copy.note;
    store.hidden = false;
  }
}

/**
 * Header pill + store row share `/api/config`.appStoreUrl (wrangler
 * APP_STORE_URL). Fetched once on mount so the pill is visible without
 * opening the guide.
 */
function loadAppUrl(): Promise<void> {
  if (storeUrlPromise) return storeUrlPromise;
  storeUrlPromise = (async () => {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return;
      const { appStoreUrl } = (await res.json()) as { appStoreUrl?: string };
      applyAppUrl(appStoreUrl ?? "");
    } catch {
      /* both surfaces stay hidden */
    }
  })();
  return storeUrlPromise;
}

export function openUnlockGuide(): void {
  byId("unlock-overlay").classList.add("show");
  void loadAppUrl();
}

function closeUnlockGuide(): void {
  byId("unlock-overlay").classList.remove("show");
}

function enterProMode(): void {
  pro = true;
  document.body.classList.add("zb-pro");
  byId("link-banner").classList.remove("show");
}

/** Toasts for the states `/auth/apple/callback` redirects back into. */
function announceRedirectState(): void {
  const params = new URLSearchParams(location.search);
  if (params.has("unlocked")) {
    toast("Unlocked — welcome. The full research desk is yours.");
  } else if (params.has("unlinked")) {
    toast("Apple ID unlinked. Your App Store purchase is untouched.", 5200);
  } else if (params.get("signin") === "ok") {
    toast("Signed in — one step left to unlock.");
    byId("link-banner").classList.add("show");
  } else if (params.has("signin")) {
    toast("Sign-in didn't complete — try again anytime.");
  }

  if (params.has("unlocked") || params.has("signin") || params.has("unlinked")) {
    history.replaceState(null, "", location.pathname);
  }
}

export function mountUnlock(root: HTMLElement): void {
  const layer = document.createElement("div");
  layer.className = "unlock-layer";
  layer.innerHTML = GUIDE_HTML;
  root.append(layer);

  byId("unlock-close").addEventListener("click", closeUnlockGuide);
  byId("unlock-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeUnlockGuide();
  });
  byId("link-refresh").addEventListener("click", () => location.reload());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeUnlockGuide();
  });

  // Anything marked data-unlock-guide shows the steps instead of navigating.
  // The guide's own button is the real /auth/apple link, so the app-first
  // order is always seen before Apple is.
  document.addEventListener("click", (e) => {
    const trigger = (e.target as HTMLElement | null)?.closest("[data-unlock-guide]");
    if (!trigger || pro) return;
    e.preventDefault();
    openUnlockGuide();
  });

  announceRedirectState();
  void loadAppUrl();

  fetch("/api/me")
    .then((r) => r.json())
    .then((me: { signedIn?: boolean; unlocked?: boolean }) => {
      if (me?.unlocked) enterProMode();
      else if (me?.signedIn) byId("link-banner").classList.add("show");
    })
    .catch(() => {
      /* pro is additive — a failed check just leaves the free view */
    });
}
