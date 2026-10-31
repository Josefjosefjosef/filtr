#!/usr/bin/env node
/**
 * Category consistency regression:
 * independent weighted evidence ↔ golden expected ↔ applied override section.
 * Never lets golden silently absorb a wrong robot output.
 */
import {
  MERCHANT_EVIDENCE_OVERRIDES,
  GOLDEN_DATASET_V9,
  extractWeightedAssortmentEvidence,
  applyMerchantEvidenceOverride,
} from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";

const failures = [];
const proofs = [];
function expect(id, cond, detail) {
  if (!cond) failures.push({ id, detail: detail ?? null });
  else proofs.push({ id, ok: true, detail: detail ?? null });
}

// Argos.cz: brand + title evidence must drive aff-elektro (not dum-zahrada / not dilna-primary).
const argosHtml = `
<html><head>
<title>ARGOS ELEKTRO – elektroinstalační materiál, světla, fotovoltaika | 20 prodejen</title>
<meta name="description" content="Elektroinstalační materiál, svítidla a fotovoltaika ARGOS ELEKTRO.">
</head>
<body>
<header><nav>Elektroinstalace · Svítidla · Fotovoltaika · Velkoobchod</nav></header>
<main><h1>ARGOS ELEKTRO</h1><p>Elektroinstalační materiál pro profesionály.</p></main>
<footer>Cookie · Privacy · Partners fashion kitchen hotel</footer>
</body></html>`;
const argosEv = extractWeightedAssortmentEvidence(argosHtml, {
  title: "ARGOS ELEKTRO – elektroinstalační materiál, světla, fotovoltaika | 20 prodejen",
  merchantIdentity: "Argos.cz",
});
expect("argos_evidence_elektro", argosEv.primaryAssortment?.sectionId === "aff-elektro", argosEv);
expect(
  "argos_no_footer_moda",
  !(argosEv.significantGroups || []).some((g) => g.group === "moda" || g.group === "kuchyn"),
  argosEv.significantGroups
);
const argosOv = applyMerchantEvidenceOverride({
  advertiserId: "8010554",
  assortment: { merchantType: "SPECIALIST" },
  baseSectionId: "aff-dum-zahrada",
});
expect(
  "argos_override_elektro_not_dum",
  argosOv.applied &&
    argosOv.sectionId === "aff-elektro" &&
    argosOv.sectionId !== "aff-dum-zahrada" &&
    argosOv.sectionId !== "aff-dilna-naradi",
  argosOv
);
expect(
  "argos_evidence_matches_golden",
  argosEv.primaryAssortment?.sectionId ===
    MERCHANT_EVIDENCE_OVERRIDES["8010554"].primaryAssortment.sectionId,
  {
    evidence: argosEv.primaryAssortment,
    golden: MERCHANT_EVIDENCE_OVERRIDES["8010554"].primaryAssortment,
  }
);

// Lékárna stem must match Czech diacritics title (no trailing-\b stem trap).
const lekEv = extractWeightedAssortmentEvidence(
  "<html><head><title>Lékárna.cz první online lékárna</title></head><body><h1>Lékárna.cz</h1></body></html>",
  { title: "Lékárna.cz první online lékárna", merchantIdentity: "Lékárna.cz" }
);
expect("lekarna_content_verified", lekEv.contentVerified === true, lekEv);
expect("lekarna_section", lekEv.primaryAssortment?.sectionId === "aff-lekarny", lekEv.primaryAssortment);

// Leo Express must never land on flights tile.
expect(
  "leo_override_not_flights",
  MERCHANT_EVIDENCE_OVERRIDES["6130482"]?.primaryAssortment?.sectionId === "aff-cestovni-kancelare" &&
    (MERCHANT_EVIDENCE_OVERRIDES["6130482"].rejectSectionIds || []).includes("aff-letenky-letecka-doprava"),
  MERCHANT_EVIDENCE_OVERRIDES["6130482"]
);
const leoEv = extractWeightedAssortmentEvidence(
  "<html><head><title>Leo Express – vlaky Praha Ostrava</title></head><body><nav>Jízdní řády · Vlakové jízdenky</nav><main><h1>Leo Express</h1></main></body></html>",
  { title: "Leo Express – vlaky Praha Ostrava", merchantIdentity: "Leo Express Europe" }
);
expect(
  "leo_evidence_travel_not_flights",
  leoEv.primaryAssortment?.sectionId === "aff-cestovni-kancelare" &&
    !(leoEv.significantGroups || []).some((g) => g.group === "letenky"),
  leoEv
);

// Golden dataset must stay explicit — preferCategoryReview entries have null primary.
for (const g of GOLDEN_DATASET_V9) {
  const ov = MERCHANT_EVIDENCE_OVERRIDES[g.advertiserCid];
  expect(
    "golden_bound_" + g.advertiserCid,
    Boolean(ov) && ov.merchantIdentity === g.merchantIdentity,
    { g, ov: ov?.merchantIdentity }
  );
  if (!g.preferCategoryReview) {
    expect(
      "golden_section_explicit_" + g.advertiserCid,
      g.expectedPrimarySectionId === ov.primaryAssortment?.sectionId,
      { expected: g.expectedPrimarySectionId, ov: ov.primaryAssortment }
    );
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, proofs }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      IU_CJ_PHASE3Z_CATEGORY_CONSISTENCY_SELFTEST: "OK",
      proofCount: proofs.length,
      argosSection: "aff-elektro",
      goldenCount: GOLDEN_DATASET_V9.length,
    },
    null,
    2
  )
);
