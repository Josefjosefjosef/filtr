/**
 * Premium order timeline (admin-visible; internal notes separate).
 */
import { newId } from "./admin-auth";
import { formatAdminPragueDateTime } from "./premium-order-workflow";

export type PremiumOrderEventType =
  | "order_submitted"
  | "order_approved_published"
  | "order_rejected"
  | "payment_status_changed"
  | "contact_updated"
  | "admin_edit"
  | "note_added"
  | "campaign_paused"
  | "campaign_resumed"
  | "renewal_applied"
  | "creative_change_requested"
  | "order_deleted"
  | "order_confirmation_pdf_created"
  | "invoice_pdf_created"
  | "document_generation_failed"
  | "document_generation_retried"
  | "document_pdf_replaced"
  | "ad_turned_off"
  | "order_accounting_cancelled"
  | "storno_pdf_created"
  | "credit_note_pdf_created"
  | "rejected_order_credit_note_issued";

export async function appendPremiumOrderEvent(
  db: D1Database,
  input: {
    orderId: string;
    eventType: PremiumOrderEventType;
    payload: Record<string, unknown>;
    actorUserId: string | null;
    createdAt?: string;
  }
): Promise<string> {
  const eventId = newId("poe");
  const nowIso = input.createdAt || new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO premium_order_events (event_id, order_id, event_type, payload_json, actor_user_id, created_at) VALUES (?,?,?,?,?,?)"
    )
    .bind(eventId, input.orderId, input.eventType, JSON.stringify(input.payload), input.actorUserId, nowIso)
    .run();
  return eventId;
}

export async function listPremiumOrderEvents(db: D1Database, orderId: string, limit = 100) {
  const res = await db
    .prepare(
      "SELECT event_id, event_type, payload_json, actor_user_id, created_at FROM premium_order_events WHERE order_id = ? ORDER BY created_at ASC LIMIT ?"
    )
    .bind(orderId, limit)
    .all<{ event_id: string; event_type: string; payload_json: string; actor_user_id: string | null; created_at: string }>();
  return (res.results || []).map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return {
      event_id: row.event_id,
      event_type: row.event_type,
      payload,
      actor_user_id: row.actor_user_id,
      created_at: row.created_at,
      created_at_label_cs: formatAdminPragueDateTime(row.created_at),
    };
  });
}

const PREMIUM_HISTORY_FIELD_LABELS: Record<string, string> = {
  company_name: "název firmy",
  ico: "IČO",
  dic: "DIČ",
  billing: "fakturační údaje",
  ordering_person: "objednávající osoba",
  contact_person: "kontaktní osoba",
  email: "e-mail",
  phone: "telefon",
  ad_title: "nadpis reklamy",
  note: "interní poznámka",
  placement: "reklamní pozice",
  target_url: "cílová URL",
  creative_mode: "režim kreativy",
  creative_id: "kreativa",
  service_period: "období služby",
  price: "cena reklamní služby",
};

/** Map stored doc_type / doc_kind to Czech document label for timeline (no guessing from missing data). */
export function premiumHistoryDocumentLabelFromPayload(payload: Record<string, unknown>): string | null {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (title.startsWith("Faktura ")) return title.slice("Faktura ".length).trim() || null;
  if (title.startsWith("Storno objednávky ")) return title.slice("Storno objednávky ".length).trim() || null;
  if (title.startsWith("Dobropis ")) return title.slice("Dobropis ".length).trim() || null;
  if (typeof payload.invoice_number === "string" && payload.invoice_number.trim()) return payload.invoice_number.trim();
  if (typeof payload.storno_number === "string" && payload.storno_number.trim()) return payload.storno_number.trim();
  if (typeof payload.credit_note_number === "string" && payload.credit_note_number.trim()) {
    return payload.credit_note_number.trim();
  }
  if (typeof payload.evidence_reference === "string" && payload.evidence_reference.trim()) {
    return payload.evidence_reference.trim();
  }
  const docType = String(payload.doc_type || payload.doc_kind || "");
  if (docType === "premium_invoice_pdf" || payload.doc_kind === "invoice_pdf") return null;
  return null;
}

