/** Investor quotes shown while research / simplify runs (from prior production bundle). */
export interface ProcessingQuote {
  text: string;
  author: string;
}

export const PROCESSING_QUOTES: readonly ProcessingQuote[] = [
  {
    text: "In the short run, the market is a voting machine but in the long run, it is a weighing machine.",
    author: "Benjamin Graham",
  },
  {
    text: "The intelligent investor is a realist who sells to optimists and buys from pessimists.",
    author: "Benjamin Graham",
  },
  {
    text: "The essence of investment management is the management of risks, not the management of returns.",
    author: "Benjamin Graham",
  },
  {
    text: "Price is what you pay. Value is what you get.",
    author: "Warren Buffett",
  },
  {
    text: "Risk comes from not knowing what you're doing.",
    author: "Warren Buffett",
  },
  {
    text: "It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price.",
    author: "Warren Buffett",
  },
  {
    text: "Be fearful when others are greedy and greedy when others are fearful.",
    author: "Warren Buffett",
  },
  {
    text: "Our favorite holding period is forever.",
    author: "Warren Buffett",
  },
  {
    text: "The big money is not in the buying and selling, but in the waiting.",
    author: "Charlie Munger",
  },
  {
    text: "A great business at a fair price is superior to a fair business at a great price.",
    author: "Charlie Munger",
  },
  {
    text: "Invert, always invert: turn a situation or problem upside down. Look at it backward.",
    author: "Charlie Munger",
  },
  {
    text: "It is remarkable how much long-term advantage people like us have gotten by trying to be consistently not stupid, instead of trying to be very intelligent.",
    author: "Charlie Munger",
  },
  {
    text: "Know what you own, and know why you own it.",
    author: "Peter Lynch",
  },
  {
    text: "Go for a business that any idiot can run — because sooner or later, any idiot probably is going to run it.",
    author: "Peter Lynch",
  },
  {
    text: "The person that turns over the most rocks wins the game. And that's always been my philosophy.",
    author: "Peter Lynch",
  },
  {
    text: "In this business, if you're good, you're right six times out of ten. You're never going to be right nine times out of ten.",
    author: "Peter Lynch",
  },
  {
    text: "You can't predict. You can prepare.",
    author: "Howard Marks",
  },
  {
    text: "The most dangerous thing is to buy something at the peak of its popularity.",
    author: "Howard Marks",
  },
  {
    text: "When everyone believes something is riskless, the risk is at its greatest.",
    author: "Howard Marks",
  },
  {
    text: "Experience is what you got when you didn't get what you wanted.",
    author: "Howard Marks",
  },
  {
    text: "I would not want to be young without an education. I would not want to be old without money.",
    author: "David Morgenthaler",
  },
  {
    text: "Money doesn't matter much in life — unless you don't have it.",
    author: "David Morgenthaler",
  },
  {
    text: "Money can't buy happiness, but it can sure make you comfortable while looking for it.",
    author: "David Morgenthaler",
  },
  {
    text: "Risk is real. If you take enough of it, you are going to get burned.",
    author: "David Morgenthaler",
  },
  {
    text: "I am basically lazy and like to make money while I sleep. That's why I invest in stocks.",
    author: "David Morgenthaler",
  },
  {
    text: "They say you should buy stocks when there is blood in the street — but first check and be sure it's not YOUR blood!",
    author: "David Morgenthaler",
  },
  {
    text: "Not all my investments are winners. Lord knows, I've had my share of losers. That's why they put erasers on pencils.",
    author: "David Morgenthaler",
  },
  {
    text: 'Focus on compounding your money using the “Rule of 72.” Multiply the years by the percentage appreciation per year. When the product is 72, you have doubled your money.',
    author: "David Morgenthaler",
  },
  {
    text: "Investing, like horse-racing, is about the horse, the rider, and the race. The horse is the technology; the rider is the CEO; the race is the market. Don't compete in the county fair — compete in the Kentucky Derby, where the payoff is enormous.",
    author: "David Morgenthaler",
  },
  {
    text: "I know how to make money, and I know how to have fun. Whenever I try to combine the two, I don't make money, and I don't have fun.",
    author: "David Morgenthaler",
  },
  {
    text: "The wise investor can afford to buy only when the company is going through a temporary difficulty.",
    author: "Philip Fisher",
  },
  {
    text: "I don't want a lot of good investments; I want a few outstanding ones.",
    author: "Philip Fisher",
  },
  {
    text: "If the job has been correctly done when a common stock is purchased, the time to sell it is almost never.",
    author: "Philip Fisher",
  },
  {
    text: "The greatest investment reward comes to those who find the occasional company that can grow in sales and profits far more rapidly than industry as a whole.",
    author: "Philip Fisher",
  },
  {
    text: "Bull markets are born on pessimism, grow on skepticism, mature on optimism and die on euphoria.",
    author: "John Templeton",
  },
  {
    text: "The time of maximum pessimism is the best time to buy, and the time of maximum optimism is the best time to sell.",
    author: "John Templeton",
  },
  {
    text: "The four most dangerous words in investing are: 'This time it's different.'",
    author: "John Templeton",
  },
  {
    text: "If you want to have a better performance than the crowd, you must do things differently from the crowd.",
    author: "John Templeton",
  },
];

/** How long each quote stays on screen during report / simplify wait. */
export const QUOTE_ROTATION_MS = 5_000;

const PHASES = {
  preparing: "Preparing your research request…",
  fundamentals: "Pulling live fundamentals & peer data…",
  analysis: "Running valuation and thesis analysis…",
  drafting: "Drafting your research report…",
  finalizing: "Polishing scorecard & summary…",
  complete: "Report ready",
  simplifying: "Rewriting in plain English…",
} as const;

