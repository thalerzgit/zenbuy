/**
 * `POST /api/report/email` — mail a finished report as a colour PDF.
 *
 * Apple TV has no share sheet and no Mail app, so the TV build asks the Worker
 * to render and send. The report id is the capability: the report has to already
 * be in KV, which means the caller just watched it generate.
 *
 * Requires the `RESEND_API_KEY` Worker secret and the `REPORT_EMAIL_FROM` var.
 * Without them the endpoint answers 503 rather than failing silently.
 */

import {
  cacheGet,
  parseReportCacheKey,
  RATE_LIMIT_TTL_SECONDS,
  type CachedReport,
} from "./cache.ts";
import { isNormalEmail } from "./unlock.ts";
import { renderReportPdf, reportPdfFilename } from "./report-pdf.ts";

/** Emails per device per rolling day. Generous for one household, useless for a spammer. */
export const REPORT_EMAIL_DAILY_LIMIT = 10;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ReportEmailRequest {
  reportId: string;
  email: string;
}

export type ReportEmailRejection = {
  error: string;
  code: string;
  status: number;
};

export function parseReportEmailRequest(
  body: unknown
): ReportEmailRequest | ReportEmailRejection {
  const raw = (body ?? {}) as { reportId?: unknown; email?: unknown };
  const reportId = typeof raw.reportId === "string" ? raw.reportId.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim() : "";

  if (!reportId.startsWith("report:") || reportId.length > 200) {
    return {
      error: "Generate a report first, then send it.",
      code: "not_found",
      status: 404,
    };
  }
  if (!isNormalEmail(email) || email.length > 254) {
    return {
      error: "Enter a full email address, like you@example.com.",
      code: "bad_email",
      status: 400,
    };
  }
  return { reportId, email };
}

function isRejection(
  value: ReportEmailRequest | ReportEmailRejection
): value is ReportEmailRejection {
  return "error" in value;
}

export function reportEmailSubject(symbols: string[]): string {
  const names = symbols.filter(Boolean).join(", ");
  return names ? `ZenBuy report — ${names}` : "ZenBuy research report";
}

/**
 * Short covering note. The PDF is the report; this only says what arrived and
 * repeats the verdict so the mail is useful from a lock screen.
 */
export function reportEmailBody(
  title: string,
  badges: CachedReport["badges"]
): { html: string; text: string } {
  const verdict = [badges?.recommendation, badges?.conviction, badges?.sentiment]
    .filter((value) => Boolean(value?.trim()))
    .join(" · ");
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#16181A;line-height:1.5">` +
    `<p style="margin:0 0 12px"><strong style="color:#1A5C28">ZenBuy</strong> research report — ${escape(title)}</p>` +
    (verdict
      ? `<p style="margin:0 0 12px;color:#1A5C28;font-weight:600">${escape(verdict)}</p>`
      : "") +
    `<p style="margin:0 0 12px">The full colour report is attached as a PDF.</p>` +
    `<p style="margin:0;color:#5A6168;font-size:13px">Research only — not investment advice. ` +
    `<a href="https://zenbuy.info/" style="color:#247A36">zenbuy.info</a></p>` +
    `</div>`;

  const text = [
    `ZenBuy research report — ${title}`,
    verdict,
    "The full colour report is attached as a PDF.",
    "Research only — not investment advice. https://zenbuy.info/",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function callerId(request: Request): string {
  return (
    request.headers.get("X-ZenBuy-Device")?.slice(0, 64) ||
    request.headers.get("CF-Connecting-IP") ||
    "unknown"
  );
}

/** Day-bucketed counter. Returns false once the caller is over the limit. */
async function claimSend(kv: KVNamespace, id: string): Promise<boolean> {
  const key = `mailrate:${new Date().toISOString().slice(0, 10)}:${id}`;
  const used = Number((await kv.get(key)) ?? "0");
  if (Number.isFinite(used) && used >= REPORT_EMAIL_DAILY_LIMIT) return false;
  await kv.put(key, String((Number.isFinite(used) ? used : 0) + 1), {
    expirationTtl: RATE_LIMIT_TTL_SECONDS,
  });
  return true;
}

export async function handleReportEmail(
  request: Request,
  env: Env,
  json: (data: unknown, status?: number) => Response
): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.REPORT_EMAIL_FROM) {
    return json(
      {
        error: "Emailing reports isn't switched on yet. Try again later.",
        code: "email_unconfigured",
      },
      503
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request.", code: "bad_request" }, 400);
  }

  const parsed = parseReportEmailRequest(body);
  if (isRejection(parsed)) {
    return json({ error: parsed.error, code: parsed.code }, parsed.status);
  }

  // Looked up before the counter moves so an expired report does not cost the
  // viewer one of the day's sends.
  const report = await cacheGet<CachedReport>(env.CACHE, parsed.reportId);
  if (!report?.bottomLineHtml?.trim() && !report?.bodyHtml?.trim()) {
    return json(
      {
        error: "That report has expired. Generate a fresh one, then send it.",
        code: "report_expired",
      },
      404
    );
  }

  if (!(await claimSend(env.CACHE, callerId(request)))) {
    return json(
      {
        error: `That's ${REPORT_EMAIL_DAILY_LIMIT} emailed reports today. Try again tomorrow.`,
        code: "rate_limited",
      },
      429
    );
  }

  const { symbols } = parseReportCacheKey(parsed.reportId);
  const title = symbols.join(", ") || "ZenBuy report";
  const pdf = renderReportPdf({
    title,
    badges: report!.badges,
    scorecardHtml: report!.scorecardHtml ?? "",
    bottomLineHtml: report!.bottomLineHtml ?? "",
    bodyHtml: report!.bodyHtml ?? "",
  });

  const { html, text } = reportEmailBody(title, report!.badges);
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.REPORT_EMAIL_FROM,
      to: [parsed.email],
      subject: reportEmailSubject(symbols),
      html,
      text,
      attachments: [
        { filename: reportPdfFilename(title), content: base64(pdf) },
      ],
    }),
  });

  if (!response.ok) {
    // Resend's own message names the real fault (unverified sender, bad key),
    // which is the difference between "retry" and "fix the config".
    const detail = await response.text().catch(() => "");
    console.log(
      `report_email_failed status=${response.status} detail=${detail.slice(0, 300)}`
    );
    return json(
      {
        error: "The mail service turned that down. Check the address and try again.",
        code: "send_failed",
      },
      502
    );
  }

  return json({ ok: true, bytes: pdf.length });
}
