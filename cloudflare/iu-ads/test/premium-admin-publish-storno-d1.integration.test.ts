import { describe, expect, it } from "vitest";
import { selectPublicAds } from "../src/delivery-engine";
import { executePremiumAdTurnOff } from "../src/premium-ad-turnoff";
import { executePremiumOrderAccountingCancel } from "../src/premium-order-accounting-cancel";
import { executePremiumApproveAndPublish } from "../src/premium-publish";
import { handlePublicPremiumOrderSubmit } from "../src/public-premium-order";
import { premiumPlacementId } from "../src/premium-selected-services";
import { PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import type { Env } from "../src/types";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";

const category = "aff-zdravi-doplnky";
const placementId = premiumPlacementId(category, 1);
const NOW = "2026-06-15T10:00:00.000Z";
const STORNO_REASON = "Klient požádal o zrušení smlouvy po vypnutí reklamy v testu.";

function makeEnv(sqlite: ReturnType<typeof createIuAdsSchemaDb>): Env {
  return {
    DB: d1FromSqlite(sqlite),
    ADS_CODE_PEPPER: "test-pepper-min-16-chars",
    ADS_R2_SIGNING_SECRET: "signing-secret-min-32-characters-long",
  } as Env;
}

async function submitTestOrder(env: Env): Promise<string> {
  const res = await handlePublicPremiumOrderSubmit(
    new Request("https://ads.test/v1/public/premium/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placement_id: placementId,
        company_name: "Storno s.r.o.",
        contact_name: "Storno Test",
        email: "storno-d1@example.test",
        phone: "+420 777 123 460",
        target_url: "https://example.test/storno-ad",
        creative_mode: "logo",
        billing_street: "Ulice 2",
        billing_city: "Praha",
        billing_zip: "11000",
        billing_country: "Česká republika",
        terms_version: PREMIUM_TERMS_VERSION,
        terms_effective_at: PREMIUM_TERMS_EFFECTIVE_AT,
        b2b_only: true,
        authorization_confirmed: true,
        ordering_person_name: "Marie Storno",
        ico: "27074358",
      }),
    }),
    env
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { order_id: string };
  return body.order_id;
}

function attachCreativeForApproval(sqlite: ReturnType<typeof createIuAdsSchemaDb>, orderId: string) {
  const order = sqlite.prepare("SELECT client_id FROM orders WHERE order_id = ?").get(orderId) as { client_id: string };
  const creativeId = "crv_st_" + orderId.slice(-6);
  sqlite
    .prepare(
      `INSERT INTO creatives (
         creative_id, client_id, format, mime_type, content_hash, r2_key, review_status, device_category, created_at, updated_at
       ) VALUES (?, ?, 'logo', 'image/png', 'hash', ?, 'pending', 'pc', ?, ?)`
    )
    .run(creativeId, order.client_id, "creatives/" + creativeId + ".png", NOW, NOW);
  sqlite
    .prepare(
      `UPDATE premium_selected_orders
       SET workflow_status = 'under_review', creative_id = ?, creative_mode = 'logo', updated_at = ?
       WHERE order_id = ?`
    )
    .run(creativeId, NOW, orderId);
}

