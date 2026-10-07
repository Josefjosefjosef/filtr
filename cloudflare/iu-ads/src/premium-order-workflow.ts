/**
 * Premium order workflow labels + admin presentation (authoritative backend states).
 */
import {
  formatPremiumTotalPriceLabelCs,
  PREMIUM_DURATION_MONTHS,
  premiumCategoryTitleCs,
  type PremiumPosition,
} from "./premium-selected-services";

export const PREMIUM_ORDER_PENDING_STATUSES = ["submitted", "under_review"] as const;
export type PremiumOrderPendingStatus = (typeof PREMIUM_ORDER_PENDING_STATUSES)[number];

export function isPremiumOrderPendingStatus(status: string): boolean {
  return (PREMIUM_ORDER_PENDING_STATUSES as readonly string[]).includes(status);
}

export function premiumOrderMissingPublishFields(input: {
  creative_id: string | null | undefined;
  target_url: string | null | undefined;
}): ("creative" | "target_url")[] {
  const missing: ("creative" | "target_url")[] = [];
  if (!input.target_url || !String(input.target_url).trim()) missing.push("target_url");
  if (!input.creative_id || !String(input.creative_id).trim()) missing.push("creative");
  return missing;
}

/** Authoritative: approve-publish requires uploaded creative + target URL from order row. */
export function isPremiumOrderPublishable(input: {
  workflow_status: string;
  creative_id: string | null | undefined;
  target_url: string | null | undefined;
}): boolean {
  if (!isPremiumOrderPendingStatus(input.workflow_status)) return false;
  return premiumOrderMissingPublishFields(input).length === 0;
}

export function premiumWorkflowStatusLabelCs(
  status: string,
  opts?: { creative_id?: string | null; target_url?: string | null }
): string {
  switch (status) {
    case "submitted":
      if (opts && premiumOrderMissingPublishFields(opts).includes("creative")) {
        return "Čeká na nahrání kreativy";
      }
      return "Čeká na posouzení";
    case "under_review":
      if (opts && premiumOrderMissingPublishFields(opts).length > 0) {
        return "Neúplná — nelze zveřejnit";
      }
      return "Čeká na posouzení";
    case "published":
      return "Schváleno a zveřejněno";
    case "rejected":
      return "Zamítnuto";
    default:
      return status || "—";
  }
}

/** Admin display — Europe/Prague from UTC ISO timestamp. */
export function formatAdminPragueDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso);
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      timeZone: "Europe/Prague",
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(t));
  } catch {
    return String(iso);
  }
}

export type PremiumOrderPayloadSnapshot = {
  ico: string | null;
  dic: string | null;
  terms_version: string | null;
  terms_effective_at: string | null;
  ordering_person_name: string | null;
  authorization_confirmed: boolean;
  agreed_price_cents: number | null;
  creative_mode: string | null;
  billing: { street: string; city: string; zip: string; country: string; dic: string | null } | null;
  note: string | null;
};

export function parsePremiumOrderPayload(payloadJson: string | null | undefined): PremiumOrderPayloadSnapshot {
  const empty: PremiumOrderPayloadSnapshot = {
    ico: null,
    dic: null,
    terms_version: null,
    terms_effective_at: null,
    ordering_person_name: null,
    authorization_confirmed: false,
    agreed_price_cents: null,
    creative_mode: null,
    billing: null,
    note: null,
  };
  if (!payloadJson) return empty;
  try {
    const p = JSON.parse(payloadJson) as Record<string, unknown>;
    if (!p || typeof p !== "object") return empty;
    let billing: PremiumOrderPayloadSnapshot["billing"] = null;
    if (p.billing && typeof p.billing === "object") {
      const b = p.billing as Record<string, unknown>;
      billing = {
        street: typeof b.street === "string" ? b.street : "",
        city: typeof b.city === "string" ? b.city : "",
        zip: typeof b.zip === "string" ? b.zip : "",
        country: typeof b.country === "string" ? b.country : "",
        dic: typeof b.dic === "string" && b.dic.trim() ? b.dic.trim() : null,
      };
    }
    return {
      ico: typeof p.ico === "string" && p.ico.trim() ? p.ico.trim() : null,
      dic: typeof p.dic === "string" && p.dic.trim() ? p.dic.trim() : null,
      terms_version: typeof p.terms_version === "string" ? p.terms_version : null,
      terms_effective_at: typeof p.terms_effective_at === "string" ? p.terms_effective_at : null,
      ordering_person_name:
        typeof p.ordering_person_name === "string" && p.ordering_person_name.trim()
          ? p.ordering_person_name.trim()
          : null,
      authorization_confirmed: p.authorization_confirmed === true,
      agreed_price_cents:
        typeof p.agreed_price_cents === "number" && Number.isFinite(p.agreed_price_cents)
          ? Math.round(p.agreed_price_cents)
          : null,
      creative_mode: typeof p.creative_mode === "string" ? p.creative_mode : null,
      billing,
      note: typeof p.note === "string" && p.note.trim() ? p.note.trim() : null,
    };
  } catch {
    return empty;
  }
}

