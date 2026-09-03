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
  RATE_LIMIT_DAILY?: string;
  /** Comma-separated IPs exempt from daily report limits. */
  RATE_LIMIT_WHITELIST?: string;
  CACHE_TTL_SECONDS?: string;
}
