export interface Badges {
  recommendation?: string;
  sentiment?: string;
  conviction?: string;
}

export interface Scorecard {
  growth?: number;
  moat?: number;
  management?: number;
  valuation?: number;
  balanceSheet?: number;
  catalysts?: number;
  overall?: number;
}

export interface ParsedReport {
  bottomLine: string;
  body: string;
  badges: Badges;
  scorecard: Scorecard;
}

const BOTTOM_RE = /^##\s*BOTTOM LINE/im;
const FUNDAMENTALS_RE = /^##\s*FUNDAMENTALS/im;

function pick(block: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = block.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

export function parseBadges(markdown: string): Badges {
  const bottomIdx = markdown.search(BOTTOM_RE);
  const bottomBlock =
    bottomIdx >= 0
      ? markdown.slice(bottomIdx, markdown.search(FUNDAMENTALS_RE) > bottomIdx ? markdown.search(FUNDAMENTALS_RE) : markdown.length)
      : markdown.slice(0, 800);

  const thesisIdx = markdown.search(/^##\s*THESIS VALIDATION/im);
  const thesisBlock =
    thesisIdx >= 0
      ? markdown.slice(thesisIdx, markdown.search(/^##\s*SECTOR/im) > thesisIdx ? markdown.search(/^##\s*SECTOR/im) : markdown.length)
      : "";

  return {
    recommendation: pick(bottomBlock, [
      /verdict:\s*\**\s*(Buy|Hold|Sell)\b/i,
      /\b(Buy|Hold|Sell)\b[^.\n]*conviction/i,
      /recommendation:\s*\**\s*(Buy|Hold|Sell)\**/i,
    ]),
    conviction: pick(bottomBlock, [
      /conviction[^:\n]*:\s*\**\s*(High|Medium|Low)\**/i,
      /(High|Medium|Low)\s+conviction/i,
    ]),
    sentiment: pick(thesisBlock, [
      /verdict:\s*\**\s*(Bullish|Bearish|Neutral)\**/i,
      /\*\*(Bullish|Bearish|Neutral)\*\*/i,
    ]),
  };
}

/** Accepts `7/10` and `7.5/10` (Opus often emits half-points). */
const SCORE_NUM = String.raw`(\d{1,2}(?:\.\d)?)`;
const OVERALL_SCORE_RE = new RegExp(
  String.raw`overall:?\s*${SCORE_NUM}\s*/\s*10`,
  "i"
);

const SCORE_KEYS: Array<{ key: keyof Scorecard; re: RegExp }> = [
  { key: "growth", re: new RegExp(String.raw`growth:\s*${SCORE_NUM}\s*/\s*10`, "i") },
  { key: "moat", re: new RegExp(String.raw`moat:\s*${SCORE_NUM}\s*/\s*10`, "i") },
  { key: "management", re: new RegExp(String.raw`management:\s*${SCORE_NUM}\s*/\s*10`, "i") },
  { key: "valuation", re: new RegExp(String.raw`valuation:\s*${SCORE_NUM}\s*/\s*10`, "i") },
  { key: "balanceSheet", re: new RegExp(String.raw`balance\s*sheet:\s*${SCORE_NUM}\s*/\s*10`, "i") },
  { key: "catalysts", re: new RegExp(String.raw`catalysts:\s*${SCORE_NUM}\s*/\s*10`, "i") },
  { key: "overall", re: OVERALL_SCORE_RE },
];

export function parseScorecard(markdown: string): Scorecard {
  const summaryIdx = markdown.search(/^##\s*SUMMARY/im);
  const block = summaryIdx >= 0 ? markdown.slice(summaryIdx) : markdown.slice(-1500);
  const scores: Scorecard = {};
  for (const { key, re } of SCORE_KEYS) {
    const m = block.match(re);
    if (m?.[1]) scores[key] = Math.min(10, Math.max(1, Number(m[1])));
  }
  return scores;
}

/**
 * Older prompts made the model caption BOTTOM LINE with e.g.
 * "Rank for an 18-year aggressive-growth mandate:". The prompt no longer asks
 * for it; this keeps cached and stray outputs clean.
 */
const RANK_CAPTION_RE =
  /^[*_>\s-]*rank(?:ing)? for (?:an?|the) [^\n:]{0,80}mandate[^\n:]{0,20}:[*_]*[ \t]*/i;

function stripRankCaption(bottomLine: string): string {
  const headingMatch = bottomLine.match(/^##[^\n]*\n?/);
  const heading = headingMatch?.[0] ?? "";
  const rest = bottomLine.slice(heading.length);
  const replaced = rest.replace(RANK_CAPTION_RE, "");
  if (replaced === rest) return bottomLine;
  const stripped = replaced.trimStart();
  if (!heading) return stripped;
  return stripped ? `${heading.trimEnd()}\n\n${stripped}` : heading.trim();
}

export function splitReport(markdown: string): { bottomLine: string; body: string } {
  const bottomIdx = markdown.search(BOTTOM_RE);
  if (bottomIdx < 0) {
    return { bottomLine: "", body: markdown };
  }
  const fundIdx = markdown.search(FUNDAMENTALS_RE);
  const bottomEnd = fundIdx > bottomIdx ? fundIdx : markdown.length;
  const bottomLine = stripRankCaption(markdown.slice(bottomIdx, bottomEnd).trim());
  const body = fundIdx > bottomIdx ? markdown.slice(fundIdx).trim() : "";
  return { bottomLine, body };
}

/**
 * True once ## BOTTOM LINE has more than a heading — do not wait for
 * FUNDAMENTALS. Used so the first sticky can paint a usable verdict.
 */
export function isParseableBottomLine(markdown: string): boolean {
  if (!BOTTOM_RE.test(markdown)) return false;
  const { bottomLine } = splitReport(markdown);
  const afterHeading = bottomLine.replace(/^##\s*BOTTOM LINE[^\n]*/im, "").trim();
  return afterHeading.length > 0;
}

export function parseReport(markdown: string): ParsedReport {
  const { bottomLine, body } = splitReport(markdown);
  return {
    bottomLine,
    body,
    badges: parseBadges(markdown),
    scorecard: parseScorecard(markdown),
  };
}

/** Required section headers for a finished analyst report (order flexible). */
const REQUIRED_SECTIONS = [
  "BOTTOM LINE",
  "FUNDAMENTALS",
  "MOAT AND MANAGEMENT",
  "THESIS VALIDATION",
  "SECTOR AND MACRO",
  "CATALYSTS AND RISKS",
  "RETURN SCENARIOS",
  "ACTION PLAN",
  "SUMMARY",
] as const;

export interface CompletenessResult {
  ok: boolean;
  reason?: string;
  missing?: string[];
}

export const PARTIAL_REPORT_WARNING =
  "Report may be incomplete — tap Generate to refresh.";

export const INCOMPLETE_HARD_FAIL =
  "The analysis cut off before finishing — nothing was cached. Tap Generate Report to try again.";

export type ResearchFinishAction = "cache" | "cache_partial" | "fail";

export interface ResearchFinishPlan {
  action: ResearchFinishAction;
  completeness: CompletenessResult;
  usable: boolean;
  warning?: string;
  failMessage?: string;
}

const SECTION_HEADER_RE = (name: string): RegExp =>
  new RegExp(`^##\\s*${name}\\b`, "im");

function missingRequiredSections(text: string): string[] {
  return REQUIRED_SECTIONS.filter((name) => !SECTION_HEADER_RE(name).test(text));
}

function hasOverallScore(text: string): boolean {
  return OVERALL_SCORE_RE.test(text);
}

function hasSummarySection(text: string): boolean {
  return SECTION_HEADER_RE("SUMMARY").test(text);
}

/**
 * Guard against treating truncated LLM output as a finished report.
 * Incomplete-but-usable reports are accepted via planResearchFinish.
 */
export function assessReportCompleteness(
  markdown: string,
  opts: { minChars?: number } = {}
): CompletenessResult {
  const text = markdown.trim();
  const minChars = opts.minChars ?? 1_200;
  if (text.length < minChars) {
    return {
      ok: false,
      reason: "too_short",
      missing: [...REQUIRED_SECTIONS],
    };
  }

  const missing = missingRequiredSections(text);
  if (missing.length) {
    return { ok: false, reason: "missing_sections", missing: [...missing] };
  }

  // SUMMARY must include a usable Overall score — mid-stream cuts often leave
  // the header without finishing the scorecard. Half-points (7.5/10) count.
  if (!hasOverallScore(text)) {
    return { ok: false, reason: "incomplete_summary" };
  }

  // Mid-word cutoffs look like "...oligopoly benef" with no terminal mark.
  // If SUMMARY + Overall already landed, a trailing mid-word is a false
  // positive (scorecard prose often ends mid-clause after the scores).
  if (hasSummarySection(text) && hasOverallScore(text)) {
    return { ok: true };
  }

  const lastLine = text.split("\n").filter(Boolean).pop()?.trim() ?? "";
  const looksFinished =
    /[.!?…]["')\]]?\s*$/u.test(lastLine) ||
    /\d{1,2}(?:\.\d)?\s*\/\s*10\s*$/u.test(lastLine) ||
    /\|\s*$/u.test(lastLine);
  if (!looksFinished && /[A-Za-z]{4,}$/u.test(lastLine)) {
    return { ok: false, reason: "truncated_tail" };
  }

  return { ok: true };
}

const STUB_BOTTOM_LINE_RE =
  /^_?(Analysis cut off|Analysis unavailable|Analysis service)/i;

/**
 * A report the user can keep: parseable BOTTOM LINE with real content,
 * plus Overall x/10 or most required sections. Too short / no BOTTOM LINE
 * stays unusable.
 */
export function isUsablePartialReport(markdown: string): boolean {
  if (!isParseableBottomLine(markdown)) return false;
  const { bottomLine } = splitReport(markdown);
  const afterHeading = bottomLine
    .replace(/^##\s*BOTTOM LINE[^\n]*/im, "")
    .trim();
  if (afterHeading.length < 40) return false;
  if (STUB_BOTTOM_LINE_RE.test(afterHeading)) return false;

  if (hasOverallScore(markdown)) return true;
  const present = REQUIRED_SECTIONS.length - missingRequiredSections(markdown).length;
  return present >= 5;
}

/** One silent retry only when the first stream has no usable sticky. */
export function shouldSilentRetryIncomplete(markdown: string): boolean {
  return !isUsablePartialReport(markdown);
}

/**
 * Worker finish() decision: cache complete, cache usable partial, or hard-fail.
 */
export function planResearchFinish(markdown: string): ResearchFinishPlan {
  const completeness = assessReportCompleteness(markdown);
  const usable = isUsablePartialReport(markdown);
  if (completeness.ok) {
    return { action: "cache", completeness, usable: true };
  }
  if (usable) {
    return {
      action: "cache_partial",
      completeness,
      usable: true,
      warning: PARTIAL_REPORT_WARNING,
    };
  }
  return {
    action: "fail",
    completeness,
    usable: false,
    failMessage: INCOMPLETE_HARD_FAIL,
  };
}

export interface CompanySection {
  symbol: string;
  bottomLine: string;
  body: string;
  badges: Badges;
  scorecard: Scorecard;
}

const BOTTOM_TICKER_RE =
  /^##\s*BOTTOM LINE(?:\s*[—–-]\s*([A-Z][A-Z0-9.\-]{0,11}))?\s*$/gim;

/** Split a multi-ticker markdown blob into per-company sections. */
export function parseCompanySections(
  markdown: string,
  symbols: string[] = []
): CompanySection[] {
  const matches: Array<{ index: number; symbol?: string }> = [];
  let m: RegExpExecArray | null;
  BOTTOM_TICKER_RE.lastIndex = 0;
  while ((m = BOTTOM_TICKER_RE.exec(markdown)) !== null) {
    matches.push({ index: m.index, symbol: m[1]?.toUpperCase() });
  }

  if (matches.length === 0) {
    const parsed = parseReport(markdown);
    if (!parsed.bottomLine && !parsed.body.trim()) return [];
    return [
      {
        symbol: symbols[0] ?? "Report",
        bottomLine: parsed.bottomLine,
        body: parsed.body,
        badges: parsed.badges,
        scorecard: parsed.scorecard,
      },
    ];
  }

  const sections: CompanySection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end =
      i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    const chunk = markdown.slice(start, end);
    const { bottomLine, body } = splitReport(chunk);
    sections.push({
      symbol: matches[i].symbol ?? symbols[i] ?? symbols[0] ?? "Report",
      bottomLine,
      body,
      badges: parseBadges(chunk),
      scorecard: parseScorecard(chunk),
    });
  }
  return sections;
}

export function companyProfilesFromMarkdown(
  markdown: string,
  symbols: string[]
): Array<{
  symbol: string;
  bottomLineHtml: string;
  scorecardHtml: string;
  badges: Badges;
  scores: Scorecard;
  bodyHtml: string;
}> {
  return parseCompanySections(markdown, symbols)
    .filter((s) => s.bottomLine || s.body)
    .map((s) => ({
      symbol: s.symbol,
      bottomLineHtml: renderMarkdown(s.bottomLine),
      scorecardHtml: scorecardHtml(s.scorecard),
      badges: s.badges,
      scores: s.scorecard,
      bodyHtml: renderMarkdown(s.body),
    }));
}

const ORPHAN_OUTLET_RE =
  /^(Yahoo|Finnhub|FactSet|Factset|SEC|Earnings|Stats|Bloomberg|Reuters)$/i;

function isPipeRow(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && !/^<{1,3}h[23]/.test(t);
}

function isSeparatorRow(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /^\|?[-|: ]+\|?$/.test(t) && /[-:]/.test(t);
}

function isTableishLine(line: string): boolean {
  return isPipeRow(line) || isSeparatorRow(line);
}

function isStructuralLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/^[-*+]\s/.test(t)) return true;
  if (/^\d+\.\s/.test(t)) return true;
  if (isTableishLine(t)) return true;
  return false;
}

function isFragmentLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t === "." || t === "·" || t === "•") return true;
  if (/^[·•]\s?/.test(t)) return true;
  if (/^[\d$~%().–—+\-×x/,]+$/.test(t)) return true;
  if (/^\(\d+m\)\.?$/i.test(t)) return true;
  if (t.length <= 48 && !/[.!?]$/.test(t)) return true;
  return false;
}

function joinProse(left: string, right: string): string {
  const a = left.trimEnd();
  const b = right.trimStart();
  if (a.endsWith("-") && /^[A-Za-z]/.test(b)) return a + b;
  if (a.endsWith(" ") || b.startsWith("·") || b.startsWith("•")) {
    return `${a}${a.endsWith(" ") ? "" : " "}${b}`;
  }
  return `${a} ${b}`;
}

function isTableContinuation(prev: string, line: string): boolean {
  if (!isTableishLine(prev)) return false;
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,6}\s/.test(t) || /^[-*+]\s/.test(t) || /^\d+\.\s/.test(t)) {
    return false;
  }
  const prevComplete = prev.trimEnd().endsWith("|");
  // Only glue fragments. A complete `| A | B |` plus a separator is two rows.
  if (isSeparatorRow(t)) return !prevComplete;
  if (t.includes("|") && !t.startsWith("|") && !t.startsWith("#")) return true;
  if (!prevComplete) return true;
  return false;
}

function joinTablePieces(prev: string, line: string): string {
  const left = prev.trimEnd();
  const right = line.trimStart();
  if (left.endsWith("|") && right.startsWith("|")) {
    return left + right.slice(1);
  }
  if (!left.endsWith(" ") && !right.startsWith("|") && !right.startsWith("-")) {
    return `${left} ${right}`;
  }
  return left + right;
}

/** Rejoin Grok-wrapped GFM rows (`| ~2y` + `price |`) into one pipe line. */
function repairBrokenTables(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const prev = out[out.length - 1];
    if (prev != null && isTableContinuation(prev, line)) {
      out[out.length - 1] = joinTablePieces(prev, line);
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

/**
 * Grok (and some Claude wraps) insert hard newlines inside a sentence.
 * Keep blank lines, headers, list markers, and intact table rows.
 */
function collapseSoftNewlines(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const prev = out[out.length - 1];
    if (prev == null || !prev.trim() || !line.trim()) {
      out.push(line);
      continue;
    }
    if (isTableishLine(prev) && isTableishLine(line)) {
      out.push(line);
      continue;
    }
    const nextStructural = isStructuralLine(line) && !isFragmentLine(line);
    if (nextStructural) {
      out.push(line);
      continue;
    }
    if (isFragmentLine(line) || !isStructuralLine(prev)) {
      out[out.length - 1] = joinProse(prev, line);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function joinScorecardLines(text: string): string {
  return text.replace(
    new RegExp(
      String.raw`(Growth|Moat|Management|Valuation|Balance\s*sheet|Catalysts|Overall):\s*\n+\s*${SCORE_NUM}\s*/\s*10`,
      "gi"
    ),
    "$1: $2/10"
  );
}

function sanitizeNullInFeed(text: string): string {
  return text
    .replace(/\bnull(?:ish)?(?:\s+in\s+feed)?\b/gi, "not in feed")
    .replace(/\bnot in feed\s*\/\s*not in feed\b/gi, "not in feed");
}

function stripOrphanCitationLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !ORPHAN_OUTLET_RE.test(line.trim()))
    .join("\n");
}

/**
 * Model-agnostic markdown cleanup so Grok hard-wraps, pipe-table wraps,
 * scorecard dots, and `null in feed` do not leak into HTML/PDF.
 */
export function normalizeMarkdown(md: string): string {
  let text = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = repairBrokenTables(text);
  text = collapseSoftNewlines(text);
  text = joinScorecardLines(text);
  text = sanitizeNullInFeed(text);
  text = stripOrphanCitationLines(text);
  // Grok often uses a single newline after ## headers; the HTML splitter
  // needs a blank line so the heading is not glued to the following prose.
  text = text.replace(/^(#{1,6}[^\n]+)\n(?!\n|#)/gm, "$1\n\n");
  return text;
}

function parsePipeCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function renderGfmTable(header: string[], rows: string[][]): string {
  const ths = header.map((c) => `<th>${c}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-scroll"><table><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Convert consecutive GFM pipe rows (with or without a separator) to HTML. */
function convertGfmTables(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];
    const hasSep = next != null && isSeparatorRow(next);
    const hasNextRow = next != null && isPipeRow(next) && !isSeparatorRow(next);
    if (isPipeRow(line) && !isSeparatorRow(line) && (hasSep || hasNextRow)) {
      const header = parsePipeCells(line);
      i += 1;
      if (hasSep) i += 1;
      const rows: string[][] = [];
      while (i < lines.length && isPipeRow(lines[i]) && !isSeparatorRow(lines[i])) {
        rows.push(parsePipeCells(lines[i]));
        i += 1;
      }
      if (hasSep || rows.length > 0) {
        out.push(renderGfmTable(header, rows));
        continue;
      }
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
}

export function renderMarkdown(md: string): string {
  if (!md.trim()) return "";

  const escapeText = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const linkify = (text: string) =>
    text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (_m, label: string, href: string) => {
        try {
          const u = new URL(href);
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            return escapeText(label);
          }
          return `<a class="src-link" href="${escapeText(u.toString())}" target="_blank" rel="noopener noreferrer">${escapeText(label)}</a>`;
        } catch {
          return escapeText(label);
        }
      }
    );

  let html = normalizeMarkdown(md)
    .replace(/^### (.+)$/gm, (_m, t: string) => `<h3>${linkify(t)}</h3>`)
    .replace(/^## (.+)$/gm, (_m, t: string) => `<h2>${linkify(t)}</h2>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Links after bold so **[Yahoo](url)** still works via strong wrapping separately;
  // apply linkify to remaining text nodes-ish by running globally.
  html = linkify(html);

  html = html.replace(/^- (.+)$/gm, (_m, t: string) => `<li>${t}</li>`);

  html = html.replace(/(<li>[^\n]+<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  html = convertGfmTables(html);

  const parts = html.split(/\n\n+/).filter(Boolean);
  return parts
    .map((p) => {
      const t = p.trim();
      if (/^<(h[23]|ul|table|div)/.test(t)) return t;
      // Remaining single newlines are wraps, not paragraphs — never <br/>.
      return `<p>${t.replace(/\n/g, " ")}</p>`;
    })
    .join("");
}

export function scorecardHtml(scores: Scorecard): string {
  const labels: Array<[keyof Scorecard, string]> = [
    ["growth", "Growth"],
    ["moat", "Moat"],
    ["management", "Mgmt"],
    ["valuation", "Value"],
    ["balanceSheet", "Balance"],
    ["catalysts", "Catalysts"],
    ["overall", "Overall"],
  ];
  const rows = labels
    .filter(([k]) => scores[k] != null)
    .map(([k, label]) => {
      const v = scores[k]!;
      const pct = (v / 10) * 100;
      return `<div class="score-row"><span class="score-label">${label}</span><div class="score-bar"><div class="score-fill" style="width:${pct}%"></div></div><span class="score-num">${v}/10</span></div>`;
    })
    .join("");
  return rows ? `<div class="scorecard">${rows}</div>` : "";
}
