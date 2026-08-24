export const FUNNY_ERRORS = [
  "The market is meditating on this one. We couldn't pull a clean read — try again?",
  "Even zen masters have off days. That request didn't land — give it another go?",
  "The tickers wandered off into the void. Retry when you're ready.",
  "Our research oracle needs a moment of clarity. Tap retry.",
  "Something got lost between here and the exchange. Worth another try?",
];

export function randomError(): string {
  return FUNNY_ERRORS[Math.floor(Math.random() * FUNNY_ERRORS.length)];
}
