import { BRAND_MARK_SVG } from "./brand-mark";
import {
  directiveLabel,
  loadStoredDirective,
  loadStoredProfitHorizon,
  mountDirectivePanel,
} from "./directive-ui";
import { profitHorizonLabel } from "../lib/profit-horizons";
import { startOracleRotation } from "./quotes";
import type { InvestmentDirectiveId } from "../lib/investment-directives";
import { isInvestmentDirectiveId } from "../lib/investment-directives";
import {
  initTurnstile,
  obtainTurnstileToken,
  resetTurnstile,
  setTurnstileInteractiveHandler,
  warmTurnstileToken,
} from "./turnstile";

export interface SymbolPick {
  symbol: string;
  name: string;
}

type ReportMode = "separate" | "comparative";
type InputMode = "manual" | "discover";

interface DiscoverPick {
  symbol: string;
  name: string;
  fitScore: number;
  reason: string;
  profitHorizonYears: number;
  snapshot: {
    price: number | null;
    pe: number | null;
    revenueYoY: number | null;
    dividendYieldPct: number | null;
  };
}

interface Badges {
  recommendation?: string;
  sentiment?: string;
  conviction?: string;
}

interface Scorecard {
  growth?: number;
  moat?: number;
  management?: number;
  valuation?: number;
  balanceSheet?: number;
  catalysts?: number;
  overall?: number;
}

interface CompanyProfile {
  symbol: string;
  bottomLineHtml: string;
  scorecardHtml: string;
  badges: Badges;
  scores: Scorecard;
  bodyHtml: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = "";
  const state = {
    picks: [] as SymbolPick[],
    mode: "separate" as ReportMode,
    inputMode: "manual" as InputMode,
    directive: loadStoredDirective() as InvestmentDirectiveId,
    profitHorizonYears: loadStoredProfitHorizon(loadStoredDirective()),
    discoverResults: [] as DiscoverPick[],
    discoverSelected: new Set<string>(),
    loading: false,
    discovering: false,
  };

  const header = el("header", "site-header");
  header.innerHTML = `
    <a class="brand" href="/" aria-label="ZenBuy.info home">
      <span class="brand-mark" aria-hidden="true">${BRAND_MARK_SVG}</span>
      <span class="brand-lockup">
        <span class="brand-name">ZenBuy<span class="brand-tld">.info</span></span>
        <span class="brand-oracle" id="brand-oracle" aria-live="polite">Price is what you pay. Value is what you get. — Warren Buffett</span>
        <span class="brand-tag">Know before you trade</span>
      </span>
    </a>
  `;

  const main = el("main", "site-main");
  const searchWrap = el("section", "search-panel");
  searchWrap.innerHTML = `
    <div class="input-mode-tabs" role="tablist" aria-label="How to pick stocks">
      <button type="button" class="input-mode-tab is-active" data-mode="manual" role="tab" aria-selected="true">Enter tickers</button>
      <button type="button" class="input-mode-tab" data-mode="discover" role="tab" aria-selected="false">Find for my goal</button>
    </div>
    <div id="manual-input-block">
      <label class="search-label" for="symbol-input">Ticker(s) or Corp. Name</label>
      <div class="search-row">
        <input id="symbol-input" type="text" autocomplete="off" placeholder="AAPL, NVDA, Apple…" maxlength="96" />
        <div id="dropdown" class="dropdown hidden" role="listbox"></div>
      </div>
      <div id="chips" class="chips"></div>
    </div>
    <div id="discover-block" class="discover-block hidden">
      <p class="discover-lead">We'll suggest up to 4 names that match your goal and profit window.</p>
      <button type="button" id="discover-btn" class="btn ghost discover-btn">Find stocks for my goal</button>
      <div id="discover-results" class="discover-results hidden"></div>
    </div>
    <div id="directive-panel-mount"></div>
    <div class="actions">
      <button id="submit-btn" type="button" class="btn primary" disabled>Generate Report</button>
      <button id="simplify-btn" type="button" class="btn ghost hidden">Explain in Lay Terms</button>
      <div id="share-wrap" class="share-wrap hidden">
        <button id="share-btn" type="button" class="btn ghost" aria-haspopup="menu" aria-expanded="false">Share</button>
        <div id="share-menu" class="share-menu hidden" role="menu">
          <button type="button" class="share-menu-item" role="menuitem" data-share="link">Share link</button>
          <button type="button" class="share-menu-item" role="menuitem" data-share="copy">Copy link</button>
          <button type="button" class="share-menu-item" role="menuitem" data-share="pdf">Save as PDF</button>
        </div>
      </div>
    </div>
    <div id="turnstile" class="turnstile"></div>
    <p id="form-error" class="form-error hidden"></p>
  `;

