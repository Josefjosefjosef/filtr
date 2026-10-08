/**
 * Public premium order submit + creative upload (token-authenticated).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId } from "./admin-auth";
import { hashClientAccessCode } from "./admin-codes";
import { generateCustomerOrderCode } from "./premium-order-access-code";
import { ensurePremiumOrderPortalAccess } from "./premium-order-portal";
import { appendPremiumOrderEvent } from "./premium-order-history";
import { buildObjectKey, contentHashHex, extForMime, validateUploadObject } from "./r2-security";
import { fetchAresByIco } from "./ares-lookup";
import { validateCzechIco } from "./czech-ico";
import { validatePremiumPhone } from "./czech-phone";
import { isPremiumCampaignLiveNow } from "./premium-display";
import { PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_VERSION } from "./premium-terms";
import {
  buildPriceSnapshot,
  formatPremiumTotalPriceLabelCs,
  isKnownAffiliateCategorySlug,
  isPremiumPosition,
  parsePremiumPlacementId,
  PREMIUM_DURATION_MONTHS,
  PREMIUM_PRODUCT_TYPE,
  resolveAuthoritativePriceCents,
  type PremiumPosition,
} from "./premium-selected-services";
import { PREMIUM_CREATIVE_MODE_SET, premiumCreativeModeToCreativeFormat } from "./premium-creative-mode";
import { validateTargetUrl } from "./url-safety";
import type { Env } from "./types";

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hashOrderToken(token: string, pepper: string): Promise<string> {
  return hashClientAccessCode(token.trim().toUpperCase(), pepper);
}

function readOrderToken(request: Request): string | null {
  const h = request.headers.get("X-IU-Premium-Order-Token");
  return h && h.trim() ? h.trim() : null;
}

function composeBillingInfo(input: {
  street: string;
  city: string;
  zip: string;
  country: string;
  dic: string | null;
}): string {
  const lines = [input.street, input.zip + " " + input.city, input.country];
  if (input.dic) lines.push("DIČ: " + input.dic);
  return lines.join("\n");
}

async function findOrCreateClient(
  db: D1Database,
  input: {
    companyName: string;
    ico: string;
    dic: string | null;
    address: string;
    billingInfo: string;
    contactName: string;
    email: string;
    phone: string | null;
  }
): Promise<string> {
  if (input.ico) {
    const byIco = await db.prepare("SELECT client_id FROM clients WHERE ico = ?").bind(input.ico).first<{ client_id: string }>();
    if (byIco) {
      await db
        .prepare("UPDATE clients SET company_name = ?, dic = ?, address = ?, billing_info = ?, updated_at = ? WHERE client_id = ?")
        .bind(input.companyName, input.dic, input.address, input.billingInfo, new Date().toISOString(), byIco.client_id)
        .run();
      return byIco.client_id;
    }
  }
  const clientId = newId("cli");
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO clients (client_id, company_name, ico, dic, address, billing_info, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .bind(clientId, input.companyName, input.ico, input.dic, input.address, input.billingInfo, nowIso, nowIso)
    .run();
  const contactId = newId("ctc");
  await db
    .prepare(
      "INSERT INTO client_contacts (contact_id, client_id, full_name, email, phone, is_primary, created_at) VALUES (?,?,?,?,?,1,?)"
    )
    .bind(contactId, clientId, input.contactName, input.email, input.phone, nowIso)
    .run();
  return clientId;
}

export async function handlePublicPremiumOrderSubmit(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB || !env.ADS_CODE_PEPPER) return json({ error: "not_configured" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const placementId = typeof body.placement_id === "string" ? body.placement_id.trim() : "";
  const parsed = parsePremiumPlacementId(placementId);
  if (!parsed || !isKnownAffiliateCategorySlug(parsed.categorySlug)) {
    return json({ error: "invalid_placement" }, 400);
  }

  const placement = await env.DB.prepare(
    `SELECT p.placement_id, p.category_slug, p.position, p.current_price_cents, p.currency, p.active_campaign_id,
            c.status AS campaign_status, c.target_url, c.start_at, c.end_at
     FROM premium_selected_placements p
     LEFT JOIN campaigns c ON c.campaign_id = p.active_campaign_id
     WHERE p.placement_id = ?`
  )
    .bind(placementId)
    .first<{
      placement_id: string;
      category_slug: string;
      position: number;
      current_price_cents: number;
      currency: string;
      active_campaign_id: string | null;
      campaign_status: string | null;
      target_url: string | null;
      start_at: string | null;
      end_at: string | null;
    }>();
  if (!placement || placement.category_slug !== parsed.categorySlug) {
    return json({ error: "placement_mismatch" }, 400);
  }

  const nowIso = new Date().toISOString();
  const live = isPremiumCampaignLiveNow({
    campaign_status: placement.campaign_status,
    target_url: placement.target_url,
    start_at: placement.start_at,
    end_at: placement.end_at,
    nowIso,
  });
  if (live) return json({ error: "placement_occupied" }, 409);
  if (placement.active_campaign_id) return json({ error: "placement_unavailable" }, 409);
  const pending = await env.DB.prepare(
    "SELECT 1 AS ok FROM premium_selected_orders WHERE placement_id = ? AND workflow_status IN ('submitted', 'under_review') LIMIT 1"
  )
    .bind(placementId)
    .first<{ ok: number }>();
  if (pending) return json({ error: "placement_reserved" }, 409);

  const companyName = typeof body.company_name === "string" ? body.company_name.trim() : "";
  const contactName = typeof body.contact_name === "string" ? body.contact_name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!companyName || !contactName || !email) return json({ error: "missing_contact" }, 400);

  const urlRaw = typeof body.target_url === "string" ? body.target_url : "";
  const urlCheck = validateTargetUrl(urlRaw);
  if (!urlCheck.ok) return json({ error: urlCheck.reason }, 400);

  const creativeMode = typeof body.creative_mode === "string" ? body.creative_mode.trim().toLowerCase() : "";
  if (!PREMIUM_CREATIVE_MODE_SET.has(creativeMode)) return json({ error: "invalid_creative_mode" }, 400);

  const icoRaw = typeof body.ico === "string" ? body.ico.trim() : "";
  if (!icoRaw) return json({ error: "ico_required" }, 400);
  const icoCheck = validateCzechIco(icoRaw);
  if (!icoCheck.ok) return json({ error: icoCheck.reason }, 400);

  const street = typeof body.billing_street === "string" ? body.billing_street.trim() : "";
  const city = typeof body.billing_city === "string" ? body.billing_city.trim() : "";
  const zip = typeof body.billing_zip === "string" ? body.billing_zip.trim() : "";
  const country = typeof body.billing_country === "string" ? body.billing_country.trim() : "";
  if (!street || !city || !zip || !country) return json({ error: "missing_billing_address" }, 400);

  const dic = typeof body.dic === "string" && body.dic.trim() ? body.dic.trim() : null;
  const phoneRaw = typeof body.phone === "string" ? body.phone : "";
  const phoneCheck = validatePremiumPhone(phoneRaw);
  if (!phoneCheck.ok) return json({ error: phoneCheck.reason }, 400);
  const phone = phoneCheck.phone;
  const billingInfo = composeBillingInfo({ street, city, zip, country, dic });
  const address = street + ", " + zip + " " + city + ", " + country;
  const note = typeof body.note === "string" ? body.note.trim() : null;

  const termsVersion =
    typeof body.terms_version === "string" && body.terms_version.trim() ? body.terms_version.trim() : PREMIUM_TERMS_VERSION;
  if (termsVersion !== PREMIUM_TERMS_VERSION) return json({ error: "invalid_terms_version" }, 400);
  const termsEffective =
    typeof body.terms_effective_at === "string" && body.terms_effective_at.trim()
      ? body.terms_effective_at.trim()
      : PREMIUM_TERMS_EFFECTIVE_AT;
  if (termsEffective !== PREMIUM_TERMS_EFFECTIVE_AT) return json({ error: "invalid_terms_effective_at" }, 400);
  if (body.b2b_only !== true) return json({ error: "b2b_required" }, 400);
  if (body.authorization_confirmed !== true) return json({ error: "authorization_required" }, 400);
  const orderingPersonRaw = body.ordering_person_name;
  const orderingPersonName =
    typeof orderingPersonRaw === "string" ? orderingPersonRaw.trim().replace(/\s+/g, " ") : "";
  if (!orderingPersonName || orderingPersonName.length < 2 || orderingPersonName.length > 200) {
    return json({ error: "ordering_person_required" }, 400);
  }
  if (/[<>]/.test(orderingPersonName)) return json({ error: "ordering_person_invalid" }, 400);

  if (!isPremiumPosition(placement.position)) return json({ error: "invalid_placement" }, 400);
  const position = placement.position as PremiumPosition;
  const priceCents = resolveAuthoritativePriceCents(
    placementId,
    position,
    placement.current_price_cents,
    body.price_cents
  );

  const clientId = await findOrCreateClient(env.DB, {
    companyName,
    ico: icoCheck.ico,
    dic,
    address,
    billingInfo,
    contactName,
    email,
    phone,
  });

  const orderId = newId("ord");
  const customerCode = generateCustomerOrderCode();
  const orderNumber = customerCode.plaintext;
  const priceSnapshot = buildPriceSnapshot({
    placementId,
    catalogPriceCents: placement.current_price_cents,
    agreedPriceCents: priceCents,
    currency: placement.currency || "CZK",
    orderedAt: nowIso,
  });
  let customer_registry: Record<string, unknown> | null = null;
  try {
    const ares = await fetchAresByIco(icoCheck.ico);
    if (ares.ok && ares.data.customer_registry?.display_line_cs) {
      customer_registry = ares.data.customer_registry as unknown as Record<string, unknown>;
    }
  } catch {
    /* registry optional — order proceeds without OR line */
  }

  const payload = {
    product: PREMIUM_PRODUCT_TYPE,
    placement_id: placementId,
    category_slug: parsed.categorySlug,
    position,
    creative_mode: creativeMode,
    target_url: urlCheck.normalized,
    agreed_price_cents: priceCents,
    currency: placement.currency || "CZK",
    duration_months: PREMIUM_DURATION_MONTHS,
    b2b_only: true,
    ico: icoCheck.ico,
    terms_version: termsVersion,
    terms_effective_at: termsEffective,
    price_snapshot: priceSnapshot,
    billing: { street, city, zip, country, dic },
    ...(customer_registry ? { customer_registry } : {}),
    ordering_person_name: orderingPersonName,
    authorization_confirmed: true,
    contact_phone: phone,
  };

  await env.DB.prepare(
    "INSERT INTO orders (order_id, client_id, order_number, status, contact_person, customer_order_code, payload_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      orderId,
      clientId,
      orderNumber,
      "confirmed",
      contactName,
      orderNumber,
      JSON.stringify(payload),
      nowIso,
      nowIso
    )
    .run();

  if (env.ADS_CODE_PEPPER) {
    try {
      await ensurePremiumOrderPortalAccess(env.DB, env.ADS_CODE_PEPPER, {
        orderId,
        clientId,
        customerOrderCode: orderNumber,
        createdBy: null,
      });
    } catch {
      /* migration pending */
    }
  }

  const inquiryId = newId("inq");
  await env.DB.prepare(
    "INSERT INTO inquiries (inquiry_id, client_id, status, title, payload_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(
      inquiryId,
      clientId,
      "open",
      "Premium " + parsed.categorySlug + " " + placementId,
      JSON.stringify({ order_id: orderId, ...payload }),
      nowIso,
      nowIso
    )
    .run();

  const orderToken = "PO-" + crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const tokenHash = await hashOrderToken(orderToken, env.ADS_CODE_PEPPER);

  await env.DB.prepare(
    `INSERT INTO premium_selected_orders (
      order_id, placement_id, category_slug, position, workflow_status, target_url, creative_mode,
      order_token_hash, client_contact_email, note_client, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      orderId,
      placementId,
      parsed.categorySlug,
      position,
      "submitted",
      urlCheck.normalized,
      creativeMode,
      tokenHash,
      email,
      note,
      nowIso,
      nowIso
    )
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: null,
      operation: "premium_order_submitted",
      objectType: "order",
      objectId: orderId,
      before: null,
      after: { placement_id: placementId, price_cents: priceCents },
      result: "success",
    })
  );

  try {
    await appendPremiumOrderEvent(env.DB, {
      orderId,
      eventType: "order_submitted",
      actorUserId: null,
      payload: { actor_label: "Objednatel" },
      createdAt: nowIso,
    });
  } catch {
    /* schema not migrated yet in local stub */
  }

  return json(
    {
      order_id: orderId,
      order_number: orderNumber,
      customer_order_code: orderNumber,
      order_access_token: orderToken,
      placement_id: placementId,
      price_cents: priceCents,
      price_label_cs: formatPremiumTotalPriceLabelCs(priceCents),
      creative_mode: creativeMode,
      measurement: { impressions: false, clicks: false },
    },
    201
  );
}

async function authorizeOrder(env: Env, orderId: string, token: string): Promise<boolean> {
  if (!env.DB || !env.ADS_CODE_PEPPER) return false;
  const hash = await hashOrderToken(token, env.ADS_CODE_PEPPER);
  const row = await env.DB.prepare("SELECT order_id FROM premium_selected_orders WHERE order_id = ? AND order_token_hash = ?")
    .bind(orderId, hash)
    .first();
  return !!row;
}

export async function handlePublicPremiumOrderUpload(request: Request, env: Env, orderId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB || !env.CREATIVES || !env.ADS_CODE_PEPPER) return json({ error: "not_configured" }, 503);

  const token = readOrderToken(request);
  if (!token || !(await authorizeOrder(env, orderId, token))) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const po = await env.DB.prepare(
    "SELECT order_id, workflow_status, creative_mode, placement_id FROM premium_selected_orders WHERE order_id = ?"
  )
    .bind(orderId)
    .first<{ order_id: string; workflow_status: string; creative_mode: string; placement_id: string }>();
  if (!po) return json({ error: "not_found" }, 404);
  if (po.workflow_status === "published") return json({ error: "order_closed" }, 409);

  const order = await env.DB.prepare("SELECT client_id FROM orders WHERE order_id = ?").bind(orderId).first<{ client_id: string }>();
  if (!order) return json({ error: "order_not_found" }, 404);

  const format = premiumCreativeModeToCreativeFormat(po.creative_mode);
  const contentBase64 = typeof body.content_base64 === "string" ? body.content_base64 : "";
  const declaredMime = typeof body.declared_mime === "string" ? body.declared_mime : "";
  const filename = typeof body.filename === "string" ? body.filename : "upload.bin";
  const bytes = base64ToBytes(contentBase64);
  if (!bytes) return json({ error: "invalid_content" }, 400);

  const validation = validateUploadObject({
    purpose: "creative",
    declaredMime,
    filename,
    byteLength: bytes.length,
    content: bytes,
  });
  if (!validation.ok) return json({ error: validation.reason }, 400);

  const creativeId = newId("crv");
  const contentHash = await contentHashHex(bytes);
  const ext = extForMime(validation.mime, filename);
  const r2Key = buildObjectKey({ kind: "creative", id: creativeId, version: 1, ext });
  await env.CREATIVES.put(r2Key, bytes, { httpMetadata: { contentType: validation.mime } });

  const nowIso = new Date().toISOString();
  const width = typeof body.width === "number" ? body.width : null;
  const height = typeof body.height === "number" ? body.height : null;

  await env.DB.prepare(
    "INSERT INTO creatives (creative_id, client_id, campaign_id, version, device_category, format, mime_type, width, height, byte_size, content_hash, r2_key, review_status, uploaded_by, created_at, updated_at) VALUES (?,?,?,1,'universal',?,?,?,?,?,?,?,'pending',NULL,?,?)"
  )
    .bind(creativeId, order.client_id, null, format, validation.mime, width, height, bytes.length, contentHash, r2Key, nowIso, nowIso)
    .run();

  await env.DB.prepare("UPDATE premium_selected_orders SET creative_id = ?, workflow_status = 'under_review', updated_at = ? WHERE order_id = ?")
    .bind(creativeId, nowIso, orderId)
    .run();

  return json({ creative_id: creativeId, format, review_status: "pending" });
}

export async function handlePublicPremiumOrderGet(request: Request, env: Env, orderId: string): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!env.DB || !env.ADS_CODE_PEPPER) return json({ error: "not_configured" }, 503);
  const token = readOrderToken(request);
  if (!token || !(await authorizeOrder(env, orderId, token))) return json({ error: "forbidden" }, 403);

  const po = await env.DB.prepare(
    "SELECT order_id, placement_id, category_slug, position, workflow_status, target_url, creative_mode, creative_id, published_campaign_id FROM premium_selected_orders WHERE order_id = ?"
  )
    .bind(orderId)
    .first();
  if (!po) return json({ error: "not_found" }, 404);
  return json({ order: po, measurement: { impressions: false, clicks: false } });
}
