/** Native Apple clients skip Turnstile; quota still applies. */
export function isNativeAppleClient(request: Request): boolean {
  const client = request.headers.get("X-ZenBuy-Client")?.toLowerCase();
  return client === "ios" || client === "tvos";
}
