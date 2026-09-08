/**
 * One wrangler knob: `APP_STORE_URL` → `/api/config`.appStoreUrl.
 *
 * Public download is the official App Store listing
 * (https://apps.apple.com/app/id6807960678). Copy follows the host if
 * the var is ever pointed at TestFlight again.
 */

export function configuredAppUrl(url: string | undefined | null): string {
  return (url ?? "").trim();
}

export function isTestFlightUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === "testflight.apple.com";
  } catch {
    return false;
  }
}

export function storeRowCopy(url: string): { linkText: string; note: string } {
  if (isTestFlightUrl(url)) {
    return {
      linkText: "Join the public TestFlight beta →",
      note: "Public TestFlight · Google Play & card payments coming soon",
    };
  }
  return {
    linkText: "Get ZenBuy on the App Store →",
    note: "Available on the Apple App Store · Google Play & card payments coming soon",
  };
}