type Phase = keyof typeof PHASES;

/** Wall-clock estimate from the production controller (ms). */
export function estimateProcessingMs(
  symbolCount: number,
  mode: "separate" | "comparative" = "separate"
): number {
  if (mode === "comparative") return 105_000 + symbolCount * 20_000;
  if (symbolCount === 1) return 85_000;
  return 75_000 + symbolCount * 40_000;
}

function formatEta(remainingMs: number): string {
  if (remainingMs <= 5_000) return "Almost there…";
  const sec = Math.ceil(remainingMs / 1000);
  if (sec < 60) return `About ${sec}s remaining`;
  const min = Math.ceil(sec / 60);
  return min === 1 ? "About 1 min remaining" : `About ${min} min remaining`;
}

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface ProcessingController {
  start(
    symbolCount: number,
    mode?: "separate" | "comparative",
    phase?: Phase
  ): void;
  onMeta(): void;
  onSticky(): void;
  onBody(): void;
  onDone(): void;
  fail(): void;
  hide(): void;
  isVisible(): boolean;
}

/**
 * Restored from production bundle index-DHJ8ukXP.js (processing-panel).
 * Left-to-right 0–100% bar, ETA, and rotating attributed quotes.
 */
export function createProcessingController(
  root: HTMLElement
): ProcessingController {
  const panel = root.querySelector("#processing-panel") as HTMLElement;
  const phaseEl = root.querySelector("#processing-phase") as HTMLElement;
  const etaEl = root.querySelector("#processing-eta") as HTMLElement;
  const fillEl = root.querySelector("#progress-fill") as HTMLElement;
  const trackEl = root.querySelector(".progress-track") as HTMLElement;
  const quoteTextEl = root.querySelector("#quote-text") as HTMLElement;
  const quoteAuthorEl = root.querySelector("#quote-author") as HTMLElement;

  let startedAt = 0;
  let estimateMs = 90_000;
  let progress = 0;
  let floor = 0;
  let quoteIndex = 0;
  let quotes: ProcessingQuote[] = [];
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let quoteTimer: ReturnType<typeof setInterval> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const stopTimers = () => {
    if (tickTimer) clearInterval(tickTimer);
    if (quoteTimer) clearInterval(quoteTimer);
    if (hideTimer) clearTimeout(hideTimer);
    tickTimer = null;
    quoteTimer = null;
    hideTimer = null;
  };

  const setPhase = (phase: Phase) => {
    phaseEl.textContent = PHASES[phase];
  };

  const renderQuote = () => {
    if (!quotes.length) return;
    const q = quotes[quoteIndex % quotes.length];
    quoteTextEl.textContent = `"${q.text}"`;
    quoteAuthorEl.textContent = `— ${q.author}`;
  };

  const render = () => {
    const pct = Math.min(100, progress);
    fillEl.style.width = `${pct}%`;
    trackEl.setAttribute("aria-valuenow", String(Math.round(pct)));
    const remaining =
      Math.max(0, estimateMs - (Date.now() - startedAt)) * (1 - pct / 100);
    etaEl.textContent = pct >= 100 ? "Complete" : formatEta(remaining);
  };

  const tick = () => {
    const elapsed = Date.now() - startedAt;
    const timed = Math.min(92, (elapsed / estimateMs) * 92);
    progress = Math.max(progress, floor, timed);
    render();
  };

  const rotateQuote = () => {
    quoteIndex += 1;
    quoteTextEl.classList.add("is-changing");
    window.setTimeout(() => {
      renderQuote();
      quoteTextEl.classList.remove("is-changing");
    }, 220);
  };

  const hide = () => {
    stopTimers();
    panel.classList.add("hidden");
    panel.classList.remove("is-complete");
  };

  return {
    start(symbolCount, mode = "separate", phase = "preparing") {
      stopTimers();
      startedAt = Date.now();
      estimateMs = estimateProcessingMs(Math.max(1, symbolCount), mode);
      progress = 2;
      floor = 2;
      quotes = shuffle(PROCESSING_QUOTES);
      quoteIndex = 0;
      setPhase(phase);
      renderQuote();
      panel.classList.remove("hidden", "is-complete");
      render();
      tickTimer = setInterval(tick, 400);
      quoteTimer = setInterval(rotateQuote, QUOTE_ROTATION_MS);
    },

    onMeta() {
      floor = Math.max(floor, 18);
      setPhase("fundamentals");
    },

    onSticky() {
      floor = Math.max(floor, 48);
      setPhase("analysis");
    },

    onBody() {
      floor = Math.max(floor, 72);
      setPhase("drafting");
    },

    onDone() {
      floor = 100;
      progress = 100;
      setPhase("complete");
      panel.classList.add("is-complete");
      render();
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => hide(), 700);
    },

    fail() {
      hide();
    },

    hide,

    isVisible() {
      return !panel.classList.contains("hidden");
    },
  };
}

/** Markup matching the prior production processing panel. */
export const PROCESSING_PANEL_HTML = `
  <div id="processing-panel" class="processing-panel hidden" aria-live="polite">
    <div class="processing-header">
      <div class="processing-spinner" aria-hidden="true"></div>
      <div class="processing-status">
        <p id="processing-phase" class="processing-phase">Preparing your research request…</p>
        <p id="processing-eta" class="processing-eta">Estimating time…</p>
      </div>
    </div>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div id="progress-fill" class="progress-fill"></div>
    </div>
    <blockquote class="processing-quote">
      <p id="quote-text" class="quote-text"></p>
      <cite id="quote-author" class="quote-author"></cite>
    </blockquote>
  </div>
`;
