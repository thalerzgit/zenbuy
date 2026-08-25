/**
 * Cloudflare Turnstile client helper.
 *
 * iOS Safari is sensitive to auto-running challenges on page load (ITP /
 * third-party iframe timing). We render with execution:"execute" and only
 * call turnstile.execute() inside a user gesture (Generate / Retry), then
 * wait for the success callback before POSTing /api/research.
 *
 * Important: when the API is already loaded, execute() must run in the same
 * synchronous turn as the click handler — any await/rAF before execute can
 * drop the user-gesture privilege on WebKit.
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

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const CONTAINER = "#turnstile";
/** iOS can hang on "Verifying…" — fail to a clear retry instead of forever. */
const SOLVE_TIMEOUT_MS = 25_000;
const API_WAIT_MS = 15_000;
const READY_EVENT = "zenbuy-turnstile-ready";

type Pending = {
  resolve: (token: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

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

    // Chain onto any stub installed by index.html (module can load after onload).
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
  return Boolean(SITE_KEY);
}

export function initTurnstile(): void {
  if (!SITE_KEY || mountAttempted) return;
  mountAttempted = true;
  void waitForApi()
    .then(() => mountWidget())
    .catch(() => {
      // Leave widget unmounted; obtainTurnstileToken will surface the error.
      mountAttempted = false;
    });
}

function mountWidget(): void {
  const ts = getApi();
  if (!SITE_KEY || !ts || widgetId) return;

  const el = document.querySelector(CONTAINER);
  if (!el) return;

  widgetId = ts.render(CONTAINER, {
    sitekey: SITE_KEY,
    theme: "light",
    // Valid sizes: normal | flexible | compact (not "invisible").
    size: "flexible",
    // Only show UI when CF needs a tap — keeps desktop clean, helps mobile.
    appearance: "interaction-only",
    // Defer challenge until Generate — critical for iOS Safari user-gesture.
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
      // Signal we handled the error so CF doesn't leave a stuck widget.
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
    /* fall through to execute */
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
      // Reset clears a stuck "Verifying…" iframe, then execute in THIS turn
      // (no rAF/await) so iOS keeps the user-gesture context.
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
 * Obtain a fresh Turnstile token. Must be invoked directly from a click
 * handler on iOS (before other awaits in that handler, ideally).
 * Resolves to "" when Turnstile is not configured (dev / optional).
 */
export function obtainTurnstileToken(): Promise<string> {
  if (!SITE_KEY) return Promise.resolve("");

  const ts = getApi();
  if (ts && (widgetId || document.querySelector(CONTAINER))) {
    // Fast path: sync execute inside the click turn.
    return beginSolve(ts);
  }

  // Slow path: script still loading — gesture may be lost; best-effort.
  return waitForApi().then((api) => beginSolve(api));
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
