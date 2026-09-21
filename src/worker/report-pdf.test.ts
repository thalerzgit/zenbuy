import assert from "node:assert/strict";
import test from "node:test";

import {
  blocksFromHtml,
  renderReportPdf,
  reportPdfFilename,
  scoreRowsFromHtml,
} from "./report-pdf.ts";
import {
  parseReportEmailRequest,
  reportEmailBody,
  reportEmailRejectLog,
  reportEmailSubject,
} from "./report-email.ts";

const SCORECARD =
  '<div class="scorecard">' +
  '<div class="score-row"><span class="score-label">Growth</span><div class="score-bar">' +
  '<div class="score-fill" style="width:80%"></div></div><span class="score-num">8/10</span></div>' +
  '<div class="score-row"><span class="score-label">Moat</span><div class="score-bar">' +
  '<div class="score-fill" style="width:60%"></div></div><span class="score-num">6/10</span></div>' +
  "</div>";

const BOTTOM =
  "<h2>BOTTOM LINE</h2><p>Verdict: <strong>Buy</strong> \u2014 NVDA stays the " +
  'default AI compute holding. <a class="src-link" href="https://finance.yahoo.com/">Yahoo</a></p>';

const BODY =
  "<h2>FUNDAMENTALS</h2>" +
  '<div class="table-scroll"><table><thead><tr><th>Metric</th><th>Value</th></tr></thead>' +
  "<tbody><tr><td>Revenue growth</td><td>94%</td></tr><tr><td>Gross margin</td><td>75%</td></tr>" +
  "</tbody></table></div>" +
  "<h3>Risks</h3><ul><li>Customer <strong>concentration</strong></li><li>Export controls</li></ul>" +
  "<p>Long paragraph. ".repeat(300) +
  "</p>";

test("blocksFromHtml keeps headings, tables, and bold runs", () => {
  const bottom = blocksFromHtml(BOTTOM);
  assert.deepEqual(bottom[0], { kind: "heading", level: 2, text: "BOTTOM LINE" });
  assert.equal(bottom[1].kind, "paragraph");
  if (bottom[1].kind === "paragraph") {
    assert.ok(bottom[1].inlines.some((run) => run.bold && run.text === "Buy"));
    // Link labels survive; the href does not belong in a printed page.
    assert.ok(bottom[1].inlines.some((run) => run.text.includes("Yahoo")));
  }

  const body = blocksFromHtml(BODY);
  const table = body.find((block) => block.kind === "table");
  assert.ok(table && table.kind === "table");
  assert.deepEqual(table.headers, ["Metric", "Value"]);
  assert.equal(table.rows.length, 2);

  const list = body.find((block) => block.kind === "list");
  assert.ok(list && list.kind === "list");
  assert.equal(list.items.length, 2);
});

test("scoreRowsFromHtml reads label, value, and bar fraction", () => {
  assert.deepEqual(scoreRowsFromHtml(SCORECARD), [
    { label: "Growth", value: "8/10", fraction: 0.8 },
    { label: "Moat", value: "6/10", fraction: 0.6 },
  ]);
});

test("renderReportPdf emits a multi-page PDF with a matching xref", () => {
  const bytes = renderReportPdf({
    title: "NVDA",
    badges: { recommendation: "Buy", conviction: "High", sentiment: "Bullish" },
    scorecardHtml: SCORECARD,
    bottomLineHtml: BOTTOM,
    bodyHtml: BODY,
  });

  const file = Buffer.from(bytes).toString("latin1");
  assert.ok(file.startsWith("%PDF-"));
  assert.ok(file.trimEnd().endsWith("%%EOF"));

  const count = Number(file.match(/\/Count (\d+)/)?.[1]);
  assert.ok(count > 1, "a 300-paragraph body must paginate");
  assert.equal((file.match(/\/Type \/Page\b/g) ?? []).length, count);
  // Footers are numbered only after the probe pass knows the total.
  assert.ok(file.includes(`Page 1 of ${count}`));

  // Every xref offset must land on its own object header, or readers reject it.
  const startxref = Number(file.match(/startxref\n(\d+)/)?.[1]);
  const rows = file
    .slice(startxref)
    .match(/^(\d{10}) 00000 n $/gm)!
    .map((row) => Number(row.slice(0, 10)));
  rows.forEach((offset, index) => {
    assert.ok(
      file.startsWith(`${index + 1} 0 obj`, offset),
      `object ${index + 1} offset ${offset} does not point at its header`
    );
  });
});