export function premiumOrderListPriceLabelCents(input: {
  agreedFromPayload: number | null;
  snapAgreed: number | null;
  snapCatalog: number | null;
}): string | null {
  const cents = input.snapAgreed ?? input.snapCatalog ?? input.agreedFromPayload;
  if (cents == null || !Number.isFinite(cents)) return null;
  return formatPremiumTotalPriceLabelCs(cents).replace(/^Celková cena za 6 měsíců:\s*/, "");
}

export function serializePremiumOrderAdminListRow(row: Record<string, unknown>) {
  const position = Number(row.position) || 0;
  const payload = parsePremiumOrderPayload(
    typeof row.payload_json === "string" ? row.payload_json : null
  );
  const priceLabel = premiumOrderListPriceLabelCents({
    agreedFromPayload: payload.agreed_price_cents,
    snapAgreed: row.snap_agreed != null ? Number(row.snap_agreed) : null,
    snapCatalog: row.snap_catalog != null ? Number(row.snap_catalog) : null,
  });
  const categorySlug = String(row.category_slug || "");
  const workflowStatus = String(row.workflow_status || "");
  const creativeId = row.creative_id != null ? String(row.creative_id) : null;
  const targetUrl = row.target_url != null ? String(row.target_url) : null;
  const missingPublishFields = premiumOrderMissingPublishFields({
    creative_id: creativeId,
    target_url: targetUrl,
  });
  const publishable = isPremiumOrderPublishable({
    workflow_status: workflowStatus,
    creative_id: creativeId,
    target_url: targetUrl,
  });
  return {
    order_id: row.order_id,
    client_id: row.client_id,
    order_number: row.order_number,
    company_name: row.company_name,
    ico: row.ico ?? payload.ico,
    category_slug: categorySlug,
    category_title_cs: premiumCategoryTitleCs(categorySlug),
    position,
    position_label: position ? "P" + String(position) : "—",
    duration_months: PREMIUM_DURATION_MONTHS,
    duration_label_cs: PREMIUM_DURATION_MONTHS + " měsíců",
    price_label_cs: priceLabel,
    workflow_status: workflowStatus,
    workflow_status_label_cs: premiumWorkflowStatusLabelCs(workflowStatus, {
      creative_id: creativeId,
      target_url: targetUrl,
    }),
    creative_id: creativeId,
    target_url: row.target_url,
    creative_mode: row.creative_mode ?? payload.creative_mode,
    publishable,
    missing_publish_fields: missingPublishFields,
    submitted_at: row.created_at,
    submitted_at_label_cs: formatAdminPragueDateTime(String(row.created_at || "")),
    published_at: row.published_at ?? null,
    published_at_label_cs: formatAdminPragueDateTime(
      row.published_at != null ? String(row.published_at) : null
    ),
    pending_review: isPremiumOrderPendingStatus(workflowStatus),
  };
}

export async function countPendingPremiumOrders(db: D1Database): Promise<number> {
  const placeholders = PREMIUM_ORDER_PENDING_STATUSES.map(() => "?").join(", ");
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM premium_selected_orders WHERE workflow_status IN (${placeholders})`
    )
    .bind(...PREMIUM_ORDER_PENDING_STATUSES)
    .first<{ cnt: number }>();
  return Number(row?.cnt) || 0;
}

export async function countPublishablePremiumOrders(db: D1Database): Promise<number> {
  const placeholders = PREMIUM_ORDER_PENDING_STATUSES.map(() => "?").join(", ");
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM premium_selected_orders
       WHERE workflow_status IN (${placeholders})
         AND creative_id IS NOT NULL AND TRIM(creative_id) != ''
         AND target_url IS NOT NULL AND TRIM(target_url) != ''`
    )
    .bind(...PREMIUM_ORDER_PENDING_STATUSES)
    .first<{ cnt: number }>();
  return Number(row?.cnt) || 0;
}

export function premiumPositionLabel(position: PremiumPosition | number): string {
  return "P" + String(position);
}
