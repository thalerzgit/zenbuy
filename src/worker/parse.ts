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

const SCORE_KEYS: Array<{ key: keyof Scorecard; re: RegExp }> = [
  { key: "growth", re: /growth:\s*(\d{1,2})\s*\/\s*10/i },
  { key: "moat", re: /moat:\s*(\d{1,2})\s*\/\s*10/i },
  { key: "management", re: /management:\s*(\d{1,2})\s*\/\s*10/i },
  { key: "valuation", re: /valuation:\s*(\d{1,2})\s*\/\s*10/i },
  { key: "balanceSheet", re: /balance\s*sheet:\s*(\d{1,2})\s*\/\s*10/i },
  { key: "catalysts", re: /catalysts:\s*(\d{1,2})\s*\/\s*10/i },
  { key: "overall", re: /overall:\s*(\d{1,2})\s*\/\s*10/i },
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

export function splitReport(markdown: string): { bottomLine: string; body: string } {
  const bottomIdx = markdown.search(BOTTOM_RE);
  if (bottomIdx < 0) {
    return { bottomLine: "", body: markdown };
  }
  const fundIdx = markdown.search(FUNDAMENTALS_RE);
  const bottomEnd = fundIdx > bottomIdx ? fundIdx : markdown.length;
  const bottomLine = markdown.slice(bottomIdx, bottomEnd).trim();
  const body = fundIdx > bottomIdx ? markdown.slice(fundIdx).trim() : "";
  return { bottomLine, body };
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

/**
 * Guard against caching truncated LLM output (stream drop / max_tokens).
 * Incomplete reports must never be written to KV as successful cache hits.
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

  const missing = REQUIRED_SECTIONS.filter(
    (name) => !new RegExp(`^##\\s*${name}\\b`, "im").test(text)
  );
  if (missing.length) {
    return { ok: false, reason: "missing_sections", missing: [...missing] };
  }

  // SUMMARY must include a usable Overall score — mid-stream cuts often leave
  // the header without finishing the scorecard.
  if (!/overall:\s*\d{1,2}\s*\/\s*10/i.test(text)) {
    return { ok: false, reason: "incomplete_summary" };
  }

  // Mid-word cutoffs look like "...oligopoly benef" with no terminal mark.
  const lastLine = text.split("\n").filter(Boolean).pop()?.trim() ?? "";
  const looksFinished =
    /[.!?…]["')\]]?\s*$/u.test(lastLine) ||
    /\d{1,2}\s*\/\s*10\s*$/u.test(lastLine) ||
    /\|\s*$/u.test(lastLine);
  if (!looksFinished && /[A-Za-z]{4,}$/u.test(lastLine)) {
    return { ok: false, reason: "truncated_tail" };
  }

  return { ok: true };
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

  let html = md
    .replace(/^### (.+)$/gm, (_m, t: string) => `<h3>${linkify(t)}</h3>`)
    .replace(/^## (.+)$/gm, (_m, t: string) => `<h2>${linkify(t)}</h2>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Links after bold so **[Yahoo](url)** still works via strong wrapping separately;
  // apply linkify to remaining text nodes-ish by running globally.
  html = linkify(html);

  html = html.replace(/^- (.+)$/gm, (_m, t: string) => `<li>${t}</li>`);

  html = html.replace(/(<li>[^\n]+<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  html = html.replace(
    /\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g,
    (_, header, body) => {
      const ths = header
        .split("|")
        .filter(Boolean)
        .map((c: string) => `<th>${c.trim()}</th>`)
        .join("");
      const rows = body
        .trim()
        .split("\n")
        .map((row: string) => {
          const tds = row
            .split("|")
            .filter(Boolean)
            .map((c: string) => `<td>${c.trim()}</td>`)
            .join("");
          return `<tr>${tds}</tr>`;
        })
        .join("");
      // Wrapped so a wide table scrolls on a phone instead of crushing its
      // columns into three-line headers.
      return `<div class="table-scroll"><table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  );

  const parts = html.split(/\n\n+/).filter(Boolean);
  return parts
    .map((p) => {
      const t = p.trim();
      if (/^<(h[23]|ul|table|div)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, "<br/>")}</p>`;
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
