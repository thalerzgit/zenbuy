/** Rotating header insights — attributed wisdom from investment luminaries. */
export const ORACLE_QUOTES: readonly string[] = [
  "Price is what you pay. Value is what you get. — Warren Buffett",
  "Know what you own, and know why you own it. — Peter Lynch",
  "Never confuse a bull market with brains. — David Morgenthaler",
  "Be fearful when others are greedy and greedy when others are fearful. — Warren Buffett",
  "Behind every stock is a company. Find out what it's doing. — Peter Lynch",
  "If you have to bet on one, bet on the good jockey. — David Morgenthaler",
  "Our favorite holding period is forever. — Warren Buffett",
  "Time is on your side when you own shares of superior companies. — Peter Lynch",
  "The best entrepreneurs really are moderate risk takers. — David Morgenthaler",
  "Risk comes from not knowing what you're doing. — Warren Buffett",
  "The stock market is filled with individuals who know the price of everything, but the value of nothing. — Peter Lynch",
  "Investing without knowing management, the company, and the market is like betting on horses blindfolded. — David Morgenthaler",
];

export function startOracleRotation(
  el: HTMLElement,
  quotes: readonly string[] = ORACLE_QUOTES,
  intervalMs = 6500
): () => void {
  if (!quotes.length) return () => {};

  let i = 0;
  el.textContent = quotes[0];
  el.classList.add("brand-oracle-ready");

  const reduceMotion =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || quotes.length < 2) return () => {};

  let timer: ReturnType<typeof setInterval> | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    el.classList.add("brand-oracle-fade");
    fadeTimer = setTimeout(() => {
      i = (i + 1) % quotes.length;
      el.textContent = quotes[i];
      el.classList.remove("brand-oracle-fade");
    }, 320);
  };

  timer = setInterval(tick, intervalMs);

  return () => {
    if (timer) clearInterval(timer);
    if (fadeTimer) clearTimeout(fadeTimer);
  };
}