function premiumHistoryDocumentKindCs(payload: Record<string, unknown>): string {
  const docType = String(payload.doc_type || "");
  const docKind = String(payload.doc_kind || "");
  if (docType === "premium_order_confirmation" || docKind === "order_confirmation") return "Potvrzení objednávky";
  if (docType === "premium_invoice_pdf" || docKind === "invoice_pdf") return "Faktura";
  if (docType === "premium_order_cancellation" || docKind === "order_cancellation") {
    return "Potvrzení o stornu objednávky";
  }
  if (docType === "premium_credit_note_pdf" || docKind === "credit_note_pdf") return "Dobropis";
  return "Dokument";
}

function formatDocumentHistoryLine(payload: Record<string, unknown>, op: "created" | "updated"): string {
  const kind = premiumHistoryDocumentKindCs(payload);
  const num = premiumHistoryDocumentLabelFromPayload(payload);
  const ver =
    payload.new_version != null
      ? Number(payload.new_version)
      : payload.version != null
        ? Number(payload.version)
        : null;
  const idPart = num ? " " + num : "";
  if (op === "created") {
    if (kind === "Faktura") return "Faktura" + idPart + " vystavena a PDF uloženo.";
    if (kind === "Dobropis") return "Dobropis" + idPart + " vystaven.";
    if (kind === "Potvrzení o stornu objednávky") return "Potvrzení o stornu objednávky" + idPart + " vytvořeno.";
    if (kind === "Potvrzení objednávky") {
      return ver && ver > 1
        ? "Potvrzení objednávky" + idPart + " vytvořeno – verze " + String(ver) + "."
        : "Potvrzení objednávky" + idPart + " vytvořeno.";
    }
    return kind + idPart + " vytvořeno.";
  }
  const verSuffix = ver && ver > 1 ? " – verze " + String(ver) : "";
  if (kind === "Potvrzení objednávky") {
    return "Potvrzení objednávky" + idPart + " aktualizováno – předchozí verze archivována" + verSuffix + ".";
  }
  if (kind === "Faktura") return "Faktura" + idPart + " aktualizována – předchozí verze archivována" + verSuffix + ".";
  if (kind === "Dobropis") return "Dobropis" + idPart + " aktualizován – předchozí verze archivována" + verSuffix + ".";
  if (kind === "Potvrzení o stornu objednávky") {
    return kind + idPart + " aktualizováno – předchozí verze archivována" + verSuffix + ".";
  }
  return kind + idPart + " aktualizován – předchozí verze archivována" + verSuffix + ".";
}

function historyActorLabel(event: {
  payload: Record<string, unknown>;
  actor_user_id: string | null;
}): string {
  if (typeof event.payload.actor_label === "string" && event.payload.actor_label.trim()) {
    return event.payload.actor_label.trim();
  }
  if (typeof event.payload.actor_display_name === "string" && event.payload.actor_display_name.trim()) {
    return event.payload.actor_display_name.trim();
  }
  return "Systém";
}