test("renderReportPdf survives an empty report", () => {
  const bytes = renderReportPdf({
    title: "AAPL",
    scorecardHtml: "",
    bottomLineHtml: "",
    bodyHtml: "",
  });
  assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF-"));
});

test("reportPdfFilename is safe for a mail attachment", () => {
  assert.equal(reportPdfFilename("NVDA, AMD"), "ZenBuy-NVDA-AMD-report.pdf");
  assert.equal(reportPdfFilename("../etc"), "ZenBuy-..-etc-report.pdf");
  assert.equal(reportPdfFilename(""), "ZenBuy-report-report.pdf");
});

test("parseReportEmailRequest rejects anything but a real report id and address", () => {
  const ok = parseReportEmailRequest({
    reportId: " report:separate:growth:h7:NVDA ",
    email: " Someone@Example.com ",
  });
  assert.deepEqual(ok, {
    reportId: "report:separate:growth:h7:NVDA",
    email: "Someone@Example.com",
  });

  for (const body of [
    {},
    { reportId: "share:abc", email: "a@b.co" },
    { reportId: `report:${"x".repeat(220)}`, email: "a@b.co" },
  ]) {
    assert.equal((parseReportEmailRequest(body) as { code: string }).code, "not_found");
  }

  for (const email of ["", "   ", undefined]) {
    const rejected = parseReportEmailRequest({ reportId: "report:separate:growth:NVDA", email });
    assert.equal((rejected as { code: string }).code, "missing_email");
    assert.equal(
      (rejected as { error: string }).error,
      "The email address was missing from the request."
    );
  }
  assert.equal(
    (parseReportEmailRequest({ reportId: "report:separate:growth:NVDA" }) as { code: string }).code,
    "missing_email"
  );

  for (const email of ["nope", "a@b", "a b@c.co"]) {
    const rejected = parseReportEmailRequest({ reportId: "report:separate:growth:NVDA", email });
    assert.equal((rejected as { code: string }).code, "bad_email");
    assert.equal(
      (rejected as { error: string }).error,
      "Enter a full email address, like you@example.com."
    );
  }

  const justin = parseReportEmailRequest({
    reportId: "report:separate:growth:h7:NVDA",
    email: "gary.morgenthaler@iCloud.com",
  });
  assert.deepEqual(justin, {
    reportId: "report:separate:growth:h7:NVDA",
    email: "gary.morgenthaler@iCloud.com",
  });

  const tvLookalike = parseReportEmailRequest({
    reportId: "report:separate:growth:h7:NVDA",
    email: "\u200Bgary.morgenthaler＠iCloud\u3002com\u00A0",
  });
  assert.deepEqual(tvLookalike, {
    reportId: "report:separate:growth:h7:NVDA",
    email: "gary.morgenthaler@iCloud.com",
  });
});

test("reportEmailRejectLog never includes the local part", () => {
  const email = "gary.morgenthaler@iCloud.com";
  assert.equal(reportEmailRejectLog("missing_email", email), "report_email missing_email");
  const line = reportEmailRejectLog("bad_email", email);
  assert.equal(line, `report_email bad_email length=${email.length} domain=icloud.com`);
  assert.ok(!line.toLowerCase().includes("gary"));
  assert.ok(!line.includes("morgenthaler"));
});

test("report email subject and body carry the tickers and verdict", () => {
  assert.equal(reportEmailSubject(["NVDA", "AMD"]), "ZenBuy report — NVDA, AMD");
  assert.equal(reportEmailSubject([]), "ZenBuy research report");

  const { html, text } = reportEmailBody("NVDA", {
    recommendation: "Buy",
    conviction: "High",
  });
  assert.ok(html.includes("Buy · High"));
  assert.ok(text.includes("NVDA"));
  assert.ok(!html.includes("<script"));
});
