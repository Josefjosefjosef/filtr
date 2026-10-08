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
  | "document_pdf_replaced";

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

export function formatPremiumOrderEventLineCs(event: {
  event_type: string;
  payload: Record<string, unknown>;
  created_at_label_cs: string;
  actor_user_id: string | null;
}): string {
  const who = typeof event.payload.actor_label === "string" ? event.payload.actor_label : event.actor_user_id || "Systém";
  switch (event.event_type) {
    case "order_submitted":
      return "Objednávka odeslána ke schválení a zveřejnění objednatelem";
    case "order_approved_published":
      return "Schválil a zveřejnil " + who;
    case "order_rejected":
      return "Objednávka zamítnuta" + (event.payload.reason ? ": " + String(event.payload.reason) : "");
    case "payment_status_changed":
      return "Stav platby: " + String(event.payload.from || "?") + " → " + String(event.payload.to || "?");
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
        "Reklama prodloužena " +
        formatAdminPragueDateTime(String(event.payload.old_end_at || "")) +
        " → " +
        formatAdminPragueDateTime(String(event.payload.new_end_at || ""))
      );
    case "creative_change_requested":
      return "Požadována změna reklamy (verze " + String(event.payload.version || "?") + ", čeká na schválení)";
    case "order_deleted":
      return event.payload.mode === "archived" ? "Objednávka stornována/archivována" : "Objednávka odstraněna";
    case "admin_edit":
      return "Administrativní úprava" + (event.payload.field ? ": " + String(event.payload.field) : "");
    case "order_confirmation_pdf_created":
      return "Potvrzení objednávky (PDF) vytvořeno";
    case "invoice_pdf_created":
      return "PDF faktury vytvořeno a uloženo";
    case "document_generation_failed":
      return "Chyba generování dokumentu" + (event.payload.error ? ": " + String(event.payload.error) : "");
    case "document_generation_retried":
      return "Opakované generování dokumentů dokončeno";
    default:
      return event.event_type;
  }
}
