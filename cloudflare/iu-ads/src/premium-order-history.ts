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
      return "Objednávka zamítnuta" + (event.payload.reason ? ": " + String(event.payload.reason) : "");
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
    case "order_confirmation_pdf_created": {
      const ver = event.payload.version != null ? Number(event.payload.version) : 1;
      return ver > 1
        ? "Vygenerováno nové potvrzení objednávky – verze " + String(ver)
        : "Potvrzení objednávky vytvořeno";
    }
    case "invoice_pdf_created":
      return "Faktura vystavena (PDF uloženo)";
    case "document_generation_failed":
      return "Chyba generování dokumentu" + (event.payload.error ? ": " + String(event.payload.error) : "");
    case "document_generation_retried":
      return "Opakované generování dokumentů dokončeno";
    case "document_pdf_replaced": {
      const kind = String(event.payload.doc_kind || "dokument");
      const ver = event.payload.version != null ? Number(event.payload.version) : null;
      if (kind === "order_confirmation" && ver) {
        return "Vygenerováno nové potvrzení objednávky – verze " + String(ver);
      }
      return "Dokument aktualizován (archiv předchozí verze zachován)";
    }
    case "ad_turned_off":
      return "Reklama definitivně vypnuta" + (event.payload.reason ? ": " + String(event.payload.reason) : "");
    case "order_accounting_cancelled":
      return (
        "Objednávka stornována" +
        (event.payload.storno_number ? " (" + String(event.payload.storno_number) + ")" : "")
      );
    case "storno_pdf_created":
      return "Potvrzení o stornování objednávky vytvořeno";
    case "credit_note_pdf_created":
      return "Dobropis vystaven";
    case "rejected_order_credit_note_issued":
      return "Dobropis k zamítnuté objednávce vystaven";
    default:
      return event.event_type.replace(/_/g, " ");
  }
}
