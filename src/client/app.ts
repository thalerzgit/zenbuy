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
      <span class="brand-mark" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="44" height="44">
          <defs>
            <linearGradient id="zb-header-arch" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="100%" stop-color="#e8f4e5"/>
            </linearGradient>
          </defs>
          <path d="M8 38V18Q24 6 40 18V38" fill="none" stroke="url(#zb-header-arch)" stroke-width="2.4" stroke-linecap="round"/>
          <path d="M10 36H38" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M13 31L19 26L25 22L33 14" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="16.5" y="24" width="3" height="6" rx="0.8" fill="#ffffff" opacity="0.55"/>
          <rect x="22.5" y="20" width="3" height="6" rx="0.8" fill="#ffffff" opacity="0.75"/>
          <rect x="28.5" y="14" width="3" height="5" rx="0.8" fill="#ffffff"/>
          <circle cx="33" cy="14" r="6" fill="#c9a227" opacity="0.25"/>
          <circle cx="33" cy="14" r="2.6" fill="#c9a227"/>
          <circle cx="33" cy="14" r="1.1" fill="#fff8e7"/>
        </svg>
      </span>
      <span class="brand-lockup">
        <span class="brand-name">ZenBuy<span class="brand-tld">.info</span></span>
        <span class="brand-oracle">The insight you wished you had—earlier.</span>
        <span class="brand-tag">Know before you trade</span>
      </span>
    </a>
  `;

  const main = el("main", "site-main");
  const searchWrap = el("section", "search-panel");
  searchWrap.innerHTML = `
    <label class="search-label" for="symbol-input">Ticker or company name</label>
    <div class="search-row">
      <input id="symbol-input" type="text" autocomplete="off" placeholder="AAPL, Apple, Palo Alto…" maxlength="64" />
      <div id="dropdown" class="dropdown hidden" role="listbox"></div>
    </div>
    <div id="chips" class="chips"></div>
    <div class="actions">
      <button id="submit-btn" type="button" class="btn primary" disabled>Generate report</button>
      <button id="simplify-btn" type="button" class="btn ghost hidden">Explain in Lay Terms</button>
      <button id="print-btn" type="button" class="btn ghost hidden">Export PDF</button>
      <button id="reset-btn" type="button" class="btn ghost hidden">Start New Report</button>
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

  const input = searchWrap.querySelector("#symbol-input") as HTMLInputElement;
  const dropdown = searchWrap.querySelector("#dropdown") as HTMLDivElement;
  const chips = searchWrap.querySelector("#chips") as HTMLDivElement;
  const submitBtn = searchWrap.querySelector("#submit-btn") as HTMLButtonElement;
  const printBtn = searchWrap.querySelector("#print-btn") as HTMLButtonElement;
  const simplifyBtn = searchWrap.querySelector(
    "#simplify-btn"
  ) as HTMLButtonElement;
  const resetBtn = searchWrap.querySelector("#reset-btn") as HTMLButtonElement;
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
  /** Snapshot of the analyst report so the lay rewrite can be toggled off. */
  let fullView: { bodyHtml: string; bottomLineHtml: string } | null = null;
  let showingLayman = false;
  const searchCache = new Map<string, Array<{ symbol: string; name: string }>>();

  function renderChips(): void {
    chips.innerHTML = "";
    state.picks.forEach((pick) => {
      const chip = el("span", "chip");
      chip.innerHTML = `<strong>${pick.symbol}</strong> ${pick.name}
        <button type="button" aria-label="Remove ${pick.symbol}">×</button>`;
      chip.querySelector("button")!.onclick = () => {
        state.picks = state.picks.filter((p) => p.symbol !== pick.symbol);
        renderChips();
        submitBtn.disabled = state.picks.length === 0 || state.loading;
      };
      chips.append(chip);
    });
    submitBtn.disabled = state.picks.length === 0 || state.loading;
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
        if (state.picks.length >= 4) return;
        if (state.picks.some((p) => p.symbol === row.symbol)) return;
        state.picks.push({ symbol: row.symbol, name: row.name });
        renderChips();
        input.value = "";
        dropdown.classList.add("hidden");

        // Warm the slow parts now rather than after the Generate tap.
        void fetch(
          `/api/prefetch?symbol=${encodeURIComponent(row.symbol)}`
        ).catch(() => {});
        warmTurnstileToken();
      };
      dropdown.append(item);
    });
    dropdown.classList.remove("hidden");
  }

  async function search(q: string): Promise<void> {
    if (q.length < 2) {
      dropdown.classList.add("hidden");
      return;
    }

    const memo = searchCache.get(q.toLowerCase());
    if (memo) {
      renderResults(memo);
      return;
    }

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
      // Don't memoize throttled misses — they'd stick as "no matches".
      if (!data.throttled) searchCache.set(q.toLowerCase(), rows);
      renderResults(rows);
    } catch {
      if (!ctrl.signal.aborted) dropdown.classList.add("hidden");
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => search(input.value.trim()), 320);
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
    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying…";
    reportPanel.classList.remove("hidden");
    printBtn.classList.add("hidden");
    simplifyBtn.classList.add("hidden");
    resetBtn.classList.add("hidden");
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
            if (payload.showAsOf) notes.push(`Data as of ${payload.asOf}`);
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
            printBtn.classList.remove("hidden");
            resetBtn.classList.remove("hidden");
            // Needs the cached report on the server to rewrite from.
            if (reportId) simplifyBtn.classList.remove("hidden");
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
      submitBtn.textContent = "Generate report";
      submitBtn.disabled = state.picks.length === 0;
    }
  }

  submitBtn.onclick = () => {
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

  printBtn.onclick = () => {
    reportPanel.dataset.printDate = new Date().toLocaleString();
    window.print();
  };

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
    simplifyBtn.textContent = "Verifying…";

    try {
      const turnstileToken = await obtainTurnstileToken();
      simplifyBtn.textContent = "Rewriting…";

      const res = await fetch("/api/simplify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, turnstileToken }),
      });

      resetTurnstile();

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
      resetTurnstile();
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

  resetBtn.onclick = () => {
    state.picks = [];
    state.mode = "separate";
    reportId = "";
    fullView = null;
    showingLayman = false;
    renderChips();
    hideError();
    reportPanel.classList.add("hidden");
    resetReportUi();
    badgeStrip.classList.remove("hidden");
    scorecardWrap.classList.remove("hidden");
    printBtn.classList.add("hidden");
    resetBtn.classList.add("hidden");
    simplifyBtn.classList.add("hidden");
    simplifyBtn.textContent = "Explain in Lay Terms";
    input.value = "";
    dropdown.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "Generate report";
    input.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  renderChips();
}
