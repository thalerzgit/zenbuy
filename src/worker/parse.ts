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

export function renderMarkdown(md: string): string {
  if (!md.trim()) return "";
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>");

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
      return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  );

  const parts = html.split(/\n\n+/).filter(Boolean);
  return parts
    .map((p) => {
      const t = p.trim();
      if (/^<(h[23]|ul|table)/.test(t)) return t;
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
