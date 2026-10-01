/**
 * Idempotent transactional email outbox for premium workflow.
 * Uses MailChannels fetch when ADS_MAIL_FROM is configured; otherwise records queued row only.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, newId } from "./admin-auth";
import type { Env } from "./types";

export type EmailPayload = {
  to: string;
  subject: string;
  bodyText: string;
  idempotencyKey: string;
};

export async function enqueuePremiumEmail(db: D1Database, env: Env, payload: EmailPayload): Promise<{ sent: boolean; duplicate: boolean }> {
  const existing = await db
    .prepare("SELECT outbox_id, status FROM email_outbox WHERE idempotency_key = ?")
    .bind(payload.idempotencyKey)
    .first<{ outbox_id: string; status: string }>();
  if (existing) return { sent: existing.status === "sent", duplicate: true };

  const outboxId = newId("eml");
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO email_outbox (outbox_id, idempotency_key, to_email, subject, body_text, status, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(outboxId, payload.idempotencyKey, payload.to, payload.subject, payload.bodyText, "queued", nowIso)
    .run();

  let status = "queued";
  let providerResponse: string | null = null;
  const from = env.ADS_MAIL_FROM?.trim();
  if (from && payload.to.includes("@")) {
    try {
      const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: payload.to }] }],
          from: { email: from, name: "InfoUzel Ads" },
          subject: payload.subject,
          content: [{ type: "text/plain", value: payload.bodyText }],
        }),
      });
      providerResponse = "http_" + res.status;
      if (res.ok) status = "sent";
      else status = "failed";
    } catch (err) {
      providerResponse = "error";
      status = "failed";
    }
  } else {
    providerResponse = "mail_not_configured";
    status = "queued";
  }

  await db
    .prepare("UPDATE email_outbox SET status = ?, provider_response = ?, sent_at = ? WHERE outbox_id = ?")
    .bind(status, providerResponse, status === "sent" ? nowIso : null, outboxId)
    .run();

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: null,
      operation: "premium_email_outbox",
      objectType: "email_outbox",
      objectId: outboxId,
      before: null,
      after: { status, idempotency_key: payload.idempotencyKey },
      result: status === "sent" ? "success" : "partial",
    })
  );

  return { sent: status === "sent", duplicate: false };
}
