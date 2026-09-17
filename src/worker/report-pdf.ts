/**
 * Colour PDF for one finished report.
 *
 * The iPhone build renders its own PDF with UIKit for the system share sheet.
 * Apple TV has no share sheet, so the emailed copy is drawn here from the same
 * HTML fragments the apps display. Base-14 Helvetica needs no embedded font
 * programme and no headless browser, so the Worker bundle keeps its zero
 * runtime dependencies.
 *
 * Layout and palette follow `ZenBuy/Features/Report/ReportPDFExporter.swift`:
 * dark-green section titles, mint table headers, filled score bars, verdict
 * pills in the buy / sell / hold colours from the website stylesheet.
 */

import type { Badges } from "./parse.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const INSET = 48;
const CONTENT_W = PAGE_W - INSET * 2;
const CONTENT_BOTTOM = PAGE_H - INSET - 24;

type RGB = readonly [number, number, number];

const INK: RGB = [0x16, 0x18, 0x1a];
const MUTED: RGB = [0x5a, 0x61, 0x68];
const GREEN: RGB = [0x24, 0x7a, 0x36];
const GREEN_DARK: RGB = [0x1a, 0x5c, 0x28];
const GREEN_LIGHT: RGB = [0xe4, 0xf3, 0xe8];
const GREEN_POSITIVE: RGB = [0x0a, 0x7f, 0x44];
const BEAR: RGB = [0xa6, 0x1b, 0x22];
const NEUTRAL: RGB = [0x5f, 0x6b, 0x73];
const BORDER: RGB = [0xd5, 0xdb, 0xd6];
const BADGE_BUY: RGB = [0xe3, 0xf6, 0xe8];
const BADGE_SELL: RGB = [0xfd, 0xe4, 0xe4];
const BADGE_HOLD: RGB = [0xec, 0xef, 0xf2];
const WHITE: RGB = [0xff, 0xff, 0xff];

// MARK: - Font metrics

/** Adobe AFM advance widths (/1000 em) for WinAnsi codes 32…126. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667,
  778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556,
  556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667,
  778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611,
  611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];

/** Punctuation the research prose actually uses, mapped onto WinAnsi. */
const WINANSI_PUNCTUATION: Record<string, [number, number, number]> = {
  "\u2018": [0x91, 222, 238],
  "\u2019": [0x92, 222, 238],
  "\u201c": [0x93, 333, 500],
  "\u201d": [0x94, 333, 500],
  "\u2022": [0x95, 350, 350],
  "\u2013": [0x96, 556, 556],
  "\u2014": [0x97, 1000, 1000],
  "\u2026": [0x85, 1000, 1000],
  "\u00b7": [0xb7, 278, 278],
  "\u00a0": [0x20, 278, 278],
  "\u2212": [0x2d, 333, 333],
};

/** WinAnsi byte plus its advance width, or `null` when unrepresentable. */
function glyph(char: string, bold: boolean): [number, number] {
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) {
    const table = bold ? HELVETICA_BOLD : HELVETICA;
    return [code, table[code - 32]];
  }
  const punctuation = WINANSI_PUNCTUATION[char];
  if (punctuation) return [punctuation[0], punctuation[bold ? 2 : 1]];
  // Latin-1 accents share their code point with WinAnsi; widths there vary by
  // a few thousandths of an em, which only shifts a wrap point.
  if (code >= 0xa1 && code <= 0xff) return [code, bold ? 611 : 556];
  return [0x3f, bold ? 611 : 556];
}

function textWidth(text: string, bold: boolean, size: number): number {
  let mille = 0;
  for (const char of text) mille += glyph(char, bold)[1];
  return (mille * size) / 1000;
}

/** WinAnsi bytes as a char-per-byte string, escaped for a PDF literal. */
function pdfString(text: string, bold: boolean): string {
  let out = "";
  for (const char of text) {
    const byte = glyph(char, bold)[0];
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += "\\";
    out += String.fromCharCode(byte);
  }
  return out;
}

// MARK: - Report content

interface Inline {
  text: string;
  bold?: boolean;
}

type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; headers: string[]; rows: string[][] };

export interface ScoreRow {
  label: string;
  value: string;
  fraction: number;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, " ");
}

