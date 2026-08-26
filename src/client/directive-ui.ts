import {
  DEFAULT_DIRECTIVE_ID,
  INVESTMENT_DIRECTIVES,
  isInvestmentDirectiveId,
  type InvestmentDirective,
  type InvestmentDirectiveId,
} from "../lib/investment-directives";

const STORAGE_KEY = "zenbuy:directive:v1";

export function loadStoredDirective(): InvestmentDirectiveId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isInvestmentDirectiveId(raw)) return raw;
  } catch {
    /* private mode / quota */
  }
  return DEFAULT_DIRECTIVE_ID;
}

export function saveStoredDirective(id: InvestmentDirectiveId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

function pillLabel(d: InvestmentDirective): string {
  if (d.id === "growth_income") return "Growth/Income";
  if (d.id === "value_income") return "Value/Income";
  return d.label;
}

function detailHtml(d: InvestmentDirective): string {
  return `
    <p class="directive-detail-lead">${d.headline}</p>
    <p>${d.detailProfile}</p>
    <dl class="directive-detail-stats">
      <div><dt>Typical wait</dt><dd>${d.horizon}</dd></div>
      <div><dt>Risk</dt><dd>${d.risk}</dd></div>
      <div><dt>Income</dt><dd>${d.incomeFocus}</dd></div>
    </dl>
    <p class="directive-detail-example"><strong>Example:</strong> ${d.exampleGoal}</p>
  `;
}

export function mountDirectivePanel(
  container: HTMLElement,
  initial: InvestmentDirectiveId,
  onChange: (id: InvestmentDirectiveId) => void
): void {
  container.innerHTML = `
    <div class="directive-panel">
      <h2 class="directive-heading" id="directive-heading">What's your goal?</h2>
      <p class="directive-lead">Tap a strategy — <span class="directive-lead-hint">i</span> for details.</p>
      <div class="directive-pills" role="radiogroup" aria-labelledby="directive-heading">
        ${INVESTMENT_DIRECTIVES.map(
          (d) => `
          <label class="directive-pill${d.id === initial ? " is-selected" : ""}">
            <input type="radio" name="investment-directive" value="${d.id}" ${
              d.id === initial ? "checked" : ""
            } />
            <span class="directive-pill-text">${pillLabel(d)}</span>
            <button type="button" class="directive-info" data-directive-id="${d.id}" aria-label="About ${d.label}">i</button>
          </label>`
        ).join("")}
      </div>
    </div>
    <dialog class="directive-detail-dialog" aria-labelledby="directive-detail-title">
      <div class="directive-detail-inner">
        <header class="directive-detail-header">
          <h3 id="directive-detail-title"></h3>
          <button type="button" class="directive-detail-close" aria-label="Close">×</button>
        </header>
        <div class="directive-detail-body"></div>
      </div>
    </dialog>
  `;

  const dialog = container.querySelector<HTMLDialogElement>(".directive-detail-dialog")!;
  const titleEl = dialog.querySelector<HTMLHeadingElement>("#directive-detail-title")!;
  const bodyEl = dialog.querySelector<HTMLDivElement>(".directive-detail-body")!;
  const pills = container.querySelectorAll<HTMLLabelElement>(".directive-pill");

  const syncSelected = (id: InvestmentDirectiveId): void => {
    pills.forEach((pill) => {
      const input = pill.querySelector<HTMLInputElement>('input[type="radio"]');
      pill.classList.toggle("is-selected", input?.value === id);
    });
  };

  const openDetail = (d: InvestmentDirective): void => {
    titleEl.textContent = d.label;
    bodyEl.innerHTML = detailHtml(d);
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  };

  container
    .querySelectorAll<HTMLInputElement>('input[name="investment-directive"]')
    .forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked || !isInvestmentDirectiveId(input.value)) return;
        saveStoredDirective(input.value);
        syncSelected(input.value);
        onChange(input.value);
      });
    });

  container.querySelectorAll<HTMLButtonElement>(".directive-info").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.directiveId;
      const d = INVESTMENT_DIRECTIVES.find((x) => x.id === id);
      if (d) openDetail(d);
    });
  });

  dialog.querySelector(".directive-detail-close")?.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}

export function directiveLabel(id: InvestmentDirectiveId): string {
  return INVESTMENT_DIRECTIVES.find((d) => d.id === id)?.label ?? id;
}
