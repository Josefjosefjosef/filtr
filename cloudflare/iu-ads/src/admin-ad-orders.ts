/**
 * Společný přehled reklamních objednávek napříč produkty.
 */
import { json, requireAdminPermission } from "./admin-auth";
import { handleAdminPremiumListOrders } from "./admin-premium-selected";
import { serializePremiumOrderAdminListRow } from "./premium-order-workflow";
import {
  AD_PRODUCT_BANNER_PC_RIGHT,
  AD_PRODUCT_LABEL_CS,
  AD_PRODUCT_PREMIUM_BUTTONS,
  parseAdProductFilter,
} from "./admin-ad-products";
import type { Env } from "./types";

export function serializeAdOrderAdminRow(row: Record<string, unknown>) {
  const base = serializePremiumOrderAdminListRow(row);
  const ref =
    (typeof base.customer_order_code === "string" && base.customer_order_code.trim()) ||
    (typeof base.order_number === "string" && base.order_number.trim()) ||
    String(base.order_id || "");
  return {
    ...base,
    order_reference: ref,
    ad_product_id: AD_PRODUCT_PREMIUM_BUTTONS,
    ad_product_label_cs: AD_PRODUCT_LABEL_CS[AD_PRODUCT_PREMIUM_BUTTONS],
  };
}

export async function handleAdminAdOrdersList(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.read");
  if (!guard.ok) return guard.response;

  const product = parseAdProductFilter(url.searchParams.get("ad_product"));
  if (product === AD_PRODUCT_BANNER_PC_RIGHT) {
    return json({
      orders: [],
      pending_count: 0,
      banner_product_status_cs: "Připravuje se — prodejní model a veřejné plochy zatím nejsou aktivní.",
    });
  }

  const premiumRes = await handleAdminPremiumListOrders(request, env, url);
  if (!premiumRes.ok) return premiumRes;
  const body = (await premiumRes.json()) as {
    premium_orders?: Record<string, unknown>[];
    pending_count?: number;
  };
  const orders = (body.premium_orders || []).map((row) => serializeAdOrderAdminRow(row));
  if (product === AD_PRODUCT_PREMIUM_BUTTONS) {
    return json({ orders, pending_count: body.pending_count ?? 0 });
  }
  return json({ orders, pending_count: body.pending_count ?? 0 });
}