export function formatPremiumOrderEventLineCs(event: {
  event_type: string;
  payload: Record<string, unknown>;
  created_at_label_cs: string;
  actor_user_id: string | null;
}): string {
  const who = historyActorLabel(event);
  switch (event.event_type) {
    case "order_submitted":
      return "Objednávka odeslána ke schválení";
    case "order_approved_published":
      return "Objednávka schválena a reklama zveřejněna" + (who !== "Systém" ? " (" + who + ")" : "");
    case "order_rejected":
      return "Objednávka stornována" + (event.payload.reason ? ": " + String(event.payload.reason) : "");
    case "payment_status_changed": {
      const to = String(event.payload.to || "");
      if (to === "paid") return "Úhrada faktury potvrzena administrátorem" + (who !== "Systém" ? " (" + who + ")" : "");
      if (to === "partial") return "Částečná úhrada faktury zaznamenána" + (who !== "Systém" ? " (" + who + ")" : "");
      if (to === "unpaid") return "Faktura označena jako neuhrazená" + (who !== "Systém" ? " (" + who + ")" : "");
      return "Stav platby faktury aktualizován";
    }
    case "contact_updated":
      return (
        String(event.payload.field || "Údaj") +
        " změněn: " +
        String(event.payload.from || "—") +
        " → " +
        String(event.payload.to || "—")
      );
    case "note_added":
      return "Přidána interní poznámka";
    case "campaign_paused":
      return "Reklama pozastavena" + (event.payload.reason ? ": " + String(event.payload.reason) : "");
    case "campaign_resumed":
      return "Reklama znovu spuštěna";
    case "renewal_applied":
      return (
        "Reklama prodloužena · " +
        formatAdminPragueDateTime(String(event.payload.old_end_at || "")) +
        " → " +
        formatAdminPragueDateTime(String(event.payload.new_end_at || "")) +
        (event.payload.new_order_id ? " · nová objednávka vytvořena" : "")
      );
    case "creative_change_requested":
      return "Požadována změna reklamy (verze " + String(event.payload.version || "?") + ", čeká na schválení)";
    case "order_deleted":
      return event.payload.mode === "archived" ? "Objednávka stornována/archivována" : "Objednávka odstraněna";
    case "admin_edit": {
      const fields = Array.isArray(event.payload.fields)
        ? (event.payload.fields as string[])
        : event.payload.field
          ? [String(event.payload.field)]
          : [];
      const labels = fields.map((f) => PREMIUM_HISTORY_FIELD_LABELS[f] || f.replace(/_/g, " "));
      let line = "Objednávka upravena administrátorem" + (who !== "Systém" ? " (" + who + ")" : "");
      if (labels.length) line += " · Změněno: " + labels.join(", ");
      if (event.payload.confirmation_regenerated) {
        const ver = event.payload.confirmation_version != null ? Number(event.payload.confirmation_version) : null;
        line += ver && ver > 0 ? " · Vygenerováno nové potvrzení objednávky – verze " + String(ver) : " · Nové potvrzení objednávky se generuje";
      }
      return line;
    }
    case "order_confirmation_pdf_created":
      return formatDocumentHistoryLine(
        { ...event.payload, doc_kind: "order_confirmation", doc_type: "premium_order_confirmation" },
        "created"
      );
    case "invoice_pdf_created":
      return formatDocumentHistoryLine(
        { ...event.payload, doc_kind: "invoice_pdf", doc_type: "premium_invoice_pdf" },
        "created"
      );
    case "document_generation_failed":
      return "Chyba generování dokumentu" + (event.payload.error ? ": " + String(event.payload.error) : "");
    case "document_generation_retried":
      return "Opakované generování dokumentů dokončeno";
    case "document_pdf_replaced":
      return formatDocumentHistoryLine(event.payload, "updated");
    case "ad_turned_off":
      return "Reklama definitivně vypnuta" + (event.payload.reason ? ": " + String(event.payload.reason) : "");
    case "order_accounting_cancelled":
      return (
        "Objednávka stornována" +
        (event.payload.storno_number ? " (" + String(event.payload.storno_number) + ")" : "")
      );
    case "storno_pdf_created":
      return formatDocumentHistoryLine(
        { ...event.payload, doc_kind: "order_cancellation", doc_type: "premium_order_cancellation" },
        "created"
      );
    case "credit_note_pdf_created":
      return formatDocumentHistoryLine(
        { ...event.payload, doc_kind: "credit_note_pdf", doc_type: "premium_credit_note_pdf" },
        "created"
      );
    case "rejected_order_credit_note_issued":
      return "Dobropis ke stornované objednávce vystaven";
    default:
      return event.event_type.replace(/_/g, " ");
  }
}
