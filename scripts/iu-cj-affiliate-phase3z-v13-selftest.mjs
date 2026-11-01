#!/usr/bin/env node
/**
 * Phase 3Z V13 — static catalog, remediation, atomic swap dry-run, DISARMED gates.
 */
import {
  buildStaticMainButtonCatalog,
  buildStaticMainButtonPreview,
  assertCatalogDeterministic,
} from "./iu-cj-affiliate-phase3z-static-main-catalog-v13.mjs";
import {
  evaluateSwapPreflight,
  simulateAtomicSwap,
  simulateRollback,
} from "./iu-cj-affiliate-phase3z-atomic-swap-dry-run-v13.mjs";
import { inventoryLegacyButtons } from "./iu-cj-affiliate-phase3z-legacy-buttons-inventory-v13.mjs";
import { classifyDestinationType, DESTINATION_TYPE } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import { remediatePartnerFromStaging } from "./iu-cj-affiliate-phase3z-v13-remediate-blockers.mjs";
import { attachMainButtonReadiness } from "./iu-cj-affiliate-phase3z-main-button-readiness-v12.mjs";
import { applyLifecycleEvent } from "./iu-cj-affiliate-phase3z-main-button-readiness-v12.mjs";

const failures = [];
const proofs = [];
function expect(id, cond, detail) {
  if (!cond) failures.push({ id, detail: detail ?? null });
  else proofs.push({ id, ok: true });
}

const CJ = "https://www.anrdoezrs.net/click-101883843-17333642-1786578396000";

function readyPartner(over = {}) {
  return {
    advertiserId: "1000001",
    displayNameCs: "Test Partner",
    relationshipStatus: "joined",
    selectedClickUrl: CJ,
    sectionId: "aff-moda",
    destinationType: "MERCHANT_HOMEPAGE",
    unsuitableMainDestination: false,
    mainButtonReady: true,
    mainButtonStatus: "MAIN_BUTTON_READY",
    ...over,
  };
}

// Cheapvuelos destination reclassification
expect(
  "cheapvuelos_promo_not_signup",
  classifyDestinationType(
    "https://www.cheapvuelos.com/cheapflights-affiliates/",
    "Cheap Flights Worldwide **Promo Code"
  ) !== DESTINATION_TYPE.AFFILIATE_SIGNUP
);
expect(
  "true_affiliates_still_signup",
  classifyDestinationType("https://shop.example/affiliates/join", "Join") ===
    DESTINATION_TYPE.AFFILIATE_SIGNUP ||
    classifyDestinationType("https://shop.example/affiliates/", "Join") ===
      DESTINATION_TYPE.AFFILIATE_SIGNUP
);
expect(
  "paragon_still_checkout",
  classifyDestinationType(
    "https://shop.paragon-software.com/80/?scope=checkout&cart=1",
    "Buy"
  ) === DESTINATION_TYPE.CHECKOUT
);

// Remediate Cheapvuelos fixture links
{
  const partner = {
    advertiserId: "7947783",
    displayNameCs: "Cheapvuelos",
    relationshipStatus: "joined",
    selectedClickUrl: CJ,
    sectionId: "aff-letenky-letecka-doprava",
    destinationType: "AFFILIATE_SIGNUP",
    unsuitableMainDestination: true,
    holdReason: "UNSUITABLE_MAIN_DESTINATION",
    publishability: "QUARANTINED",
  };
  const links = [
    {
      linkId: "17333642",
      linkName: "Cheap Flights Worldwide",
      linkType: "Text Link",
      advertiserId: "7947783",
      clickUrl: CJ,
      destination: "https://www.cheapvuelos.com/cheapflights-affiliates/",
    },
  ];
  const rem = remediatePartnerFromStaging(partner, links, { advertiserId: "7947783" }, "101883843");
  expect("cheapvuelos_remediated", rem.resolved === true, rem);
  expect(
    "cheapvuelos_dest_type_ok",
    rem.partner.destinationType !== "AFFILIATE_SIGNUP" && rem.partner.unsuitableMainDestination === false,
    rem.partner
  );
}

// Paragon remains blocked
{
  const partner = {
    advertiserId: "4686326",
    displayNameCs: "Paragon Software Group",
    relationshipStatus: "joined",
    selectedClickUrl: "https://www.tkqlhce.com/click-101883843-12643722-1665539154000",
    sectionId: "aff-software",
    destinationType: "CHECKOUT",
    unsuitableMainDestination: true,
    holdReason: "UNSUITABLE_MAIN_DESTINATION",
  };
  const links = [
    {
      linkId: "12643722",
      linkName: "Microsoft NTFS for Mac",
      advertiserId: "4686326",
      clickUrl: partner.selectedClickUrl,
      destination: "https://shop.paragon-software.com/277/?scope=checkout&cart=226074",
    },
  ];
  const rem = remediatePartnerFromStaging(partner, links, { advertiserId: "4686326" }, "101883843");
  expect("paragon_still_blocked", rem.resolved === false, rem);
  expect("paragon_auto_retry_documented", Array.isArray(rem.attempts) && rem.attempts.length >= 2, rem);
}

