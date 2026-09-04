interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  FINNHUB_API_KEY: string;
  FRED_API_KEY?: string;
  ANTHROPIC_API_KEY: string;
  /** Optional. When set, Anthropic outages fail over to xAI Chat Completions. */
  XAI_API_KEY?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  ZENBUY_MODEL?: string;
  ZENBUY_BACKUP_MODEL?: string;
  ZENBUY_BACKUP_PROVIDER?: string;
  /**
   * Reports per free visitor per rolling week, counted per identity cluster
   * (visitor cookie + device signal + network). Defaults to 3.
   */
  RATE_LIMIT_FREE_WEEKLY?: string;
  /** Daily reports for a signed-in buyer, counted per Apple subject. */
  RATE_LIMIT_PRO_DAILY?: string;
  CACHE_TTL_SECONDS?: string;

  /** Services ID for Sign in with Apple on the web (the OAuth client id). */
  APPLE_SERVICES_ID?: string;
  APPLE_TEAM_ID?: string;
  /** Key id of the Sign in with Apple `.p8`. */
  APPLE_KEY_ID?: string;
  /** The `.p8` itself, PKCS#8 PEM. Worker secret — never a var. */
  APPLE_PRIVATE_KEY?: string;
  /** Audience for identity tokens the iOS app sends. */
  APPLE_BUNDLE_ID?: string;
  /** Comma-separated in-app purchase ids that unlock the website. */
  APPLE_PRO_PRODUCT_IDS?: string;
  /** "0" rejects sandbox (TestFlight) purchases once the app is on sale. */
  APPLE_ALLOW_SANDBOX?: string;
  /**
   * Comma-separated Apple IDs granted complimentary access with no purchase.
   * Each entry is either an email address (case-insensitive) or
   * `sub:<apple subject id>`. Never counted against any report limit.
   */
  APPLE_ID_WHITELIST?: string;
  /** App Store listing. Empty while the app is TestFlight-only. */
  APP_STORE_URL?: string;
  /** Body of Apple's domain-association file, served under /.well-known/. */
  APPLE_DOMAIN_ASSOCIATION?: string;
}
