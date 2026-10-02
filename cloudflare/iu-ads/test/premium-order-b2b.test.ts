import { describe, expect, it } from "vitest";
import { handlePublicPremiumOrderSubmit } from "../src/public-premium-order";
import { premiumPlacementId } from "../src/premium-selected-services";
import { PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import type { Env } from "../src/types";

const placementId = premiumPlacementId("aff-zdravi-doplnky", 1);

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    placement_id: placementId,
    company_name: "Podnikatel s.r.o.",
    contact_name: "Jan Novák",
    email: "jan@example.test",
    target_url: "https://example.test/",
    creative_mode: "logo",
    billing_street: "Ulice 1",
    billing_city: "Praha",
    billing_zip: "11000",
    billing_country: "Česká republika",
    terms_version: PREMIUM_TERMS_VERSION,
    terms_effective_at: PREMIUM_TERMS_EFFECTIVE_AT,
    b2b_only: true,
    ico: "27074358",
    ...overrides,
  };
}

function mockEnv(): Env {
  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("premium_selected_placements")) {
                return {
                  placement_id: placementId,
                  category_slug: "aff-zdravi-doplnky",
                  position: 1,
                  current_price_cents: 599000,
                  currency: "CZK",
                };
              }
              return null;
            },
            async run() {
              return { success: true };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { DB: db as Env["DB"], ADS_CODE_PEPPER: "test-pepper-min-16-chars" } as Env;
}

describe("premium order B2B / IČO", () => {
  it("rejects missing IČO", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ ico: "" })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("ico_required");
  });

  it("rejects invalid IČO checksum", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ ico: "12345678" })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("invalid_ico_checksum");
  });

  it("rejects when b2b_only is not true", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ b2b_only: false })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("b2b_required");
  });
});
