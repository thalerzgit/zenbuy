/**
 * Cloudflare Turnstile client helper.
 *
 * Site key is loaded at runtime from `/api/config` (Worker secret
 * TURNSTILE_SITE_KEY) so CI deploys don't need a Vite build-time key.
 * VITE_TURNSTILE_SITE_KEY remains an optional local override.
 *
 * iOS Safari: render with execution:"execute" and call turnstile.execute()
 * inside the Generate click gesture, then wait for the callback before POST.
 */

export type TurnstileAPI = {
  render: (
    container: string | HTMLElement,
    params: Record<string, unknown>
  ) => string;
  execute: (widgetIdOrContainer: string) => void;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
  getResponse: (widgetId?: string) => string | undefined;
  isExpired: (widgetId?: string) => boolean;
};

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
    onZenbuyTurnstileLoad?: () => void;
  }
}

const VITE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const CONTAINER = "#turnstile";
const SOLVE_TIMEOUT_MS = 25_000;
const API_WAIT_MS = 15_000;
const READY_EVENT = "zenbuy-turnstile-ready";

type Pending = {
  resolve: (token: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let siteKey = VITE_SITE_KEY;
let siteKeyResolved = Boolean(VITE_SITE_KEY);
let widgetId: string | undefined;
let token = "";
let pending: Pending | null = null;
let mountAttempted = false;

function getApi(): TurnstileAPI | undefined {
  return window.turnstile;
}

function clearPending(err?: Error): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  const p = pending;
  pending = null;
  if (err) p.reject(err);
  else p.reject(new Error("Verification cancelled."));
}

function settleSuccess(next: string): void {
  token = next;
  if (!pending) return;
  clearTimeout(pending.timer);
  const p = pending;
  pending = null;
  p.resolve(next);
}

async function resolveSiteKey(): Promise<string> {
  if (siteKeyResolved) return siteKey;
  siteKeyResolved = true;
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = (await res.json()) as { turnstileSiteKey?: string };
      if (data.turnstileSiteKey) siteKey = data.turnstileSiteKey;
    }
  } catch {
    /* keep vite / empty */
  }
  return siteKey;
}

function waitForApi(): Promise<TurnstileAPI> {
  return new Promise((resolve, reject) => {
    const existing = getApi();
    if (existing) {
      resolve(existing);
      return;
    }

    let settled = false;
    const finish = (api: TurnstileAPI | undefined, err?: Error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(READY_EVENT, onReady);
      clearInterval(poll);
      clearTimeout(timer);
      if (api) resolve(api);
      else reject(err ?? new Error("Security check didn't load."));
    };

    const onReady = () => finish(getApi());

    window.addEventListener(READY_EVENT, onReady);

    const prev = window.onZenbuyTurnstileLoad;
    window.onZenbuyTurnstileLoad = () => {
      try {
        prev?.();
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(READY_EVENT));
      onReady();
    };

    const poll = setInterval(() => {
      const api = getApi();
      if (api) finish(api);
    }, 50);

    const timer = setTimeout(() => {
      finish(
        getApi(),
        new Error(
          "Security check didn't load. Check your connection and reload."
        )
      );
    }, API_WAIT_MS);
  });
}

export function isTurnstileEnabled(): boolean {
  return Boolean(siteKey);
}

export function initTurnstile(): void {
  if (mountAttempted) return;
  mountAttempted = true;
  void (async () => {
    await resolveSiteKey();
    if (!siteKey) {
      mountAttempted = false;
      return;
    }
    try {
      await waitForApi();
      mountWidget();
    } catch {
      mountAttempted = false;
    }
  })();
}

function mountWidget(): void {
  const ts = getApi();
  if (!siteKey || !ts || widgetId) return;

  const el = document.querySelector(CONTAINER);
  if (!el) return;

  widgetId = ts.render(CONTAINER, {
    sitekey: siteKey,
    theme: "light",
    size: "flexible",
    appearance: "interaction-only",
    execution: "execute",
    retry: "auto",
    "refresh-expired": "auto",
    "refresh-timeout": "auto",
    callback: (t: string) => settleSuccess(t),
    "error-callback": () => {
      token = "";
      clearPending(
        new Error("Human check hit a snag. Tap retry in a moment.")
      );
      try {
        if (widgetId) ts.reset(widgetId);
      } catch {
        /* ignore */
      }
      return true;
    },
    "expired-callback": () => {
      token = "";
    },
    "timeout-callback": () => {
      token = "";
      clearPending(
        new Error("Human check timed out. Tap retry when you're ready.")
      );
      try {
        if (widgetId) ts.reset(widgetId);
      } catch {
        /* ignore */
      }
    },
  });
}

function beginSolve(ts: TurnstileAPI): Promise<string> {
  if (!widgetId) {
    mountWidget();
  }
  if (!widgetId) {
    return Promise.reject(
      new Error("Security check couldn't start. Reload and try again.")
    );
  }

  try {
    const existing = ts.getResponse(widgetId) || token;
    if (existing && !ts.isExpired(widgetId)) {
      token = existing;
      return Promise.resolve(existing);
    }
  } catch {
    /* fall through */
  }

  token = "";
  if (pending) clearPending();

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      token = "";
      try {
        ts.reset(widgetId);
      } catch {
        /* ignore */
      }
      if (!pending) return;
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      p.reject(
        new Error(
          "Verification is taking too long. Tap retry — Safari sometimes needs a second pass."
        )
      );
    }, SOLVE_TIMEOUT_MS);

    pending = { resolve, reject, timer };

    try {
      ts.reset(widgetId);
      ts.execute(widgetId!);
    } catch {
      clearPending(
        new Error("Security check failed to start. Reload and try again.")
      );
    }
  });
}

/**
 * Obtain a fresh Turnstile token. Invoke from a click handler on iOS.
 * Resolves to "" when Turnstile is not configured.
 */
export async function obtainTurnstileToken(): Promise<string> {
  await resolveSiteKey();
  if (!siteKey) return "";

  const ts = getApi();
  if (ts && (widgetId || document.querySelector(CONTAINER))) {
    return beginSolve(ts);
  }

  const api = await waitForApi();
  return beginSolve(api);
}

/** Invalidate token after siteverify (tokens are single-use). */
export function resetTurnstile(): void {
  token = "";
  const ts = getApi();
  if (!ts || !widgetId) return;
  try {
    ts.reset(widgetId);
  } catch {
    /* ignore */
  }
}