// Static catalog build + deterministic + >8 in section
{
  const partners = [];
  for (let i = 0; i < 12; i++) {
    partners.push(
      readyPartner({
        advertiserId: String(3000000 + i),
        displayNameCs: "Partner " + i,
        sectionId: "aff-moda",
      })
    );
  }
  partners.push(
    readyPartner({
      advertiserId: "4686326",
      displayNameCs: "Paragon Software Group",
      sectionId: "aff-software",
      mainButtonReady: false,
      mainButtonStatus: "UNSUITABLE_CUSTOMER_DESTINATION",
      destinationType: "CHECKOUT",
      selectedClickUrl: "https://www.tkqlhce.com/click-101883843-12643722-1",
    })
  );
  const reg = { partners, publicButtonSwapArmed: false };
  attachMainButtonReadiness(reg);
  // force ready flags for the 12 moda (attach may already set)
  for (const p of reg.partners) {
    if (String(p.advertiserId).startsWith("3000")) {
      p.mainButtonReady = true;
      p.sectionId = "aff-moda";
    }
  }
  const cat1 = buildStaticMainButtonCatalog(reg, {
    sectionTitles: new Map([["aff-moda", "Móda"]]),
    generatedAt: "2026-11-01T00:00:00Z",
  });
  const cat2 = buildStaticMainButtonCatalog(reg, {
    sectionTitles: new Map([["aff-moda", "Móda"]]),
    generatedAt: "2026-11-01T00:00:00Z",
  });
  expect("static_deterministic", assertCatalogDeterministic(cat1, cat2), {
    a: cat1.manifest.sha256,
    b: cat2.manifest.sha256,
  });
  expect("static_gt_eight", (cat1.sectionCounts["aff-moda"] || 0) >= 8, cat1.sectionCounts);
  expect("static_disarmed", cat1.publicButtonSwapArmed === false);
  expect("static_no_browser_cj", cat1.browserCjApiDependency === false);
  expect("one_per_advertiser", cat1.counts.duplicates === 0);
  const prev = buildStaticMainButtonPreview(cat1);
  expect("preview_disarmed", prev.publicButtonSwapArmed === false && prev.previewOnly === true);

  // attrs
  expect(
    "button_attrs",
    cat1.buttons.every((b) => b.target === "_blank" && b.rel === "sponsored noopener")
  );
}

// Atomic swap dry-run + rollback
{
  const catalogJs = `
    const IU_AFFILIATE_CATALOG = [
      { id: "aff-moda", title: "Moda", items: [
        { kind: "partner", title: "CJ One", url: "https://www.anrdoezrs.net/click-101883843-1", advertiserId: "1" },
        { kind: "partner", title: "NonCJ Shop", url: "https://example.com/shop", advertiserId: null }
      ]},
      { id: "aff-radio-like", title: "Other", items: [] }
    ];
  `;
  // parseAffiliateCatalogOrdered may need real format — use minimal fixture via inventory path
  const staticCatalog = {
    publicButtonSwapArmed: false,
    browserCjApiDependency: false,
    counts: { buttons: 2 },
    buttons: [
      {
        advertiserId: "1",
        title: "CJ One",
        url: "https://www.anrdoezrs.net/click-101883843-1",
        sectionId: "aff-moda",
      },
      {
        advertiserId: "2",
        title: "CJ Two",
        url: "https://www.anrdoezrs.net/click-101883843-2",
        sectionId: "aff-moda",
      },
    ],
    sections: [
      {
        sectionId: "aff-moda",
        buttons: [
          {
            advertiserId: "1",
            title: "CJ One",
            url: "https://www.anrdoezrs.net/click-101883843-1",
            sectionId: "aff-moda",
          },
          {
            advertiserId: "2",
            title: "CJ Two",
            url: "https://www.anrdoezrs.net/click-101883843-2",
            sectionId: "aff-moda",
          },
        ],
      },
    ],
  };
  const registry = {
    partners: [
      { advertiserId: "1", mainButtonReady: true },
      { advertiserId: "2", mainButtonReady: true },
    ],
  };
  const pre = evaluateSwapPreflight({ registry, staticCatalog, publicButtonSwapArmed: false });
  expect("preflight_ok", pre.ok === true && pre.wouldPublish === false, pre);

  let armedThrow = false;
  try {
    simulateAtomicSwap({ catalogJsText: catalogJs, staticCatalog, publicButtonSwapArmed: true });
  } catch (e) {
    armedThrow = /REFUSES_ARMED/.test(String(e?.message || e));
  }
  expect("refuses_armed_swap", armedThrow === true);

  // Lifecycle / LKG helpers still DISARMED
  expect("api_failure_preserve", applyLifecycleEvent({}, "API_FAILURE").action === "PRESERVE_SAFE_STATE");
  expect("incomplete_no_mass_delete", applyLifecycleEvent({}, "INCOMPLETE_SNAPSHOT").action === "NO_MASS_DELETE");
  expect("idempotent", applyLifecycleEvent({}, "REPEATED_RUN").action === "IDEMPOTENT");
  const failPub = applyLifecycleEvent({ publicButtonSwapArmed: true }, "PUBLICATION_FAILURE");
  expect("rollback_disarms", failPub.action === "ROLLBACK" && failPub.publicButtonSwapArmed === false, failPub);
}

// Legacy inventory shape
{
  const inv = inventoryLegacyButtons({
    catalogJsText: `
      window.IU_AFFILIATE_CATALOG = [
        { id: "aff-moda", title: "Moda", items: [
          { title: "GANT.CZ", url: "https://www.anrdoezrs.net/click-101883843-1", advertiserId: "4978487" }
        ]}
      ];
    `,
    registry: {
      partners: [
        {
          advertiserId: "4978487",
          relationshipStatus: "joined",
          mainButtonReady: true,
          sectionId: "aff-moda",
          selectedClickUrl: "https://www.anrdoezrs.net/click-101883843-1",
        },
      ],
    },
    managedPublic: { partners: [] },
    slotPolicy: { partners: [] },
  });
  expect("legacy_schema", inv.schema.includes("legacy-buttons-inventory-v13"));
  expect("legacy_disarmed", inv.publicButtonSwapArmed === false);
}

const out = {
  ok: failures.length === 0,
  schema: "iu-cj-affiliate-phase3z-v13-selftest",
  proofs: proofs.length,
  failures,
  publicButtonSwapArmed: false,
};
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 1;