/** `<strong>` is the only inline style the PDF distinguishes; links flatten. */
function inlines(html: string): Inline[] {
  const out: Inline[] = [];
  const re = /<strong\b[^>]*>([\s\S]*?)<\/strong>/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const before = plain(html.slice(last, match.index));
    if (before) out.push({ text: before });
    const bold = plain(match[1]);
    if (bold) out.push({ text: bold, bold: true });
    last = match.index + match[0].length;
  }
  const tail = plain(html.slice(last));
  if (tail) out.push({ text: tail });
  return out;
}

function tableBlock(html: string): Block | null {
  const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    plain(m[1]).trim()
  );
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) =>
      [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
        plain(cell[1]).trim()
      )
    )
    .filter((cells) => cells.length > 0);
  if (headers.length === 0 && rows.length === 0) return null;
  return { kind: "table", headers, rows };
}

/**
 * Blocks from a stored report fragment. The markup is this Worker's own
 * `renderMarkdown` output, so the tag set is h2 / h3 / p / ul+li / table.
 */
export function blocksFromHtml(html: string): Block[] {
  const blocks: Block[] = [];
  const re = /<(h2|h3|p|ul|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[2];
    if (tag === "h2" || tag === "h3") {
      const text = plain(inner).trim();
      if (text) blocks.push({ kind: "heading", level: tag === "h2" ? 2 : 3, text });
    } else if (tag === "p") {
      const parts = inlines(inner);
      if (parts.length > 0) blocks.push({ kind: "paragraph", inlines: parts });
    } else if (tag === "ul") {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((item) => inlines(item[1]))
        .filter((item) => item.length > 0);
      if (items.length > 0) blocks.push({ kind: "list", items });
    } else {
      const table = tableBlock(inner);
      if (table) blocks.push(table);
    }
  }
  return blocks;
}

/** Score rows from the `scorecardHtml` this Worker generates. */
export function scoreRowsFromHtml(html: string): ScoreRow[] {
  const re =
    /score-label">([^<]*)<[\s\S]*?width:\s*([\d.]+)%[\s\S]*?score-num">([^<]*)</gi;
  const rows: ScoreRow[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    rows.push({
      label: plain(match[1]).trim(),
      value: plain(match[3]).trim(),
      fraction: Math.min(1, Math.max(0, Number(match[2]) / 100)),
    });
  }
  return rows;
}

interface Pill {
  text: string;
  background: RGB;
  foreground: RGB;
}

function verdictPill(value: string): Pill {
  const lower = value.toLowerCase();
  if (lower.includes("sell") || lower.includes("bear")) {
    return { text: value, background: BADGE_SELL, foreground: BEAR };
  }
  if (lower.includes("hold") || lower.includes("neutral")) {
    return { text: value, background: BADGE_HOLD, foreground: NEUTRAL };
  }
  if (lower.includes("buy") || lower.includes("bull")) {
    return { text: value, background: BADGE_BUY, foreground: GREEN_POSITIVE };
  }
  return { text: value, background: GREEN_LIGHT, foreground: GREEN_DARK };
}

function badgePills(badges: Badges | undefined): Pill[] {
  const pills: Pill[] = [];
  if (badges?.recommendation) pills.push(verdictPill(badges.recommendation));
  if (badges?.sentiment) pills.push(verdictPill(badges.sentiment));
  if (badges?.conviction) {
    const label = /conviction/i.test(badges.conviction)
      ? badges.conviction
      : `${badges.conviction} conviction`;
    pills.push({ text: label, background: GREEN_LIGHT, foreground: GREEN_DARK });
  }
  return pills;
}

// MARK: - Canvas

interface Word {
  text: string;
  bold: boolean;
}

function words(parts: Inline[]): Word[] {
  const out: Word[] = [];
  for (const part of parts) {
    for (const token of part.text.split(/\s+/)) {
      if (token) out.push({ text: token, bold: Boolean(part.bold) });
    }
  }
  return out;
}