  const modal = el("div", "modal hidden");
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-labelledby="modal-title">
      <h2 id="modal-title">How should we analyze these?</h2>
      <p class="modal-sub">You selected multiple tickers. Choose a report style.</p>
      <div class="mode-options">
        <label class="mode-option">
          <input type="radio" name="mode" value="separate" checked />
          <span><strong>Separate reports</strong><small>One full report per company</small></span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode" value="comparative" />
          <span><strong>Comparative report</strong><small>Rank names and pick the best fit</small></span>
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" id="modal-cancel">Cancel</button>
        <button type="button" class="btn primary" id="modal-confirm">Continue</button>
      </div>
    </div>
  `;

  const report = el("section", "report-panel hidden");
  report.innerHTML = `
    <header class="report-hero">
      <div id="report-title-wrap"></div>
      <div id="company-profiles" class="company-profiles hidden"></div>
      <div id="stream-hero" class="stream-hero">
        <div class="hero-head">
          <div id="badge-strip" class="badge-strip"></div>
        </div>
        <div class="hero-grid">
          <div id="bottom-line" class="bottom-line loading">
            <div class="skeleton-lines"><span></span><span></span><span></span></div>
          </div>
          <div id="scorecard-wrap" class="scorecard-wrap"></div>
        </div>
      </div>
    </header>
    <div id="report-body" class="report-body loading">
      <div class="skeleton-lines"><span></span><span></span><span></span><span></span></div>
    </div>
    <p id="as-of" class="as-of hidden"></p>
  `;

  const footer = el("footer", "site-footer");
  footer.innerHTML = `
    <p>Not financial advice. For informational purposes only. Past performance does not guarantee future results.</p>
    <p>ZenBuy.info is not a registered investment advisor. Do your own due diligence.</p>
  `;

  main.append(searchWrap, report);
  root.append(header, main, modal, footer);

  const oracleEl = header.querySelector("#brand-oracle") as HTMLElement;
  startOracleRotation(oracleEl);

  const input = searchWrap.querySelector("#symbol-input") as HTMLInputElement;
  const dropdown = searchWrap.querySelector("#dropdown") as HTMLDivElement;
  const chips = searchWrap.querySelector("#chips") as HTMLDivElement;
  const manualInputBlock = searchWrap.querySelector("#manual-input-block") as HTMLDivElement;
  const discoverBlock = searchWrap.querySelector("#discover-block") as HTMLDivElement;
  const discoverBtn = searchWrap.querySelector("#discover-btn") as HTMLButtonElement;
  const discoverResults = searchWrap.querySelector("#discover-results") as HTMLDivElement;
  const inputModeTabs = searchWrap.querySelectorAll<HTMLButtonElement>(".input-mode-tab");
  const directiveMount = searchWrap.querySelector(
    "#directive-panel-mount"
  ) as HTMLDivElement;
  mountDirectivePanel(
    directiveMount,
    state.directive,
    state.profitHorizonYears,
    (id) => {
      state.directive = id;
      state.discoverResults = [];
      state.discoverSelected.clear();
      renderDiscoverResults();
    },
    (years) => {
      state.profitHorizonYears = years;
      state.discoverResults = [];
      state.discoverSelected.clear();
      renderDiscoverResults();
    }
  );
  const submitBtn = searchWrap.querySelector("#submit-btn") as HTMLButtonElement;
  const simplifyBtn = searchWrap.querySelector(
    "#simplify-btn"
  ) as HTMLButtonElement;
  const shareWrap = searchWrap.querySelector("#share-wrap") as HTMLDivElement;
  const shareBtn = searchWrap.querySelector("#share-btn") as HTMLButtonElement;
  const shareMenu = searchWrap.querySelector("#share-menu") as HTMLDivElement;
  const formError = searchWrap.querySelector("#form-error") as HTMLParagraphElement;
  const reportPanel = report;
  const titleWrap = report.querySelector("#report-title-wrap") as HTMLDivElement;
  const companyProfiles = report.querySelector(
    "#company-profiles"
  ) as HTMLDivElement;
  const streamHero = report.querySelector("#stream-hero") as HTMLDivElement;
  const badgeStrip = report.querySelector("#badge-strip") as HTMLDivElement;
  const bottomLine = report.querySelector("#bottom-line") as HTMLDivElement;
  const scorecardWrap = report.querySelector("#scorecard-wrap") as HTMLDivElement;
  const reportBody = report.querySelector("#report-body") as HTMLDivElement;
  const asOfEl = report.querySelector("#as-of") as HTMLParagraphElement;

  let debounce: ReturnType<typeof setTimeout>;
  let searchAbort: AbortController | null = null;
  let reportId = "";
  /** True once a report is on screen — primary button becomes Start New Report. */
  let hasReport = false;
  /** Snapshot of the analyst report so the lay rewrite can be toggled off. */
  let fullView: { bodyHtml: string; bottomLineHtml: string } | null = null;
  let showingLayman = false;
  /** Immutable share snapshot id (7-day TTL) created when the user shares. */
  let activeShareId = "";
  /** One-time pass for autostart tabs opened from Show more like this. */
  let pendingLaunchId = "";
  /** Successor / autostart reports hide "Show more like this" to avoid rabbit holes. */
  let allowSimilar = true;
  let reportSymbols: string[] = [];
  let reportMode: ReportMode = "separate";
  let lastCompanies: CompanyProfile[] = [];
  const searchCache = new Map<string, Array<{ symbol: string; name: string }>>();

  function shareUrlFromId(id: string): string {
    const url = new URL(window.location.origin + "/");
    url.searchParams.set("r", id);
    return url.toString();
  }

  async function createShareLink(): Promise<string> {
    if (activeShareId) return shareUrlFromId(activeShareId);
    if (!reportId) return window.location.origin + "/";

    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportId,
        variant: showingLayman ? "layman" : "full",
      }),
    });
    const data = (await res.json()) as { shareId?: string; error?: string };
    if (!res.ok || !data.shareId) {
      throw new Error(data.error || "Couldn't create share link.");
    }

    activeShareId = data.shareId;
    if (window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set("r", activeShareId);
      window.history.replaceState({}, "", url.toString());
    }
    return shareUrlFromId(activeShareId);
  }

  function setShareUrlInAddressBar(): void {
    if (!activeShareId || !window.history.replaceState) return;
    const url = new URL(window.location.href);
    url.searchParams.set("r", activeShareId);
    window.history.replaceState({}, "", url.toString());
  }

  function clearShareUrlInAddressBar(): void {
    if (!window.history.replaceState) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("r")) return;
    url.searchParams.delete("r");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function closeShareMenu(): void {
    shareMenu.classList.add("hidden");
    shareBtn.setAttribute("aria-expanded", "false");
  }

  function syncPrimaryBtn(): void {
    if (state.loading) return;
    if (hasReport) {
      submitBtn.textContent = "Start New Report";
      submitBtn.disabled = false;
      return;
    }
    submitBtn.textContent = "Generate Report";
    if (state.inputMode === "discover") {
      submitBtn.disabled = state.discoverSelected.size === 0;
    } else {
      submitBtn.disabled = state.picks.length === 0;
    }
  }

  function syncPicksFromDiscover(): void {
    if (state.inputMode !== "discover") return;
    state.picks = state.discoverResults
      .filter((p) => state.discoverSelected.has(p.symbol))
      .map((p) => ({ symbol: p.symbol, name: p.name }));
    renderChips();
  }

  function renderDiscoverResults(): void {
    discoverResults.innerHTML = "";
    if (!state.discoverResults.length) {
      discoverResults.classList.add("hidden");
      syncPrimaryBtn();
      return;
    }

    discoverResults.classList.remove("hidden");
    const head = el("p", "discover-results-head");
    head.textContent = "Select up to 4 — then Generate Report.";
    discoverResults.append(head);

    state.discoverResults.forEach((pick) => {
      const row = el("label", "discover-pick");
      const checked = state.discoverSelected.has(pick.symbol);
      row.innerHTML = `
        <input type="checkbox" ${checked ? "checked" : ""} />
        <span class="discover-pick-main">
          <strong>${pick.symbol}</strong>
          <span class="discover-pick-name">${pick.name}</span>
          <span class="discover-pick-score">${pick.fitScore}% fit</span>
        </span>
        <span class="discover-pick-reason">${pick.reason}</span>
      `;
      const box = row.querySelector("input") as HTMLInputElement;
      box.onchange = () => {
        if (box.checked) {
          if (state.discoverSelected.size >= 4) {
            box.checked = false;
            showError("You can analyze up to 4 tickers at a time.", false);
            return;
          }
          state.discoverSelected.add(pick.symbol);
        } else {
          state.discoverSelected.delete(pick.symbol);
        }
        syncPicksFromDiscover();
      };
      discoverResults.append(row);
    });
    syncPicksFromDiscover();
  }

  function setInputMode(mode: InputMode): void {
    state.inputMode = mode;
    inputModeTabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    manualInputBlock.classList.toggle("hidden", mode !== "manual");
    discoverBlock.classList.toggle("hidden", mode !== "discover");
    if (mode === "manual") {
      state.discoverResults = [];
      state.discoverSelected.clear();
      renderDiscoverResults();
    } else {
      state.picks = [];
      renderChips();
    }
    syncPrimaryBtn();
  }

  async function runDiscover(): Promise<void> {
    hideError();
    state.discovering = true;
    discoverBtn.disabled = true;
    discoverBtn.textContent = "Finding matches…";
    try {
      const params = new URLSearchParams({
        directive: state.directive,
        horizon: String(state.profitHorizonYears),
        limit: "4",
      });
      const res = await fetch(`/api/discover?${params}`);
      const data = (await res.json()) as {
        picks?: DiscoverPick[];
        error?: string;
      };
      if (!res.ok || !data.picks?.length) {
        showError(data.error || "Couldn't find matching stocks.", true);
        return;
      }
      state.discoverResults = data.picks;
      state.discoverSelected = new Set(data.picks.map((p) => p.symbol));
      renderDiscoverResults();
      data.picks.forEach((p) => {
        void fetch(`/api/prefetch?symbol=${encodeURIComponent(p.symbol)}`).catch(
          () => {}
        );
      });
      warmTurnstileToken();
    } catch {
      showError("Couldn't find matching stocks. Try again?", true);
    } finally {
      state.discovering = false;
      discoverBtn.disabled = false;
      discoverBtn.textContent = "Find stocks for my goal";
    }
  }

  inputModeTabs.forEach((tab) => {
    tab.onclick = () => {
      const mode = tab.dataset.mode as InputMode;
      if (mode) setInputMode(mode);
    };
  });

  discoverBtn.onclick = () => void runDiscover();

  function showPostReportActions(): void {
    shareWrap.classList.remove("hidden");
    if (reportId) simplifyBtn.classList.remove("hidden");
  }

  function hidePostReportActions(): void {
    closeShareMenu();
    shareWrap.classList.add("hidden");
    simplifyBtn.classList.add("hidden");
    simplifyBtn.textContent = "Explain in Lay Terms";
  }

  function renderChips(): void {
    chips.innerHTML = "";
    state.picks.forEach((pick) => {
      const chip = el("span", "chip");
      chip.innerHTML = `<strong>${pick.symbol}</strong> ${pick.name}
        <button type="button" aria-label="Remove ${pick.symbol}">×</button>`;
      chip.querySelector("button")!.onclick = () => {
        state.picks = state.picks.filter((p) => p.symbol !== pick.symbol);
        renderChips();
      };
      chips.append(chip);
    });
    syncPrimaryBtn();
  }

  function showError(msg: string, retry = true): void {
    formError.textContent = retry ? `${msg} Retry?` : msg;
    formError.classList.remove("hidden");
    formError.onclick = retry ? () => runResearch() : null;
    formError.style.cursor = retry ? "pointer" : "default";
  }

  function hideError(): void {
    formError.classList.add("hidden");
  }

  /** Ticker-shaped token (spaces around commas are trimmed before this runs). */
  const TICKER_TOKEN = /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/;

  /**
   * Split comma-separated entry. Completed segments become chips; the trailing
   * fragment (after the last comma) stays in the field for search.
   * "AAPL, NVDA, " → done [AAPL, NVDA], rest ""
   * "AAPL, NVDA, Crow" → done [AAPL, NVDA], rest "Crow"
   */
  function parseCommaInput(value: string): { done: string[]; rest: string } {
    if (!value.includes(",")) return { done: [], rest: value };
    const endsWithSep = /,\s*$/.test(value);
    const parts = value.split(",");
    if (endsWithSep) {
      return {
        done: parts.map((p) => p.trim()).filter(Boolean),
        rest: "",
      };
    }
    const rest = parts[parts.length - 1] ?? "";
    const done = parts
      .slice(0, -1)
      .map((p) => p.trim())
      .filter(Boolean);
    return { done, rest };
  }

  function addPick(pick: SymbolPick): boolean {
    if (state.picks.length >= 4) return false;
    if (state.picks.some((p) => p.symbol === pick.symbol)) return false;
    state.picks.push(pick);
    renderChips();
    void fetch(`/api/prefetch?symbol=${encodeURIComponent(pick.symbol)}`).catch(
      () => {}
    );
    warmTurnstileToken();
    return true;
  }

  async function fetchSearchRows(
    q: string
  ): Promise<Array<{ symbol: string; name: string }>> {
    const key = q.toLowerCase();
    const memo = searchCache.get(key);
    if (memo) return memo;

    searchAbort?.abort();
    const ctrl = new AbortController();
    searchAbort = ctrl;

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: ctrl.signal,
      });
      const data = (await res.json()) as {
        results?: Array<{ symbol: string; name: string }>;
        throttled?: boolean;
      };
      const rows = data.results ?? [];
      if (!data.throttled) searchCache.set(key, rows);
      return rows;
    } catch {
      if (ctrl.signal.aborted) return [];
      return [];
    }
  }

  async function resolveToken(token: string): Promise<SymbolPick | null> {
    const q = token.trim();
    if (!q) return null;
    const rows = await fetchSearchRows(q);
    const upper = q.toUpperCase();
    const exact = rows.find((r) => r.symbol.toUpperCase() === upper);
    if (exact) return { symbol: exact.symbol.toUpperCase(), name: exact.name };

    // Company / partial name → best search hit.
    if (!TICKER_TOKEN.test(q) && rows[0]) {
      return {
        symbol: rows[0].symbol.toUpperCase(),
        name: rows[0].name,
      };
    }

    // Ticker-shaped with no directory hit still commit (user intent is clear).
    if (TICKER_TOKEN.test(q)) {
      return { symbol: upper, name: upper };
    }
    return null;
  }

  async function commitTokens(tokens: string[]): Promise<void> {
    const skipped: string[] = [];
    for (const token of tokens) {
      if (state.picks.length >= 4) {
        skipped.push(token);
        continue;
      }
      const pick = await resolveToken(token);
      if (!pick) {
        skipped.push(token);
        continue;
      }
      if (!addPick(pick) && !state.picks.some((p) => p.symbol === pick.symbol)) {
        skipped.push(token);
      }
    }
    if (state.picks.length >= 4 && skipped.length) {
      showError("You can analyze up to 4 tickers at a time.", false);
    }
  }

  function renderResults(rows: Array<{ symbol: string; name: string }>): void {
    dropdown.innerHTML = "";
    if (!rows.length) {
      dropdown.classList.add("hidden");
      return;
    }
    rows.forEach((row) => {
      const item = el("button", "dropdown-item");
      item.type = "button";
      item.innerHTML = `<strong>${row.symbol}</strong> <span>${row.name}</span>`;
      item.onclick = () => {
        addPick({ symbol: row.symbol, name: row.name });
        input.value = "";
        dropdown.classList.add("hidden");
        input.focus();
      };
      dropdown.append(item);
    });
    dropdown.classList.remove("hidden");
  }

  async function search(q: string): Promise<void> {
    if (q.length < 1) {
      dropdown.classList.add("hidden");
      return;
    }
    // Single-character company search is noisy; tickers can be 1–2 chars (F, GM).
    if (q.length < 2 && !TICKER_TOKEN.test(q)) {
      dropdown.classList.add("hidden");
      return;
    }

    const rows = await fetchSearchRows(q);
    if (searchAbort?.signal.aborted) return;
    renderResults(rows);
  }

  async function handleTypedValue(): Promise<void> {
    const { done, rest } = parseCommaInput(input.value);
    if (done.length) {
      input.value = rest;
      dropdown.classList.add("hidden");
      await commitTokens(done);
    }
    const q = input.value.trim();
    if (q) await search(q);
    else dropdown.classList.add("hidden");
  }

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    // Commit completed comma segments promptly; debounce only the live search.
    if (input.value.includes(",")) {
      debounce = setTimeout(() => void handleTypedValue(), 120);
      return;
    }
    debounce = setTimeout(() => void handleTypedValue(), 320);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    clearTimeout(debounce);
    const { done, rest } = parseCommaInput(input.value);
    const tokens = [...done, rest.trim()].filter(Boolean);
    void (async () => {
      if (tokens.length) {
        await commitTokens(tokens);
        input.value = "";
        dropdown.classList.add("hidden");
      } else if (state.picks.length && !hasReport) {
        submitBtn.click();
      }
    })();
  });

  document.addEventListener("click", (e) => {
    if (!searchWrap.contains(e.target as Node)) dropdown.classList.add("hidden");
  });

  initTurnstile();

  setTurnstileInteractiveHandler((interactive) => {
    if (!state.loading) return;
    submitBtn.textContent = interactive ? "Tap the check above" : "Verifying…";
  });

  function resetReportUi(): void {
    titleWrap.innerHTML = "";
    badgeStrip.innerHTML = "";
    companyProfiles.innerHTML = "";
    companyProfiles.classList.add("hidden");
    streamHero.classList.remove("hidden");
    bottomLine.className = "bottom-line loading";
    bottomLine.innerHTML =
      '<div class="skeleton-lines"><span></span><span></span><span></span></div>';
    scorecardWrap.innerHTML = "";
    reportBody.className = "report-body loading";
    reportBody.innerHTML =
      '<div class="skeleton-lines"><span></span><span></span><span></span><span></span></div>';
    asOfEl.classList.add("hidden");
  }

  /**
   * Concurrent reports tag every header with its ticker ("FUNDAMENTALS — CRWV")
   * so sections stay attributable. Repeating it on all nine headers of every
   * company reads as noise, so lift it into one divider per company instead.
   */
  function groupByTicker(container: HTMLElement, withDividers: boolean): void {
    let current = "";
    container.querySelectorAll("h2").forEach((h2) => {
      const match = (h2.textContent ?? "").match(
        /^(.*?)\s+—\s+([A-Z][A-Z0-9.\-]{0,11})$/
      );
      if (!match) return;

      const [, heading, ticker] = match;
      h2.textContent = heading;

      if (!withDividers) {
        const tag = el("span", "h2-ticker", ticker);
        h2.append(" ", tag);
        return;
      }
      if (ticker !== current) {
        current = ticker;
        h2.parentElement?.insertBefore(el("div", "ticker-divider", ticker), h2);
      }
    });
  }

  function setReportBody(html: string): void {
    reportBody.className = "report-body revealed";
    reportBody.innerHTML = html;
    groupByTicker(reportBody, true);
  }

  function renderBadgesInto(container: HTMLElement, badges: Badges): void {
    container.innerHTML = "";
    if (badges.recommendation) {
      const r = badges.recommendation.toLowerCase();
      container.append(
        el("span", `badge rec ${r}`, badges.recommendation)
      );
    }
    if (badges.sentiment) {
      const s = badges.sentiment.toLowerCase();
      container.append(
        el("span", `badge verdict ${s}`, badges.sentiment)
      );
    }
    if (badges.conviction) {
      container.append(
        el("span", "badge conf", `${badges.conviction} conviction`)
      );
    }
  }

  function renderBadges(badges: Badges): void {
    renderBadgesInto(badgeStrip, badges);
  }

  function hasScoreProfile(scores: Scorecard): boolean {
    return scores.overall != null || scores.growth != null;
  }

  async function openSimilarReport(
    symbol: string,
    scores: Scorecard,
    btn: HTMLButtonElement
  ): Promise<void> {
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Finding peers…";
    try {
      const params = new URLSearchParams({
        symbol,
        scores: JSON.stringify(scores),
        exclude: reportSymbols.join(","),
      });
      const res = await fetch(`/api/similar?${params}`);
      const data = (await res.json()) as { symbols?: string[]; error?: string };
      if (!res.ok || !data.symbols?.length) {
        throw new Error(data.error || "Couldn't find similar companies.");
      }

      // Turnstile must run in this click gesture; the new tab cannot solve it
      // on its own during autostart.
      btn.textContent = "Verifying…";
      const turnstileToken = await obtainTurnstileToken();

      const launchRes = await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: data.symbols.slice(0, 3),
          mode: "separate",
          directive: state.directive,
          profitHorizonYears: state.profitHorizonYears,
          turnstileToken,
        }),
      });
      resetTurnstile();

      const launch = (await launchRes.json()) as {
        launchId?: string;
        error?: string;
      };
      if (!launchRes.ok || !launch.launchId) {
        throw new Error(launch.error || "Couldn't open the similar report.");
      }

      const url = new URL(window.location.origin + "/");
      url.searchParams.set("launch", launch.launchId);
      url.searchParams.set("autostart", "1");
      url.searchParams.set("noSimilar", "1");
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    } catch (e) {
      resetTurnstile();
      showError(
        e instanceof Error ? e.message : "Couldn't find similar companies.",
        true
      );
    } finally {
      btn.disabled = false;
      btn.textContent = prev || "Show more like this";
    }
  }

  function renderCompanyProfiles(
    profiles: CompanyProfile[],
    mode: ReportMode
  ): void {
    if (!profiles.length) return;

    companyProfiles.innerHTML = "";
    const showSimilar =
      allowSimilar && mode === "separate" && !showingLayman;

    profiles.forEach((profile, index) => {
      const block = el("article", "company-profile");
      block.dataset.symbol = profile.symbol;

      const head = el("div", "company-profile-head");
      const badges = el("div", "badge-strip");
      renderBadgesInto(badges, profile.badges);

      if (showSimilar && hasScoreProfile(profile.scores)) {
        const btn = el("button", "btn ghost similar-btn");
        btn.type = "button";
        btn.textContent = "Show more like this";
        btn.onclick = () => void openSimilarReport(profile.symbol, profile.scores, btn);
        head.append(badges, btn);
      } else {
        head.append(badges);
      }

      const grid = el("div", "hero-grid");
      const bl = el("div", "bottom-line revealed");
      bl.innerHTML = profile.bottomLineHtml;
      groupByTicker(bl, false);

      const sc = el("div", "scorecard-wrap");
      if (profile.scorecardHtml) sc.innerHTML = profile.scorecardHtml;

      grid.append(bl, sc);
      block.append(head, grid);
      if (index > 0) block.classList.add("company-profile--follow");
      companyProfiles.append(block);
    });

    streamHero.classList.add("hidden");
    companyProfiles.classList.remove("hidden");

    const combinedBody = profiles.map((p) => p.bodyHtml).join("");
    setReportBody(combinedBody);

    fullView = {
      bodyHtml: reportBody.innerHTML,
      bottomLineHtml: profiles[0]?.bottomLineHtml ?? bottomLine.innerHTML,
    };
  }

  function applySticky(payload: {
    bottomLineHtml?: string;
    badges?: Badges;
    scorecardHtml?: string;
  }): void {
    if (payload.badges) renderBadges(payload.badges);
    if (payload.bottomLineHtml) {
      bottomLine.className = "bottom-line revealed";
      bottomLine.innerHTML = payload.bottomLineHtml;
      groupByTicker(bottomLine, false);
    }
    if (payload.scorecardHtml) {
      scorecardWrap.innerHTML = payload.scorecardHtml;
    }
  }

  async function consumeStream(
    res: Response,
    onEvent: (event: string, payload: Record<string, unknown>) => void
  ): Promise<void> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7);
          if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (!data) continue;
        onEvent(event, JSON.parse(data) as Record<string, unknown>);
      }
    }
  }

  async function runResearch(): Promise<void> {
    hideError();
    state.loading = true;
    hasReport = false;
    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying…";
    reportPanel.classList.remove("hidden");
    hidePostReportActions();
    badgeStrip.classList.remove("hidden");
    scorecardWrap.classList.remove("hidden");
    showingLayman = false;
    fullView = null;
    reportId = "";
    activeShareId = "";
    lastCompanies = [];
    resetReportUi();

    const mode =
      state.picks.length > 1 ? state.mode : ("separate" as ReportMode);
    reportMode = mode;
    reportSymbols = state.picks.map((p) => p.symbol);

    let turnstileToken = "";
    const launchId = pendingLaunchId;
    try {
      if (!launchId) {
        // Must run inside the click gesture on iOS Safari.
        turnstileToken = await obtainTurnstileToken();
      }
      submitBtn.textContent = "Generating…";

      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: state.picks.map((p) => p.symbol),
          mode,
          directive: state.directive,
          profitHorizonYears: state.profitHorizonYears,
          turnstileToken,
          launchId: launchId || undefined,
        }),
      });

      // Tokens are single-use — always refresh for the next attempt.
      if (!launchId) resetTurnstile();

      if (!res.ok) {
        const err = (await res.json()) as {
          error?: string;
          retry?: boolean;
          code?: string;
        };
        if (launchId) pendingLaunchId = launchId;
        if (err.code === "launch_expired") pendingLaunchId = "";
        showError(err.error || "Something went wrong.", err.retry !== false);
        return;
      }

      pendingLaunchId = "";

      await consumeStream(res, (event, payload) => {
        {
          if (event === "meta") {
            const symbols = payload.symbols as
              | Array<{ symbol: string; name: string }>
              | undefined;
            const title = el("h1", "report-title");
            title.textContent = symbols
              ? symbols.map((s) => s.symbol).join(" · ")
              : state.picks.map((p) => p.symbol).join(" · ");
            titleWrap.append(title);

            const skipped = (payload.skipped as string[] | undefined) ?? [];
            const notes: string[] = [];
            if (payload.showAsOf) notes.push(`Data as of ${payload.asOf} ET`);
            if (skipped.length) {
              notes.push(`No data for ${skipped.join(", ")} — left out of this report.`);
            }
            const degraded = (payload.degraded as string[] | undefined) ?? [];
            if (degraded.length) {
              notes.push(`Limited data for ${degraded.join(", ")} — price only.`);
            }
            if (notes.length) {
              asOfEl.textContent = notes.join(" · ");
              asOfEl.classList.remove("hidden");
            }

            const directiveId = payload.directive as string | undefined;
            const directiveName =
              (payload.directiveLabel as string | undefined) ??
              (directiveId ? directiveLabel(directiveId as InvestmentDirectiveId) : "");
            if (directiveName) {
              const tag = el("p", "directive-tag");
              const horizon = payload.profitHorizonYears as number | undefined;
              const horizonNote =
                horizon != null
                  ? ` · Profit window: ${profitHorizonLabel(horizon)}`
                  : "";
              tag.textContent = `Goal: ${directiveName}${horizonNote}`;
              titleWrap.append(tag);
            }
          }

          if (event === "sticky") {
            applySticky(payload as Parameters<typeof applySticky>[0]);
          }

          if (event === "body") {
            setReportBody(String(payload.html ?? ""));
          }

          if (event === "badges") {
            renderBadges(payload as Badges);
          }

          if (event === "companies") {
            const companies = payload.companies as CompanyProfile[] | undefined;
            const mode = (payload.mode as ReportMode | undefined) ?? reportMode;
            if (companies?.length) {
              lastCompanies = companies;
              renderCompanyProfiles(companies, mode);
            }
          }

          if (event === "done") {
            reportId = String(payload.reportId ?? "");
            if (!companyProfiles.classList.contains("hidden")) {
              fullView = {
                bodyHtml: reportBody.innerHTML,
                bottomLineHtml: companyProfiles.querySelector(".bottom-line")?.innerHTML ?? "",
              };
            } else {
              fullView = {
                bodyHtml: reportBody.innerHTML,
                bottomLineHtml: bottomLine.innerHTML,
              };
            }
            showingLayman = false;
            simplifyBtn.textContent = "Explain in Lay Terms";
            hasReport = true;
            showPostReportActions();
          }

          if (event === "error") {
            showError(String(payload.error), payload.retry !== false);
          }
        }
      });
    } catch (e) {
      resetTurnstile();
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "The market is meditating a bit too hard. Try again?";
      showError(msg, true);
    } finally {
      state.loading = false;
      syncPrimaryBtn();
    }
  }

  function startNewReport(): void {
    state.picks = [];
    state.mode = "separate";
    state.inputMode = "manual";
    state.directive = loadStoredDirective();
    state.profitHorizonYears = loadStoredProfitHorizon(state.directive);
    state.discoverResults = [];
    state.discoverSelected.clear();
    setInputMode("manual");
    reportId = "";
    activeShareId = "";
    pendingLaunchId = "";
    hasReport = false;
    fullView = null;
    showingLayman = false;
    lastCompanies = [];
    renderChips();
    hideError();
    reportPanel.classList.add("hidden");
    resetReportUi();
    badgeStrip.classList.remove("hidden");
    scorecardWrap.classList.remove("hidden");
    hidePostReportActions();
    clearShareUrlInAddressBar();
    input.value = "";
    dropdown.classList.add("hidden");
    syncPrimaryBtn();
    input.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  submitBtn.onclick = () => {
    if (hasReport) {
      startNewReport();
      return;
    }
    if (state.inputMode === "discover") {
      syncPicksFromDiscover();
    }
    if (state.picks.length === 0) {
      showError(
        state.inputMode === "discover"
          ? "Find stocks for your goal first, then select up to 4."
          : "Add at least one ticker.",
        false
      );
      return;
    }
    if (state.picks.length > 1) {
      modal.classList.remove("hidden");
      return;
    }
    state.mode = "separate";
    runResearch();
  };

  modal.querySelector("#modal-cancel")!.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  modal.querySelector("#modal-confirm")!.addEventListener("click", () => {
    const selected = modal.querySelector(
      'input[name="mode"]:checked'
    ) as HTMLInputElement;
    state.mode = selected.value as ReportMode;
    modal.classList.add("hidden");
    runResearch();
  });

  function saveAsPdf(): void {
    closeShareMenu();
    reportPanel.dataset.printDate = new Date().toLocaleString();
    window.print();
  }

  async function shareLinkNative(): Promise<void> {
    closeShareMenu();
    let url: string;
    try {
      url = await createShareLink();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Couldn't create share link.", true);
      return;
    }
    const title = titleWrap.querySelector(".report-title")?.textContent?.trim();
    const shareData: ShareData = {
      title: title ? `ZenBuy: ${title}` : "ZenBuy report",
      text: "Investment research from ZenBuy.info — not financial advice.",
      url,
    };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }
    } catch (e) {
      // User cancelled the sheet — not an error.
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
    await copyShareLink();
  }

  async function copyShareLink(): Promise<void> {
    closeShareMenu();
    let url: string;
    try {
      url = await createShareLink();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Couldn't create share link.", true);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = "Link copied";
      window.setTimeout(() => {
        shareBtn.textContent = "Share";
      }, 1600);
    } catch {
      window.prompt("Copy this share link:", url);
    }
  }

  shareBtn.onclick = (e) => {
    e.stopPropagation();
    const open = shareMenu.classList.toggle("hidden") === false;
    shareBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  shareMenu.querySelectorAll<HTMLButtonElement>("[data-share]").forEach((btn) => {
    btn.onclick = () => {
      const action = btn.dataset.share;
      if (action === "link") void shareLinkNative();
      else if (action === "copy") void copyShareLink();
      else if (action === "pdf") saveAsPdf();
    };
  });

  document.addEventListener("click", (e) => {
    if (!shareWrap.contains(e.target as Node)) closeShareMenu();
  });

  async function runSimplify(): Promise<void> {
    // Second press returns to the analyst report — no need to refetch.
    if (showingLayman && fullView) {
      renderCompanyProfiles(lastCompanies, reportMode);
      showingLayman = false;
      activeShareId = "";
      simplifyBtn.textContent = "Explain in Lay Terms";
      return;
    }

    hideError();
    simplifyBtn.disabled = true;
    simplifyBtn.textContent = "Rewriting…";
    companyProfiles.classList.add("hidden");
    streamHero.classList.remove("hidden");

    try {
      const res = await fetch("/api/simplify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string; retry?: boolean };
        showError(err.error || "Couldn't simplify that report.", err.retry !== false);
        return;
      }

      // A plain-English rewrite has no scorecard or verdict badges.
      badgeStrip.classList.add("hidden");
      scorecardWrap.classList.add("hidden");

      await consumeStream(res, (event, payload) => {
        if (event === "sticky") {
          applySticky(payload as Parameters<typeof applySticky>[0]);
        }
        if (event === "body") {
          setReportBody(String(payload.html ?? ""));
        }
        if (event === "done") {
          showingLayman = true;
          activeShareId = "";
          simplifyBtn.textContent = "Show full report";
        }
        if (event === "error") {
          showError(String(payload.error), payload.retry !== false);
        }
      });
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "The rewrite wandered off. Try again?";
      showError(msg, true);
    } finally {
      simplifyBtn.disabled = false;
      if (!showingLayman) simplifyBtn.textContent = "Explain in Lay Terms";
    }
  }

  simplifyBtn.onclick = () => void runSimplify();

  function showSharedLoadError(message: string): void {
    titleWrap.innerHTML = "";
    badgeStrip.innerHTML = "";
    scorecardWrap.innerHTML = "";
    bottomLine.className = "bottom-line";
    bottomLine.innerHTML = "";
    const title = el("h1", "report-title");
    title.textContent = "Link unavailable";
    titleWrap.append(title);
    reportBody.className = "report-body revealed shared-error-body";
    reportBody.innerHTML = `<p>${message}</p><p class="shared-error-hint">Shared links stay live for 7 days. Generate a fresh report below.</p>`;
    hasReport = false;
    hidePostReportActions();
  }

  async function loadSharedReport(id: string): Promise<void> {
    hideError();
    submitBtn.disabled = true;
    submitBtn.textContent = "Loading…";
    reportPanel.classList.remove("hidden");
    hidePostReportActions();
    resetReportUi();

    try {
      const res = await fetch(`/api/report?id=${encodeURIComponent(id)}`);
      const data = (await res.json()) as {
        error?: string;
        reportId?: string;
        shareId?: string;
        variant?: "full" | "layman";
        symbols?: string[];
        badges?: Badges;
        bottomLineHtml?: string;
        bodyHtml?: string;
        scorecardHtml?: string;
        companies?: CompanyProfile[];
        mode?: ReportMode;
        asOf?: string;
        stale?: boolean;
      };

      if (!res.ok) {
        showSharedLoadError(
          data.error || "This shared report couldn't be loaded."
        );
        return;
      }

      reportId = String(data.reportId ?? id);
      activeShareId = data.shareId ?? (id.startsWith("share:") ? id : "");
      reportSymbols = data.symbols ?? [];
      reportMode = data.mode ?? "separate";
      const isLayman = data.variant === "layman";
      state.picks = (data.symbols ?? []).map((symbol) => ({
        symbol,
        name: symbol,
      }));
      renderChips();

      const title = el("h1", "report-title");
      title.textContent = (data.symbols ?? []).join(" · ") || "Shared report";
      titleWrap.append(title);

      if (
        !isLayman &&
        data.companies?.length &&
        data.mode === "separate"
      ) {
        lastCompanies = data.companies;
        renderCompanyProfiles(data.companies, data.mode);
      } else {
        if (isLayman) {
          badgeStrip.classList.add("hidden");
          scorecardWrap.classList.add("hidden");
          companyProfiles.classList.add("hidden");
          streamHero.classList.remove("hidden");
        } else {
          badgeStrip.classList.remove("hidden");
          scorecardWrap.classList.remove("hidden");
        }

        applySticky({
          bottomLineHtml: data.bottomLineHtml,
          badges: isLayman ? {} : data.badges,
          scorecardHtml: isLayman ? "" : data.scorecardHtml,
        });
        if (data.bodyHtml) setReportBody(data.bodyHtml);

        fullView = isLayman
          ? null
          : {
              bodyHtml: reportBody.innerHTML,
              bottomLineHtml: bottomLine.innerHTML,
            };
      }
      if (data.stale && data.asOf) {
        asOfEl.textContent = `Data as of ${data.asOf}`;
        asOfEl.classList.remove("hidden");
      }

      showingLayman = isLayman;
      simplifyBtn.textContent = isLayman
        ? "Show full report"
        : "Explain in Lay Terms";
      hasReport = true;
      showPostReportActions();
      reportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      showSharedLoadError("This shared report couldn't be loaded.");
    } finally {
      syncPrimaryBtn();
    }
  }

  const sharedId = new URLSearchParams(window.location.search).get("r")?.trim();
  if (
    sharedId?.startsWith("report:") ||
    sharedId?.startsWith("share:") ||
    sharedId?.startsWith("layman:")
  ) {
    void loadSharedReport(sharedId);
  } else {
    void maybeAutostartFromUrl();
  }

  async function maybeAutostartFromUrl(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    if (params.get("noSimilar") === "1") allowSimilar = false;

    const directiveParam = params.get("directive");
    if (directiveParam && isInvestmentDirectiveId(directiveParam)) {
      state.directive = directiveParam;
      state.profitHorizonYears = loadStoredProfitHorizon(state.directive);
      mountDirectivePanel(
        directiveMount,
        state.directive,
        state.profitHorizonYears,
        (id) => {
          state.directive = id;
        },
        (years) => {
          state.profitHorizonYears = years;
        }
      );
    }

    const launchId = params.get("launch")?.trim();
    if (params.get("autostart") === "1" && launchId) {
      try {
        const res = await fetch(
          `/api/launch?id=${encodeURIComponent(launchId)}`
        );
        const data = (await res.json()) as {
          symbols?: string[];
          mode?: ReportMode;
          directive?: string;
          profitHorizonYears?: number;
          error?: string;
        };
        if (!res.ok || !data.symbols?.length) {
          throw new Error(data.error || "Launch link expired.");
        }

        if (data.directive && isInvestmentDirectiveId(data.directive)) {
          state.directive = data.directive;
        }
        if (data.profitHorizonYears != null) {
          state.profitHorizonYears = data.profitHorizonYears;
        }

        state.picks = data.symbols.slice(0, 4).map((symbol) => ({
          symbol,
          name: symbol,
        }));
        state.mode = data.mode ?? "separate";
        pendingLaunchId = launchId;
        renderChips();

        if (window.history.replaceState) {
          const clean = new URL(window.location.href);
          clean.searchParams.delete("launch");
          clean.searchParams.delete("autostart");
          clean.searchParams.delete("noSimilar");
          window.history.replaceState({}, "", clean.toString());
        }

        void runResearch();
      } catch (e) {
        showError(
          e instanceof Error
            ? e.message
            : "This link expired. Use Show more like this again.",
          true
        );
      }
      return;
    }

    // Legacy ?symbols=&autostart= links: prefill only — Turnstile needs a tap.
    const symbols = (params.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s));

    if (params.get("autostart") !== "1" || !symbols.length) return;

    state.picks = symbols.slice(0, 4).map((symbol) => ({ symbol, name: symbol }));
    state.mode = "separate";
    renderChips();

    if (window.history.replaceState) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("symbols");
      clean.searchParams.delete("autostart");
      window.history.replaceState({}, "", clean.toString());
    }
  }

  renderChips();
}
