import { describe, expect, it } from "vitest";
import { buildPremiumOrderMetaHtml } from "../src/premium-order-meta";
import { buildPremiumOrderShellHtml } from "../src/premium-order-ui";
import { PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import { premiumPlacementId } from "../src/premium-selected-services";
import type { Env } from "../src/types";

describe("premium order UI shell", () => {
  it("includes B2B, IČO, structured billing, live-slot preview, terms link", () => {
    const html = buildPremiumOrderShellHtml("nonce-test", "<p>summary ok</p>");
    expect(html).toContain("summary ok");
    expect(html).toContain("Obchodní firma / jméno podnikatele");
    expect(html).toContain('id="ico"');
    expect(html).toContain('id="ico_err"');
    expect(html).toContain("IČO *");
    expect(html).toContain("billing_street");
    expect(html).toContain('id="previewSlot"');
    expect(html).toContain("iuPremiumSlot--sold");
    expect(html).toContain("iuPremiumSlotImg");
    expect(html).toContain("invalid_ico_checksum");
    expect(html).toContain("Zadané IČO není platné");
    expect(html).not.toContain('err.textContent=(j1&&j1.error)');
    expect(html).toContain('id="submit_btn"');
    expect(html).toContain("Odesílám");
    expect(html).toContain('id="keyterms"');
    expect(html).toContain("/premium/terms");
    expect(html).toContain(PREMIUM_TERMS_VERSION);
    expect(html).toContain("výhradně podnikatelům");
  });

  it("builds server-side order summary from placement row", async () => {
    const placementId = premiumPlacementId("aff-cestovni-kancelare", 1);
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  return {
                    placement_id: placementId,
                    category_slug: "aff-cestovni-kancelare",
                    position: 1,
                    current_price_cents: 599000,
                    currency: "CZK",
                  };
                },
              };
            },
          };
        },
      },
    } as Env;
    const meta = await buildPremiumOrderMetaHtml(env, "aff-cestovni-kancelare", placementId);
    expect(meta).toContain("Prémiová reklamní pozice");
    expect(meta).toContain("P1");
    expect(meta).toContain("5");
    expect(meta).toContain("990");
    expect(meta).toContain("6 měsíců");
    expect(meta).toContain("výhradně podnikatelům");
  });
});
