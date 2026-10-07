/**
 * Premium order customer portal code (client_access_codes + premium_order_portal_codes linkage).
 */
import { hashClientAccessCode } from "./admin-codes";
import { newId } from "./admin-auth";
import { generateCustomerOrderCode, hashOrderPortalCode, normalizeCustomerOrderCode } from "./premium-order-access-code";

export type PremiumPortalScope = {
  product: "premium_selected";
  premium_order_id: string;
};

export function premiumPortalScopeJson(orderId: string): string {
  const scope: PremiumPortalScope = { product: "premium_selected", premium_order_id: orderId };
  return JSON.stringify(scope);
}

export function parsePremiumPortalScope(raw: string | null | undefined): PremiumPortalScope | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as PremiumPortalScope;
    if (o && o.product === "premium_selected" && typeof o.premium_order_id === "string" && o.premium_order_id) {
      return o;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Idempotent: ensure orders.customer_order_code + portal rows + client_access_codes for login. */
export async function ensurePremiumOrderPortalAccess(
  db: D1Database,
  pepper: string,
  input: {
    orderId: string;
    clientId: string;
    customerOrderCode: string;
    createdBy?: string | null;
  }
): Promise<{ codeId: string; customerOrderCode: string }> {
  const normalizedCode = normalizeCustomerOrderCode(input.customerOrderCode);
  if (!normalizedCode) throw new Error("invalid_customer_order_code");

  const codeHash = await hashOrderPortalCode(normalizedCode, pepper);
  const prefixMatch = normalizedCode.match(/^(IU-\d{2})/);
  const codePrefix = prefixMatch ? prefixMatch[1] : normalizedCode.slice(0, 8);
  const nowIso = new Date().toISOString();
  const scopeJson = premiumPortalScopeJson(input.orderId);

  const portalRow = await db
    .prepare("SELECT code_id FROM premium_order_portal_codes WHERE order_id = ?")
    .bind(input.orderId)
    .first<{ code_id: string | null }>();

  let codeId = portalRow?.code_id || null;
  if (codeId) {
    const existing = await db
      .prepare("SELECT code_id FROM client_access_codes WHERE code_id = ? AND client_id = ?")
      .bind(codeId, input.clientId)
      .first();
    if (!existing) codeId = null;
  }

  if (!codeId) {
    const byHash = await db
      .prepare("SELECT code_id, client_id FROM client_access_codes WHERE code_hash = ?")
      .bind(codeHash)
      .first<{ code_id: string; client_id: string }>();
    if (byHash) {
      codeId = byHash.code_id;
      if (byHash.client_id !== input.clientId) {
        throw new Error("portal_code_client_mismatch");
      }
    }
  }

  if (!codeId) {
    codeId = newId("cod");
    await db
      .prepare(
        `INSERT INTO client_access_codes (
          code_id, client_id, code_hash, code_prefix, status, created_at, expires_at,
          deactivated_at, last_used_at, created_by, replaced_by_code_id, data_scope_json
        ) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,NULL,?)`
      )
      .bind(codeId, input.clientId, codeHash, codePrefix, "active", nowIso, null, input.createdBy || null, scopeJson)
      .run();
  } else {
    await db
      .prepare("UPDATE client_access_codes SET data_scope_json = ?, status = 'active' WHERE code_id = ?")
      .bind(scopeJson, codeId)
      .run();
  }

  try {
    if (portalRow) {
      await db
        .prepare("UPDATE premium_order_portal_codes SET code_hash = ?, code_prefix = ?, code_id = ? WHERE order_id = ?")
        .bind(codeHash, codePrefix, codeId, input.orderId)
        .run();
    } else {
      await db
        .prepare(
          "INSERT INTO premium_order_portal_codes (order_id, code_hash, code_prefix, code_id, created_at) VALUES (?,?,?,?,?)"
        )
        .bind(input.orderId, codeHash, codePrefix, codeId, nowIso)
        .run();
    }
  } catch {
    await db
      .prepare(
        "INSERT OR REPLACE INTO premium_order_portal_codes (order_id, code_hash, code_prefix, created_at) VALUES (?,?,?,?)"
      )
      .bind(input.orderId, codeHash, codePrefix, nowIso)
      .run();
  }

  await db
    .prepare("UPDATE orders SET customer_order_code = ?, updated_at = ? WHERE order_id = ? AND (customer_order_code IS NULL OR customer_order_code = '' OR customer_order_code = order_number)")
    .bind(normalizedCode, nowIso, input.orderId)
    .run();

  return { codeId, customerOrderCode: normalizedCode };
}

/** Backfill one order; never replaces existing distinct customer_order_code. */
export async function backfillPremiumOrderPortalCode(
  db: D1Database,
  pepper: string,
  orderId: string,
  actorUserId: string | null
): Promise<{ ok: true; created: boolean; customer_order_code: string } | { ok: false; reason: string }> {
  const row = await db
    .prepare(
      `SELECT o.order_id, o.client_id, o.customer_order_code, o.order_number
       FROM orders o
       JOIN premium_selected_orders po ON po.order_id = o.order_id
       WHERE o.order_id = ?`
    )
    .bind(orderId)
    .first<{ order_id: string; client_id: string; customer_order_code: string | null; order_number: string }>();
  if (!row) return { ok: false, reason: "not_found" };

  let code =
    typeof row.customer_order_code === "string" && row.customer_order_code.trim()
      ? normalizeCustomerOrderCode(row.customer_order_code)
      : "";
  let created = false;
  if (!code) {
    const gen = generateCustomerOrderCode();
    code = gen.plaintext;
    created = true;
  }

  await ensurePremiumOrderPortalAccess(db, pepper, {
    orderId: row.order_id,
    clientId: row.client_id,
    customerOrderCode: code,
    createdBy: actorUserId,
  });

  return { ok: true, created, customer_order_code: code };
}

export async function linkCampaignToPremiumPortalCode(
  db: D1Database,
  orderId: string,
  campaignId: string
): Promise<void> {
  const portal = await db
    .prepare("SELECT code_id FROM premium_order_portal_codes WHERE order_id = ?")
    .bind(orderId)
    .first<{ code_id: string | null }>();
  const codeId = portal?.code_id;
  if (!codeId) return;
  await db.prepare("INSERT OR IGNORE INTO client_code_campaigns (code_id, campaign_id) VALUES (?,?)").bind(codeId, campaignId).run();
}