function wrap(list: Word[], maxWidth: number, size: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let used = 0;
  for (const word of list) {
    const width = textWidth(word.text, word.bold, size);
    const space = line.length > 0 ? textWidth(" ", word.bold, size) : 0;
    if (line.length > 0 && used + space + width > maxWidth) {
      lines.push(line);
      line = [word];
      used = width;
    } else {
      line.push(word);
      used += space + width;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function num(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function fill(color: RGB): string {
  return `${num(color[0] / 255)} ${num(color[1] / 255)} ${num(color[2] / 255)} rg`;
}

function stroke(color: RGB): string {
  return `${num(color[0] / 255)} ${num(color[1] / 255)} ${num(color[2] / 255)} RG`;
}

/**
 * Top-down drawing cursor over one or more PDF content streams. PDF space is
 * bottom-up, so every draw converts through `PAGE_H - y`.
 */
class Canvas {
  private pages: string[] = [];
  private ops: string[] = [];
  private pageIndex = 0;
  private readonly totalPages: number | null;
  y = 0;

  constructor(totalPages: number | null) {
    this.totalPages = totalPages;
  }

  finish(): string[] {
    if (this.ops.length > 0) this.pages.push(this.ops.join("\n"));
    return this.pages;
  }

  beginPage(): void {
    if (this.ops.length > 0) this.pages.push(this.ops.join("\n"));
    this.ops = [];
    this.pageIndex += 1;
    this.y = INSET;
    this.footer();
  }

  ensure(height: number): void {
    if (this.pageIndex === 0 || this.y + height > CONTENT_BOTTOM) this.beginPage();
  }

  space(height: number): void {
    this.y += height;
  }

  rect(x: number, y: number, w: number, h: number, color: RGB): void {
    this.ops.push(`${fill(color)} ${num(x)} ${num(PAGE_H - y - h)} ${num(w)} ${num(h)} re f`);
  }

  outline(x: number, y: number, w: number, h: number, color: RGB): void {
    this.ops.push(
      `${stroke(color)} 0.8 w ${num(x)} ${num(PAGE_H - y - h)} ${num(w)} ${num(h)} re S`
    );
  }

  /** Rounded rectangle — pills pass `r = h / 2` for a capsule. */
  roundRect(x: number, y: number, w: number, h: number, r: number, color: RGB): void {
    const radius = Math.min(r, w / 2, h / 2);
    const k = radius * 0.5523;
    const b = PAGE_H - y - h;
    const t = PAGE_H - y;
    this.ops.push(
      [
        fill(color),
        `${num(x + radius)} ${num(b)} m`,
        `${num(x + w - radius)} ${num(b)} l`,
        `${num(x + w - radius + k)} ${num(b)} ${num(x + w)} ${num(b + radius - k)} ${num(x + w)} ${num(b + radius)} c`,
        `${num(x + w)} ${num(t - radius)} l`,
        `${num(x + w)} ${num(t - radius + k)} ${num(x + w - radius + k)} ${num(t)} ${num(x + w - radius)} ${num(t)} c`,
        `${num(x + radius)} ${num(t)} l`,
        `${num(x + radius - k)} ${num(t)} ${num(x)} ${num(t - radius + k)} ${num(x)} ${num(t - radius)} c`,
        `${num(x)} ${num(b + radius)} l`,
        `${num(x)} ${num(b + radius - k)} ${num(x + radius - k)} ${num(b)} ${num(x + radius)} ${num(b)} c`,
        "f",
      ].join(" ")
    );
  }

  /** One run of text with its baseline derived from the font ascender. */
  text(value: string, x: number, y: number, size: number, bold: boolean, color: RGB): void {
    if (!value) return;
    this.ops.push(
      `BT ${fill(color)} /${bold ? "F2" : "F1"} ${num(size)} Tf ` +
        `1 0 0 1 ${num(x)} ${num(PAGE_H - y - size * 0.82)} Tm ` +
        `(${pdfString(value, bold)}) Tj ET`
    );
  }

  /** Wrapped paragraph, page-breaking line by line. Advances `y`. */
  paragraph(
    parts: Inline[],
    options: {
      size: number;
      color: RGB;
      bold?: boolean;
      indent?: number;
      spacingAfter: number;
      bullet?: boolean;
      uppercase?: boolean;
    }
  ): void {
    const indent = options.indent ?? 0;
    const maxWidth = CONTENT_W - indent;
    const source = options.uppercase
      ? parts.map((part) => ({ ...part, text: part.text.toUpperCase() }))
      : parts;
    const forcedBold = options.bold ?? false;
    const list = words(source).map((word) => ({
      text: word.text,
      bold: forcedBold || word.bold,
    }));
    const lineHeight = options.size * 1.32;
    let first = true;
    for (const line of wrap(list, maxWidth, options.size)) {
      this.ensure(lineHeight);
      if (first && options.bullet) {
        this.text("\u2022", INSET + 2, this.y, options.size + 0.5, true, GREEN);
      }
      let x = INSET + indent;
      for (const word of line) {
        this.text(word.text, x, this.y, options.size, word.bold, options.color);
        x +=
          textWidth(word.text, word.bold, options.size) +
          textWidth(" ", word.bold, options.size);
      }
      this.y += lineHeight;
      first = false;
    }
    this.y += options.spacingAfter;
  }

  pills(list: Pill[], height: number, size: number, spacingAfter: number): void {
    if (list.length === 0) return;
    const gap = 8;
    this.ensure(height);
    let x = INSET;
    for (const pill of list) {
      const width = textWidth(pill.text, true, size) + 22;
      if (x > INSET && x + width > INSET + CONTENT_W) {
        this.y += height + gap;
        this.ensure(height);
        x = INSET;
      }
      this.roundRect(x, this.y, width, height, height / 2, pill.background);
      this.text(pill.text, x + 11, this.y + (height - size) / 2, size, true, pill.foreground);
      x += width + gap;
    }
    this.y += height + spacingAfter;
  }

  scorecard(rows: ScoreRow[], width: number, spacingAfter: number): void {
    if (rows.length === 0) return;
    const padding = 14;
    const rowHeight = 19;
    const height = padding * 2 + rows.length * rowHeight;
    this.ensure(height);

    const top = this.y;
    this.roundRect(INSET, top, width, height, 10, WHITE);
    this.outline(INSET, top, width, height, BORDER);

    const labelWidth = 56;
    const valueWidth = 48;
    const trackWidth = width - padding * 2 - labelWidth - valueWidth - 12;
    let rowTop = top + padding;
    for (const row of rows) {
      this.text(row.label, INSET + padding, rowTop + 3, 8.5, true, MUTED);
      if (trackWidth > 8) {
        const trackX = INSET + padding + labelWidth;
        this.roundRect(trackX, rowTop + 5, trackWidth, 6, 3, GREEN_LIGHT);
        this.roundRect(trackX, rowTop + 5, Math.max(6, trackWidth * row.fraction), 6, 3, GREEN_DARK);
      }
      const valueX =
        INSET + width - padding - textWidth(row.value, true, 8.5);
      this.text(row.value, valueX, rowTop + 3, 8.5, true, GREEN_DARK);
      rowTop += rowHeight;
    }
    this.y = top + height + spacingAfter;
  }

  table(headers: string[], rows: string[][], spacingAfter: number): void {
    const columns = Math.max(headers.length, ...rows.map((row) => row.length), 0);
    if (columns === 0) return;
    const size = 8.5;
    const padding = 8;

    const natural = new Array<number>(columns).fill(44);
    for (const cells of [headers, ...rows]) {
      cells.forEach((cell, index) => {
        if (index >= columns) return;
        natural[index] = Math.max(
          natural[index],
          Math.min(textWidth(cell, true, size) + padding * 2, 180)
        );
      });
    }
    const total = natural.reduce((sum, value) => sum + value, 0);
    const scale = total > 0 ? CONTENT_W / total : 1;
    const widths = natural.map((value) => value * scale);

    const cellHeight = (cells: string[]): number => {
      let lines = 1;
      cells.forEach((cell, index) => {
        if (index >= columns) return;
        const inner = Math.max(widths[index] - padding * 2, 12);
        lines = Math.max(lines, wrap(words([{ text: cell }]), inner, size).length);
      });
      return Math.max(lines * size * 1.32 + padding, 21);
    };

    const drawRow = (cells: string[], bold: boolean, color: RGB, height: number): void => {
      let x = INSET;
      cells.forEach((cell, index) => {
        if (index >= columns) return;
        const inner = Math.max(widths[index] - padding * 2, 12);
        let lineTop = this.y + padding * 0.5;
        for (const line of wrap(words([{ text: cell }]), inner, size)) {
          let textX = x + padding;
          for (const word of line) {
            this.text(word.text, textX, lineTop, size, bold, color);
            textX += textWidth(word.text, bold, size) + textWidth(" ", bold, size);
          }
          lineTop += size * 1.32;
        }
        x += widths[index];
      });
      this.y += height;
    };

    const headerHeight = headers.length > 0 ? cellHeight(headers) : 0;
    const paintHeader = (): void => {
      if (headers.length === 0) return;
      this.rect(INSET, this.y, CONTENT_W, headerHeight, GREEN_LIGHT);
      drawRow(headers, true, GREEN_DARK, headerHeight);
    };

    this.ensure(headerHeight + 46);
    let segmentTop = this.y;
    paintHeader();

    for (const row of rows) {
      const height = cellHeight(row);
      if (this.y + height > CONTENT_BOTTOM) {
        this.outline(INSET, segmentTop, CONTENT_W, this.y - segmentTop, BORDER);
        this.beginPage();
        segmentTop = this.y;
        paintHeader();
      }
      drawRow(row, false, INK, height);
      this.ops.push(
        `${stroke(BORDER)} 0.5 w ${num(INSET)} ${num(PAGE_H - this.y)} m ` +
          `${num(INSET + CONTENT_W)} ${num(PAGE_H - this.y)} l S`
      );
    }

    this.outline(INSET, segmentTop, CONTENT_W, this.y - segmentTop, BORDER);
    this.y += spacingAfter;
  }

  private footer(): void {
    const y = PAGE_H - INSET + 6;
    this.text("https://zenbuy.info/", INSET, y, 7.5, false, MUTED);
    const label =
      this.totalPages != null
        ? `Page ${this.pageIndex} of ${this.totalPages}`
        : `Page ${this.pageIndex}`;
    this.text(label, PAGE_W - INSET - textWidth(label, false, 7.5), y, 7.5, false, MUTED);
  }
}

// MARK: - Composition

export interface ReportPdfInput {
  title: string;
  badges?: Badges;
  scorecardHtml: string;
  bottomLineHtml: string;
  bodyHtml: string;
}

function drawBlocks(canvas: Canvas, blocks: Block[]): void {
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        canvas.ensure(block.level === 2 ? 34 : 26);
        canvas.paragraph([{ text: block.text }], {
          size: block.level === 2 ? 12 : 11.5,
          color: block.level === 2 ? GREEN_DARK : INK,
          bold: true,
          uppercase: block.level === 2,
          spacingAfter: block.level === 2 ? 9 : 6,
        });
        break;
      case "paragraph":
        canvas.paragraph(block.inlines, { size: 10.5, color: INK, spacingAfter: 9 });
        break;
      case "list":
        for (const item of block.items) {
          canvas.paragraph(item, {
            size: 10.5,
            color: INK,
            indent: 14,
            spacingAfter: 7,
            bullet: true,
          });
        }
        canvas.space(3);
        break;
      case "table":
        canvas.table(block.headers, block.rows, 14);
        break;
    }
  }
}

function composePages(input: ReportPdfInput, totalPages: number | null): string[] {
  const canvas = new Canvas(totalPages);
  canvas.beginPage();

  canvas.paragraph([{ text: input.title }], {
    size: 22,
    color: INK,
    bold: true,
    spacingAfter: 2,
  });
  canvas.paragraph([{ text: "ZenBuy research report" }], {
    size: 10.5,
    color: MUTED,
    spacingAfter: 12,
  });
  canvas.pills(badgePills(input.badges), 22, 10, 18);
  canvas.scorecard(scoreRowsFromHtml(input.scorecardHtml), 300, 16);

  drawBlocks(canvas, blocksFromHtml(input.bottomLineHtml));
  drawBlocks(canvas, blocksFromHtml(input.bodyHtml));

  return canvas.finish();
}

/** Latin-1 char-per-byte string to bytes. */
function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function assemble(pages: string[]): Uint8Array {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const firstPage = 5;
  objects[1] =
    `<< /Type /Pages /Kids [` +
    pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ") +
    `] /Count ${pages.length} >>`;

  pages.forEach((content, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
        `/Contents ${firstPage + index * 2 + 1} 0 R >>`
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  file +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;

  return latin1(file);
}

/**
 * Colour PDF bytes for a finished report. Composed twice so the footer can
 * carry "Page 2 of 7" — the same probe pass the iOS exporter runs.
 */
export function renderReportPdf(input: ReportPdfInput): Uint8Array {
  const probe = composePages(input, null);
  return assemble(composePages(input, probe.length));
}

export function reportPdfFilename(title: string): string {
  const safe = title.replace(/[^A-Za-z0-9.\-]+/g, "-").replace(/^-+|-+$/g, "");
  return `ZenBuy-${safe || "report"}-report.pdf`;
}
