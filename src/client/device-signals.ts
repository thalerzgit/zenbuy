/**
 * Device signal for the free weekly report allowance.
 *
 * A one-way hash of ordinary browser properties that survive incognito, a
 * cache clear, and a change of network, but differ between machines. It is the
 * only thing that keeps "3 free reports a week" from meaning "3 per private
 * window", and the Worker uses it for nothing else (see `src/worker/quota.ts`
 * and `/privacy`).
 *
 * Deliberately small: first-party only, no third-party SDK, no storage write,
 * and no signal that could identify someone away from ZenBuy.
 *
 * Every property here is chosen for *stability*, which rules out the usual
 * high-entropy tricks:
 *
 *   - No canvas or WebGL readback. Safari Private Browsing and Firefox's
 *     resist-fingerprinting mode add per-session noise to both, so the hash
 *     would change on every private window — a fresh allowance handed out in
 *     precisely the case this exists to catch.
 *   - No `devicePixelRatio`. Browser zoom moves it, so a stray ⌘+ would look
 *     like a new visitor.
 *
 * That leaves a low-entropy hash which stock phones share, and the Worker
 * handles that deliberately: a hash seen from many networks is demoted to a
 * device class and stops linking across them.
 */

let pending: Promise<string> | null = null;

/** Cached for the page's lifetime — resolves to "" if anything is unavailable. */
export function deviceSignal(): Promise<string> {
  pending ??= compute().catch(() => "");
  return pending;
}

function localeTrace(): string {
  try {
    const { locale, timeZone, calendar, numberingSystem } =
      Intl.DateTimeFormat().resolvedOptions();
    return [locale, timeZone, calendar, numberingSystem].join("/");
  } catch {
    return "";
  }
}

async function compute(): Promise<string> {
  // Not in every lib.dom: present on Chromium, absent on Safari — its absence
  // is itself part of the signal.
  const nav = navigator as Navigator & { deviceMemory?: number };

  const parts = [
    navigator.userAgent,
    (navigator.languages ?? [navigator.language]).join(","),
    navigator.platform,
    String(navigator.hardwareConcurrency ?? ""),
    String(nav.deviceMemory ?? ""),
    String(navigator.maxTouchPoints ?? ""),
    String(navigator.pdfViewerEnabled ?? ""),
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    // Chrome on a Mac with a dock differs from one without; stable per setup.
    `${screen.availWidth}x${screen.availHeight}`,
    localeTrace(),
    String(new Date().getTimezoneOffset()),
  ];

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join("|"))
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
