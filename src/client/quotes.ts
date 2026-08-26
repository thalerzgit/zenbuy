/** Rotating header insights — short, calm, decision-oriented. */
export const ORACLE_QUOTES: readonly string[] = [
  "The insight you wished you had—earlier.",
  "Price is what you pay. Value is what you get.",
  "Time in the market beats timing the market.",
  "Know the business before you own the ticker.",
  "Compounding is quiet until it isn't.",
  "A margin of safety is a gift to your future self.",
  "Conviction without a flip trigger is hope.",
  "Cash flow is the truth; narratives are optional.",
  "Buy when you understand; wait when you don't.",
  "Risk is not volatility — it's permanent loss of capital.",
  "The best trade is the one you can explain in one breath.",
  "Patience is a position.",
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
