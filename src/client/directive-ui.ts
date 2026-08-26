import {
  DEFAULT_DIRECTIVE_ID,
  INVESTMENT_DIRECTIVES,
  isInvestmentDirectiveId,
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

export function mountDirectivePanel(
  container: HTMLElement,
  initial: InvestmentDirectiveId,
  onChange: (id: InvestmentDirectiveId) => void
): void {
  container.innerHTML = `
    <div class="directive-panel">
      <h2 class="directive-heading" id="directive-heading">What's your investing goal?</h2>
      <p class="directive-lead">
        Pick the style that matches how long you can wait and how much risk feels OK.
        We'll tailor every report to that — no finance degree required.
      </p>
      <div class="directive-options" role="radiogroup" aria-labelledby="directive-heading">
        ${INVESTMENT_DIRECTIVES.map(
          (d) => `
          <label class="directive-option">
            <input type="radio" name="investment-directive" value="${d.id}" ${
              d.id === initial ? "checked" : ""
            } />
            <span class="directive-card">
              <span class="directive-card-head">
                <strong class="directive-label">${d.label}</strong>
                <span class="directive-headline">${d.headline}</span>
              </span>
              <span class="directive-best-if"><strong>Best if:</strong> ${d.bestIf}</span>
              <p class="directive-plain">${d.plainEnglish}</p>
              <dl class="directive-stats">
                <div><dt>Typical wait</dt><dd>${d.horizon}</dd></div>
                <div><dt>Risk</dt><dd>${d.risk}</dd></div>
                <div><dt>Income</dt><dd>${d.incomeFocus}</dd></div>
              </dl>
              <p class="directive-example"><strong>Example:</strong> ${d.exampleGoal}</p>
            </span>
          </label>`
        ).join("")}
      </div>
    </div>
  `;

  container
    .querySelectorAll<HTMLInputElement>('input[name="investment-directive"]')
    .forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked || !isInvestmentDirectiveId(input.value)) return;
        saveStoredDirective(input.value);
        onChange(input.value);
      });
    });
}

export function directiveLabel(id: InvestmentDirectiveId): string {
  return INVESTMENT_DIRECTIVES.find((d) => d.id === id)?.label ?? id;
}
