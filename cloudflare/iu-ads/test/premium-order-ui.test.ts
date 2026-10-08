import { describe, expect, it } from "vitest";
import { buildPremiumOrderMetaHtml } from "../src/premium-order-meta";
import { buildPremiumOrderShellHtml } from "../src/premium-order-ui";
import { PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import { premiumPlacementId } from "../src/premium-selected-services";
import type { Env } from "../src/types";

describe("premium order UI shell", () => {
  it("includes B2B, IČO first, phone required, preview, cancel, ARES hint", () => {
    const html = buildPremiumOrderShellHtml("nonce-test", "<p>summary ok</p>", 2);
    expect(html).toContain("summary ok");
    const icoIdx = html.indexOf('id="ico"');
    const companyIdx = html.indexOf('id="company_name"');
    expect(icoIdx).toBeGreaterThan(0);
    expect(companyIdx).toBeGreaterThan(icoIdx);
    expect(html).toContain("infoUzel.cz nesleduje zobrazení ani prokliky");
    expect(html).toContain("Reklamní služba je určena výhradně podnikatelům a firmám");
    expect(html).toContain("Nejprve zadejte IČO");
    expect(html).toContain('id="ico_err"');
    expect(html).toContain("Telefon *");
    expect(html).toContain('id="phone"');
    expect(html).toContain('id="cancel_btn"');
    expect(html).toContain("Zrušit a zavřít");
    expect(html).toContain('id="previewSlot"');
    expect(html).toContain("previewBlock");
    expect(html).toContain('id="authorization_confirmed"');
    expect(html).toContain("oprávněn/a objednat tuto reklamu");
    expect(html).toContain('id="ordering_person_name"');
    expect(html).toContain("Jméno a příjmení objednávající osoby");
    expect(html).not.toMatch(/<h1>Prémiová reklamní pozice<\/h1>\s*<p class="muted">infoUzel\.cz nesleduje/);
    expect(html).toContain("iuPremiumPreviewGrid--p2");
    expect(html).toContain("Takto bude vaše reklama vypadat v prémiové pozici na tomto zařízení.");
    expect(html).toContain("invalid_ico_checksum");
    expect(html).toContain("Zadané IČO není platné");
    expect(html).not.toContain('err.textContent=(j1&&j1.error)');
    expect(html).toContain('id="submit_btn"');
    expect(html).toContain("Odesílám");
    expect(html).toContain('id="keyterms"');
    expect(html).toContain("/premium/terms");
    expect(html).toContain(PREMIUM_TERMS_VERSION);
    expect(html).toContain("/v1/public/ares/ico");
    expect(html).toContain('id="registry_lookup"');
    expect(html).toContain("max. 5 MB");
    const fileIdx = html.indexOf('id="file"');
    const modeIdx = html.indexOf("creative_mode_label");
    expect(fileIdx).toBeGreaterThan(0);
    expect(modeIdx).toBeGreaterThan(fileIdx);
    expect(html).toContain('id="creative_confirm_btn"');
    expect(html).toContain("Potvrdit vzhled");
    expect(html).toContain("Upravit vzhled");
    expect(html).toContain('id="file_pick_btn"');
    expect(html).toContain("creative_appearance_unconfirmed");
    expect(html).toContain("resolveCreativeMime");
    expect(html).toContain("bindPremiumCreativeImage");
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
    expect(meta).toContain("Celková cena za 6 měsíců");
    expect(meta).toContain("6 kalendářních měsíců");
    expect(meta).toContain("výhradně podnikatelům");
  });
});
