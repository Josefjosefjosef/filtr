/**
 * Premium order delete / archive (accounting-safe).
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { appendPremiumOrderEvent } from "./premium-order-history";
import { adminRolesIncludeMainAdmin } from "./premium-admin-main-guard";
import {
  deleteExclusiveCampaignForPurge,
  premiumOrderEligibleForSystemPurge,
  purgePremiumOrderPhysically,
} from "./premium-order-purge";
import type { Env } from "./types";

async function orderHasProtectedAccounting(db: D1Database, orderId: string): Promise<boolean> {
  const inv = await db
    .prepare("SELECT invoice_id FROM invoices WHERE order_id = ? LIMIT 1")
    .bind(orderId)
    .first();
  return !!inv;
}

async function countClientOrders(db: D1Database, clientId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM orders WHERE client_id = ?").bind(clientId).first<{ c: number }>();
  return Number(row?.c) || 0;
}

function purgeFailureMessage(errorCode: string): string {
  const map: Record<string, string> = {
    purge_paid_accounting:
      "Objednávku nelze odstranit, protože je evidována úhrada. Použijte archivaci a zachovejte účetní doklady.",
    purge_not_eligible:
      "Objednávku nelze odstranit — chybí potvrzení testovacího záznamu nebo jde o provozní případ mimo povolený rozsah.",
    main_admin_required: "Nemáte oprávnění k úplnému odstranění (vyžadován hlavní administrátor).",
    has_child_orders: "Objednávka má navazující prodloužení — nejdříve odstraňte podřízené záznamy.",
    purge_db_failed: "Odstranění nebylo dokončeno kvůli chybě databáze — objednávka mohla zůstat v systému. Obnovte detail a zkuste znovu.",
    purge_failed: "Nepodařilo se odstranit související provozní záznamy (kampaň, kreativa nebo dokumenty).",
  };
  return map[errorCode] || "Odstranění nebylo dokončeno kvůli chybě databáze nebo souvisejících záznamů.";
}

export async function handleAdminPremiumDeleteOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "orders.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured", message_cs: "Databáze není dostupná." }, 503);

  let body: {
    confirm?: unknown;
    reason?: unknown;
    purge_system_record?: unknown;
    explicit_test_purge_confirmed?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body", message_cs: "Neplatné tělo požadavku." }, 400);
  }
  if (body.confirm !== true) {
    return json({ error: "confirmation_required", message_cs: "Potvrzení odstranění je povinné." }, 400);
  }
  const purgeSystem = body.purge_system_record === true;
  if (purgeSystem && !adminRolesIncludeMainAdmin(guard.roles)) {
    return json({ error: "main_admin_required", message_cs: "Úplné odstranění smí provést pouze hlavní administrátor." }, 403);
  }

  try {
  const po = await env.DB.prepare(
    `SELECT po.*, o.client_id, o.customer_order_code, o.order_number
     FROM premium_selected_orders po JOIN orders o ON o.order_id = po.order_id WHERE po.order_id = ?`
  )
    .bind(orderId)
    .first<Record<string, unknown>>();
  if (!po) return json({ error: "not_found", message_cs: "Objednávka nenalezena." }, 404);

  const protectedAccounting = await orderHasProtectedAccounting(env.DB, orderId);
  const nowIso = new Date().toISOString();
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 2000) : null;

  if (purgeSystem) {
    const child = await env.DB.prepare("SELECT order_id FROM premium_selected_orders WHERE parent_order_id = ? LIMIT 1")
      .bind(orderId)
      .first();
    if (child) {
      return json(
        {
          error: "has_child_orders",
          message_cs: "Objednávka má navazující prodloužení — nejdříve odstraňte podřízené záznamy.",
        },
        409
      );
    }
    const purgeEligible = await premiumOrderEligibleForSystemPurge(env.DB, orderId, {
      explicitTestPurgeConfirmed: body.explicit_test_purge_confirmed === true,
    });
    if (!purgeEligible.ok) {
      return json({ error: purgeEligible.error, message_cs: purgeEligible.message_cs }, 403);
    }
  }

  if (protectedAccounting && !purgeSystem) {
    await env.DB.prepare(
      "UPDATE orders SET status = 'cancelled', archived_at = ?, archive_reason = ?, updated_at = ? WHERE order_id = ?"
    )
      .bind(nowIso, reason || "admin_archive_accounting", nowIso, orderId)
      .run();
    await env.DB.prepare("UPDATE premium_selected_orders SET workflow_status = 'rejected', updated_at = ? WHERE order_id = ?")
      .bind(nowIso, orderId)
      .run();
    const campId = po.published_campaign_id;
    if (typeof campId === "string" && campId) {
      await env.DB.prepare("UPDATE campaigns SET status = 'cancelled', updated_at = ? WHERE campaign_id = ?")
        .bind(nowIso, campId)
        .run();
      await env.DB.prepare(
        "UPDATE premium_selected_placements SET active_campaign_id = NULL, updated_at = ? WHERE placement_id = ? AND active_campaign_id = ?"
      )
        .bind(nowIso, po.placement_id, campId)
        .run();
    }
    try {
      await appendPremiumOrderEvent(env.DB, {
        orderId,
        eventType: "order_deleted",
        actorUserId: guard.userId,
        payload: { mode: "archived", reason, actor_label: guard.userId },
      });
    } catch {
      /* optional */
    }
    return json({
      ok: true,
      mode: "archived",
      message_cs: "Objednávka stornována/archivována — účetní záznamy zůstávají z důvodu povinné evidence.",
    });
  }

  const clientId = String(po.client_id || "");
  const campId = typeof po.published_campaign_id === "string" ? po.published_campaign_id : null;

  if (purgeSystem) {
    await purgePremiumOrderPhysically(env, orderId);
  }

  if (campId) {
    await env.DB.prepare(
      "UPDATE premium_selected_placements SET active_campaign_id = NULL, updated_at = ? WHERE placement_id = ? AND active_campaign_id = ?"
    )
      .bind(nowIso, po.placement_id, campId)
      .run();
    if (purgeSystem) {
      await deleteExclusiveCampaignForPurge(env, campId, orderId);
    } else {
      await env.DB.prepare("UPDATE campaigns SET status = 'cancelled', updated_at = ? WHERE campaign_id = ?").bind(nowIso, campId).run();
    }
  } else if (purgeSystem) {
    const creativeIdOnly = typeof po.creative_id === "string" ? po.creative_id : null;
    if (creativeIdOnly) {
      const shared = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM premium_selected_orders WHERE creative_id = ? AND order_id != ?"
      )
        .bind(creativeIdOnly, orderId)
        .first<{ c: number }>();
      if (!Number(shared?.c)) {
        const cr = await env.DB.prepare("SELECT r2_key FROM creatives WHERE creative_id = ? AND client_id = ?")
          .bind(creativeIdOnly, clientId)
          .first<{ r2_key: string | null }>();
        if (cr?.r2_key && env.CREATIVES) {
          try {
            await env.CREATIVES.delete(cr.r2_key);
          } catch {
            /* best effort */
          }
        }
        await env.DB.prepare("DELETE FROM creatives WHERE creative_id = ? AND client_id = ?").bind(creativeIdOnly, clientId).run();
      }
    }
  }

  await env.DB.prepare("DELETE FROM premium_order_notes WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_events WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_renewals WHERE order_id = ? OR follow_up_order_id = ?")
    .bind(orderId, orderId)
    .run();
  await env.DB.prepare("DELETE FROM premium_order_public_revisions WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_publish_events WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_portal_codes WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_order_price_snapshots WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM premium_selected_orders WHERE order_id = ?").bind(orderId).run();
  await env.DB.prepare("DELETE FROM orders WHERE order_id = ?").bind(orderId).run();

  if (clientId && (await countClientOrders(env.DB, clientId)) === 0) {
    await env.DB.prepare("DELETE FROM client_contacts WHERE client_id = ?").bind(clientId).run();
    await env.DB.prepare("DELETE FROM clients WHERE client_id = ?").bind(clientId).run();
  }

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "premium_order_hard_deleted",
      objectType: "premium_order",
      objectId: orderId,
      after: { mode: purgeSystem ? "purge_system" : "hard_delete", reason },
      result: "success",
    })
  );

  return json({
    ok: true,
    mode: purgeSystem ? "purge_system" : "hard_delete",
    message_cs: purgeSystem ? "Záznam byl odstraněn ze systému." : undefined,
  });
  } catch (err) {
    const code =
      err && typeof err === "object" && "message" in err && String((err as Error).message).includes("SQLITE")
        ? "purge_db_failed"
        : "purge_failed";
    console.error("premium_order_delete_failed", { orderId, purgeSystem, code });
    return json(
      {
        error: code,
        message_cs: purgeSystem
          ? purgeFailureMessage(code === "purge_db_failed" ? "purge_db_failed" : "purge_failed")
          : "Odstranění objednávky selhalo — zkuste archivaci nebo kontaktujte podporu.",
      },
      500
    );
  }
}
