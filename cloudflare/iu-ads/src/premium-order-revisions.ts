/**
 * Premium public creative/URL revisions after publication (immutable approved history).
 */
import { json, newId, requireAdminPermission } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
import { validateTargetUrl } from "./url-safety";
import type { Env } from "./types";

export async function handleAdminPremiumRequestRevision(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: { target_url?: unknown; creative_id?: unknown; creative_mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const po = await env.DB.prepare(
    "SELECT workflow_status, published_campaign_id, creative_id, target_url, creative_mode FROM premium_selected_orders WHERE order_id = ?"
  )
    .bind(orderId)
    .first<{
      workflow_status: string;
      published_campaign_id: string | null;
      creative_id: string | null;
      target_url: string | null;
      creative_mode: string | null;
    }>();
  if (!po || po.workflow_status !== "published") return json({ error: "not_published" }, 400);

  let normalizedUrl: string | null = null;
  if (typeof body.target_url === "string" && body.target_url.trim()) {
    const urlCheck = validateTargetUrl(body.target_url.trim());
    if (!urlCheck.ok) return json({ error: "invalid_target_url" }, 400);
    normalizedUrl = urlCheck.normalized;
  }

  const nextCreativeId = typeof body.creative_id === "string" && body.creative_id.trim() ? body.creative_id.trim() : null;
  const nextMode = typeof body.creative_mode === "string" && body.creative_mode.trim() ? body.creative_mode.trim() : null;

  if (!normalizedUrl && !nextCreativeId && !nextMode) return json({ error: "no_changes" }, 400);

  const maxVer = await env.DB.prepare("SELECT MAX(version) AS v FROM premium_order_public_revisions WHERE order_id = ?")
    .bind(orderId)
    .first<{ v: number | null }>();
  const version = (Number(maxVer?.v) || 0) + 1;
  const revisionId = newId("rev");
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO premium_order_public_revisions (
      revision_id, order_id, version, creative_id, creative_mode, target_url, status, created_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      revisionId,
      orderId,
      version,
      nextCreativeId ?? po.creative_id,
      nextMode ?? po.creative_mode,
      normalizedUrl ?? po.target_url,
      "pending",
      nowIso,
      guard.userId
    )
    .run();

  await appendPremiumOrderEvent(env.DB, {
    orderId,
    eventType: "creative_change_requested",
    actorUserId: guard.userId,
    payload: { revision_id: revisionId, version, actor_label: guard.userId },
  }).catch(() => {});

  return json({ ok: true, revision_id: revisionId, version, status: "pending" });
}

export async function handleAdminPremiumApproveRevision(request: Request, env: Env, orderId: string, revisionId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "campaigns.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const rev = await env.DB.prepare(
    "SELECT * FROM premium_order_public_revisions WHERE revision_id = ? AND order_id = ?"
  )
    .bind(revisionId, orderId)
    .first<Record<string, unknown>>();
  if (!rev || rev.status !== "pending") return json({ error: "revision_not_pending" }, 404);

  const po = await env.DB.prepare("SELECT published_campaign_id, creative_id FROM premium_selected_orders WHERE order_id = ?")
    .bind(orderId)
    .first<{ published_campaign_id: string | null; creative_id: string | null }>();
  if (!po?.published_campaign_id) return json({ error: "not_published" }, 400);

  const nowIso = new Date().toISOString();
  const newCreativeId = typeof rev.creative_id === "string" ? rev.creative_id : po.creative_id;
  const newUrl = typeof rev.target_url === "string" ? rev.target_url : null;
  const newMode = typeof rev.creative_mode === "string" ? rev.creative_mode : null;

  if (newCreativeId && newCreativeId !== po.creative_id) {
    await env.DB.prepare(
      "UPDATE creatives SET review_status = 'approved', approved_at = ?, approved_by = ?, campaign_id = ?, updated_at = ? WHERE creative_id = ?"
    )
      .bind(nowIso, guard.userId, po.published_campaign_id, nowIso, newCreativeId)
      .run();
  }

  await env.DB.prepare(
    "UPDATE premium_selected_orders SET creative_id = ?, target_url = COALESCE(?, target_url), creative_mode = COALESCE(?, creative_mode), updated_at = ? WHERE order_id = ?"
  )
    .bind(newCreativeId, newUrl, newMode, nowIso, orderId)
    .run();

  if (newUrl) {
    await env.DB.prepare("UPDATE campaigns SET target_url = ?, updated_at = ? WHERE campaign_id = ?")
      .bind(newUrl, nowIso, po.published_campaign_id)
      .run();
  }

  await env.DB.prepare(
    "UPDATE premium_order_public_revisions SET status = 'superseded', approved_at = ?, approved_by = ? WHERE order_id = ? AND status = 'approved'"
  )
    .bind(nowIso, guard.userId, orderId)
    .run();

  await env.DB.prepare(
    "UPDATE premium_order_public_revisions SET status = 'approved', approved_at = ?, approved_by = ? WHERE revision_id = ?"
  )
    .bind(nowIso, guard.userId, revisionId)
    .run();

  await appendPremiumOrderEvent(env.DB, {
    orderId,
    eventType: "admin_edit",
    actorUserId: guard.userId,
    payload: {
      field: "public_revision",
      revision_id: revisionId,
      version: rev.version,
      actor_label: guard.userId,
    },
  }).catch(() => {});

  return json({ ok: true, revision_id: revisionId, status: "approved" });
}
