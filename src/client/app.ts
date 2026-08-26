import { BRAND_MARK_SVG } from "./brand-mark";
import { startOracleRotation } from "./quotes";
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

interface Badges {
  recommendation?: string;
  sentiment?: string;
  conviction?: string;
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
    loading: false,
  };

  const header = el("header", "site-header");
  header.innerHTML = `
    <a class="brand" href="/" aria-label="ZenBuy.info home">
      <span class="brand-mark" aria-hidden="true">${BRAND_MARK_SVG}</span>
      <span class="brand-lockup">
        <span class="brand-name">ZenBuy<span class="brand-tld">.info</span></span>
        <span class="brand-oracle" id="brand-oracle" aria-live="polite">The insight you wished you had—earlier.</span>
        <span class="brand-tag">Know before you trade</span>
      </span>
    </a>
  `;

  const main = el("main", "site-main");
  const searchWrap = el("section", "search-panel");
  searchWrap.innerHTML = `
    <label class="search-label" for="symbol-input">Ticker(s) or Corp. Name</label>
    <div class="search-row">
      <input id="symbol-input" type="text" autocomplete="off" placeholder="AAPL, NVDA, Apple…" maxlength="96" />
      <div id="dropdown" class="dropdown hidden" role="listbox"></div>
    </div>
    <div id="chips" class="chips"></div>
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
      <div class="hero-head">
        <div id="report-title-wrap"></div>
        <div id="badge-strip" class="badge-strip"></div>
      </div>
      <div class="hero-grid">
        <div id="bottom-line" class="bottom-line loading">
          <div class="skeleton-lines"><span></span><span></span><span></span></div>
        </div>
        <div id="scorecard-wrap" class="scorecard-wrap"></div>
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
  const searchCache = new Map<string, Array<{ symbol: string; name: string }>>();

  function shareUrl(): string {
    if (!reportId) return window.location.origin + "/";
    const url = new URL(window.location.origin + "/");
    url.searchParams.set("r", reportId);
    return url.toString();
  }

  function setShareUrlInAddressBar(): void {
    if (!reportId || !window.history.replaceState) return;
    const url = new URL(window.location.href);
    url.searchParams.set("r", reportId);
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
    } else {
      submitBtn.textContent = "Generate Report";
      submitBtn.disabled = state.picks.length === 0;
    }
  }

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

  function renderBadges(badges: Badges): void {
    badgeStrip.innerHTML = "";
    if (badges.recommendation) {
      const r = badges.recommendation.toLowerCase();
      badgeStrip.append(
        el("span", `badge rec ${r}`, badges.recommendation)
      );
    }
    if (badges.sentiment) {
      const s = badges.sentiment.toLowerCase();
      badgeStrip.append(
        el("span", `badge verdict ${s}`, badges.sentiment)
      );
    }
    if (badges.conviction) {
      badgeStrip.append(
        el("span", "badge conf", `${badges.conviction} conviction`)
      );
    }
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
    resetReportUi();

    const mode =
      state.picks.length > 1 ? state.mode : ("separate" as ReportMode);

    let turnstileToken = "";
    try {
      // Must run inside the click gesture on iOS Safari.
      turnstileToken = await obtainTurnstileToken();
      submitBtn.textContent = "Generating…";

      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: state.picks.map((p) => p.symbol),
          mode,
          turnstileToken,
        }),
      });

      // Tokens are single-use — always refresh for the next attempt.
      resetTurnstile();

      if (!res.ok) {
        const err = (await res.json()) as { error?: string; retry?: boolean };
        showError(err.error || "Something went wrong.", err.retry !== false);
        return;
      }

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

          if (event === "done") {
            reportId = String(payload.reportId ?? "");
            fullView = {
              bodyHtml: reportBody.innerHTML,
              bottomLineHtml: bottomLine.innerHTML,
            };
            showingLayman = false;
            simplifyBtn.textContent = "Explain in Lay Terms";
            hasReport = true;
            showPostReportActions();
            setShareUrlInAddressBar();
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
    reportId = "";
    hasReport = false;
    fullView = null;
    showingLayman = false;
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
    const url = shareUrl();
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
    const url = shareUrl();
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
      reportBody.innerHTML = fullView.bodyHtml;
      bottomLine.innerHTML = fullView.bottomLineHtml;
      badgeStrip.classList.remove("hidden");
      scorecardWrap.classList.remove("hidden");
      showingLayman = false;
      simplifyBtn.textContent = "Explain in Lay Terms";
      return;
    }

    hideError();
    simplifyBtn.disabled = true;
    simplifyBtn.textContent = "Rewriting…";

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
        symbols?: string[];
        badges?: Badges;
        bottomLineHtml?: string;
        bodyHtml?: string;
        scorecardHtml?: string;
        asOf?: string;
        stale?: boolean;
      };

      if (!res.ok) {
        showError(data.error || "Couldn't open that shared report.", true);
        reportPanel.classList.add("hidden");
        return;
      }

      reportId = String(data.reportId ?? id);
      state.picks = (data.symbols ?? []).map((symbol) => ({
        symbol,
        name: symbol,
      }));
      renderChips();

      const title = el("h1", "report-title");
      title.textContent = (data.symbols ?? []).join(" · ") || "Shared report";
      titleWrap.append(title);

      applySticky({
        bottomLineHtml: data.bottomLineHtml,
        badges: data.badges,
        scorecardHtml: data.scorecardHtml,
      });
      if (data.bodyHtml) setReportBody(data.bodyHtml);

      if (data.stale && data.asOf) {
        asOfEl.textContent = `Data as of ${data.asOf}`;
        asOfEl.classList.remove("hidden");
      }

      fullView = {
        bodyHtml: reportBody.innerHTML,
        bottomLineHtml: bottomLine.innerHTML,
      };
      showingLayman = false;
      hasReport = true;
      showPostReportActions();
      setShareUrlInAddressBar();
      reportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      showError("Couldn't open that shared report.", true);
      reportPanel.classList.add("hidden");
    } finally {
      syncPrimaryBtn();
    }
  }

  const sharedId = new URLSearchParams(window.location.search).get("r")?.trim();
  if (sharedId?.startsWith("report:")) {
    void loadSharedReport(sharedId);
  }

  renderChips();
}