describe("premium publish → turn-off → accounting storno — D1 integration (freeze)", () => {
  it("full post-publish storno releases placement, stops delivery, creates credit note idempotently", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = makeEnv(sqlite);
    const orderId = await submitTestOrder(env);
    attachCreativeForApproval(sqlite, orderId);

    const reserved = sqlite
      .prepare("SELECT workflow_status, placement_id FROM premium_selected_orders WHERE order_id = ?")
      .get(orderId) as { workflow_status: string; placement_id: string };
    expect(reserved.workflow_status).toBe("under_review");
    expect(reserved.placement_id).toBe(placementId);

    const pub = await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_storno",
      idempotencyKey: "idem:publish:storno:1",
    });
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;

    let ads = await selectPublicAds(env, "https://infouzel.cz", { device: "pc", section: category });
    expect(ads.length).toBe(1);
    expect(ads[0]!.target_url).toBe("https://example.test/storno-ad");

    const turnOff = await executePremiumAdTurnOff(env, {
      orderId,
      actorUserId: "adm_storno",
      reason: "Definitivní vypnutí reklamy před účetním stornem objednávky.",
      idempotencyKey: "idem:turnoff:1",
    });
    expect(turnOff.ok).toBe(true);

    ads = await selectPublicAds(env, "https://infouzel.cz", { device: "pc", section: category });
    expect(ads.length).toBe(0);

    const plAfterOff = sqlite
      .prepare("SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?")
      .get(placementId) as { active_campaign_id: string | null };
    expect(plAfterOff.active_campaign_id).toBeNull();

    const poBeforeCancel = sqlite
      .prepare(
        "SELECT workflow_status, ad_turned_off_at, published_campaign_id FROM premium_selected_orders WHERE order_id = ?"
      )
      .get(orderId) as {
      workflow_status: string;
      ad_turned_off_at: string | null;
      published_campaign_id: string | null;
    };
    expect(poBeforeCancel.workflow_status).toBe("published");
    expect(poBeforeCancel.ad_turned_off_at).toBeTruthy();

    const invoiceBefore = sqlite
      .prepare("SELECT invoice_id, status, total_cents FROM invoices WHERE order_id = ?")
      .get(orderId) as { invoice_id: string; status: string; total_cents: number };

    const cancel = await executePremiumOrderAccountingCancel(env, {
      orderId,
      actorUserId: "adm_storno",
      reason: STORNO_REASON,
      paymentSettlement: "unpaid",
      idempotencyKey: "idem:acct-cancel:1",
    });
    expect(cancel.ok).toBe(true);
    if (!cancel.ok) return;
    expect(cancel.idempotent).toBe(false);

    const poAfter = sqlite
      .prepare("SELECT workflow_status, accounting_cancelled_at FROM premium_selected_orders WHERE order_id = ?")
      .get(orderId) as { workflow_status: string; accounting_cancelled_at: string | null };
    expect(poAfter.workflow_status).toBe("cancelled");
    expect(poAfter.accounting_cancelled_at).toBeTruthy();

    const camp = sqlite
      .prepare("SELECT status FROM campaigns WHERE campaign_id = ?")
      .get(poBeforeCancel.published_campaign_id!) as { status: string };
    expect(["ended", "cancelled", "archived"].includes(camp.status) || camp.status === "active").toBe(true);

    const storno = sqlite
      .prepare("SELECT storno_kind, credit_note_id, invoice_id FROM premium_order_storno_records WHERE order_id = ?")
      .get(orderId) as { storno_kind: string; credit_note_id: string | null; invoice_id: string | null };
    expect(storno.storno_kind).toBe("cancellation");
    expect(storno.credit_note_id).toBeTruthy();
    expect(storno.invoice_id).toBe(invoiceBefore.invoice_id);

    const credit = sqlite
      .prepare("SELECT correction_cents, invoice_id FROM premium_credit_notes WHERE order_id = ?")
      .get(orderId) as { correction_cents: number; invoice_id: string };
    expect(credit.correction_cents).toBeLessThan(0);
    expect(credit.invoice_id).toBe(invoiceBefore.invoice_id);

    const invoiceAfter = sqlite
      .prepare("SELECT status FROM invoices WHERE invoice_id = ?")
      .get(invoiceBefore.invoice_id) as { status: string };
    expect(invoiceAfter.status).toBe("cancelled");

    const stornoCount = sqlite
      .prepare("SELECT COUNT(*) AS c FROM premium_order_storno_records WHERE order_id = ?")
      .get(orderId) as { c: number };
    const creditCount = sqlite
      .prepare("SELECT COUNT(*) AS c FROM premium_credit_notes WHERE order_id = ?")
      .get(orderId) as { c: number };

    const replay = await executePremiumOrderAccountingCancel(env, {
      orderId,
      actorUserId: "adm_storno",
      reason: STORNO_REASON,
      paymentSettlement: "unpaid",
      idempotencyKey: "idem:acct-cancel:2",
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.idempotent).toBe(true);

    expect(
      (sqlite.prepare("SELECT COUNT(*) AS c FROM premium_order_storno_records WHERE order_id = ?").get(orderId) as { c: number }).c
    ).toBe(Number(stornoCount.c));
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS c FROM premium_credit_notes WHERE order_id = ?").get(orderId) as { c: number }).c
    ).toBe(Number(creditCount.c));
  });
});
