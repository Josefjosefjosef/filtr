import { describe, expect, it } from "vitest";
import { handlePublicPremiumOrderSubmit } from "../src/public-premium-order";
import { premiumPlacementId } from "../src/premium-selected-services";
import { PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_V1_VERSION, PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import type { Env } from "../src/types";

const placementId = premiumPlacementId("aff-zdravi-doplnky", 1);

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    placement_id: placementId,
    company_name: "Podnikatel s.r.o.",
    contact_name: "Jan Novák",
    email: "jan@example.test",
    phone: "+420 777 123 456",
    target_url: "https://example.test/",
    creative_mode: "logo",
    billing_street: "Ulice 1",
    billing_city: "Praha",
    billing_zip: "11000",
    billing_country: "Česká republika",
    terms_version: PREMIUM_TERMS_VERSION,
    terms_effective_at: PREMIUM_TERMS_EFFECTIVE_AT,
    b2b_only: true,
    authorization_confirmed: true,
    ordering_person_name: "Marie Objednávková",
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

  it("accepts valid IČO checksum", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ ico: "27074358" })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(201);
  });

  it("rejects invalid IČO format", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ ico: "123456789" })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("invalid_ico_format");
  });

  it("rejects wrong terms version", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ terms_version: PREMIUM_TERMS_V1_VERSION })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("invalid_terms_version");
  });

  it("accepts intermediate creative mode image_medium", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ creative_mode: "image_medium" })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(201);
  });

  it("rejects missing phone", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ phone: "" })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("phone_required");
  });

  it("rejects missing authorization confirmation", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ authorization_confirmed: false })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("authorization_required");
  });

  it("rejects missing ordering person name", async () => {
    const res = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody({ ordering_person_name: "  " })),
      }),
      mockEnv()
    );
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("ordering_person_required");
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
