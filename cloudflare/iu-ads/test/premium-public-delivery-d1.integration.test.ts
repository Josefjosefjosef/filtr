import { describe, expect, it } from "vitest";
import { selectPublicAds } from "../src/delivery-engine";
import { handlePublicPremiumOrderSubmit } from "../src/public-premium-order";
import { premiumPlacementId } from "../src/premium-selected-services";
import { PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import type { Env } from "../src/types";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";

const category = "aff-zdravi-doplnky";
const placementId = premiumPlacementId(category, 4);

function envFrom(sqlite: ReturnType<typeof createIuAdsSchemaDb>): Env {
  return {
    DB: d1FromSqlite(sqlite),
    ADS_CODE_PEPPER: "test-pepper-min-16-chars",
    ADS_R2_SIGNING_SECRET: "signing-secret-min-32-characters-long",
  } as Env;
}

function seedActiveDeliveryGraph(sqlite: ReturnType<typeof createIuAdsSchemaDb>, campId: string) {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO clients (client_id, company_name, billing_info, created_at, updated_at) VALUES ('cli_del', 'Del Co', '{}', ?, ?)`
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO campaigns (
         campaign_id, evidence_code, client_id, order_id, title, status, label_type, target_url,
         start_at, end_at, created_at, updated_at
       ) VALUES (?, 'EV-DEL', 'cli_del', 'ord_del', 'Premium ad', 'active', 'Reklama', ?, NULL, NULL, ?, ?)`
    )
    .run(campId, "https://example.test/delivery-target", now, now);
  sqlite
    .prepare(
      `INSERT INTO campaign_placements (
         campaign_placement_id, campaign_id, placement_id, placement_type_id, section_id,
         device_category, priority, start_at, end_at, status, created_at, updated_at
       ) VALUES ('cpl_del', ?, ?, 'pt_premium_selected_services', ?, 'pc', 4, NULL, NULL, 'active', ?, ?)`
    )
    .run(campId, placementId, category, now, now);
  sqlite
    .prepare(
      `INSERT INTO creatives (
         creative_id, client_id, campaign_id, format, mime_type, content_hash, r2_key,
         review_status, device_category, created_at, updated_at
       ) VALUES ('crv_del', 'cli_del', ?, 'logo', 'image/png', 'hash', 'creatives/del.png', 'approved', 'pc', ?, ?)`
    )
    .run(campId, now, now);
  sqlite
    .prepare(
      `INSERT INTO rights_confirmations (confirmation_id, campaign_id, confirmed_by_name, confirmed_at, statement_text, terms_version, created_at)
       VALUES ('rcf_del', ?, 'Test', ?, 'rights ok', 'premium-selected-v1', ?)`
    )
    .run(campId, now, now);
}

describe("premium public delivery — D1 integration (freeze)", () => {
  it("does not deliver unapproved orders", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = envFrom(sqlite);
    await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placement_id: placementId,
          company_name: "Pending s.r.o.",
          contact_name: "P",
          email: "pending@example.test",
          phone: "+420 777 123 459",
          target_url: "https://example.test/p",
          creative_mode: "logo",
          billing_street: "Ulice 3",
          billing_city: "Praha",
          billing_zip: "11000",
          billing_country: "Česká republika",
          terms_version: PREMIUM_TERMS_VERSION,
          terms_effective_at: PREMIUM_TERMS_EFFECTIVE_AT,
          b2b_only: true,
          authorization_confirmed: true,
          ordering_person_name: "Marie",
          ico: "27074358",
        }),
      }),
      env
    );
    const ads = await selectPublicAds(env, "https://infouzel.cz", { device: "pc", section: category });
    expect(ads.length).toBe(0);
  });

  it("delivers approved active campaign for matching section with correct target", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = envFrom(sqlite);
    seedActiveDeliveryGraph(sqlite, "cmp_delivery_active");
    const ads = await selectPublicAds(env, "https://infouzel.cz", { device: "pc", section: category });
    expect(ads.length).toBe(1);
    expect(ads[0]!.target_url).toBe("https://example.test/delivery-target");
    expect(ads[0]!.placement_id).toBe(placementId);
  });

  it("hides ended campaigns from delivery", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = envFrom(sqlite);
    const campId = "cmp_delivery_ended";
    seedActiveDeliveryGraph(sqlite, campId);
    sqlite
      .prepare("UPDATE campaigns SET status = 'ended', end_at = ? WHERE campaign_id = ?")
      .run("2020-01-01T00:00:00.000Z", campId);
    const ads = await selectPublicAds(env, "https://infouzel.cz", { device: "pc", section: category });
    expect(ads.length).toBe(0);
  });
});
