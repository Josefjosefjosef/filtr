#!/usr/bin/env node
/**
 * Regression: footer/cookie/ad keyword noise must NOT create assortment categories.
 * ABBYY / Paragon must stay software-primary under weighted evidence.
 */
import {
  extractWeightedAssortmentEvidence,
} from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import {
  buildAssortmentProfile,
  LINK_INVENTORY_SECTION_CAP,
} from "./iu-cj-affiliate-phase3z-assortment-v8.mjs";

const failures = [];
const proofs = [];
function expect(id, cond, detail) {
  if (!cond) failures.push({ id, detail: detail ?? null });
  else proofs.push({ id, ok: true, detail: detail ?? null });
}

const noisyAbbyyHtml = `
<!DOCTYPE html><html><head><title>ABBYY | The Intelligent Automation Company</title></head>
<body>
<header><nav><a href="/products">PDF Software</a><a href="/finereader">FineReader</a></nav></header>
<main><h1>ABBYY Intelligent Document Processing</h1><p>OCR and PDF software for enterprises.</p></main>
<footer>
  Partners: fashion marketplace insurance hotel kitchen furniture tire shop sportswear pet food
  Cookie consent: we use cookies. Privacy. Newsletter signup.
  Recommended: kitchen appliances, moda, pojištění, ubytování, sport, pneumatiky, nábytek
</footer>
<aside class="adsbygoogle">Buy kitchen moda pojisteni sport</aside>
<script>var x = "kitchen fashion insurance hotel sport pet tire furniture";</script>
</body></html>`;

const abbyy = extractWeightedAssortmentEvidence(noisyAbbyyHtml, {
  title: "ABBYY | The Intelligent Automation Company",
  merchantIdentity: "ABBYY",
});
expect(
  "abbyy_primary_software",
  abbyy.primaryAssortment?.group === "software" ||
    (abbyy.significantGroups || []).some((g) => g.group === "software"),
  abbyy
);
expect(
  "abbyy_no_footer_noise_significant",
  !(abbyy.significantGroups || []).some((g) =>
    ["kuchyn", "moda", "pojisteni", "ubytovani", "sport", "pneu", "nabytek", "zvirata", "marketplace"].includes(
      g.group
    )
  ),
  abbyy.significantGroups
);
expect(
  "abbyy_only_software_significant",
  (abbyy.significantGroups || []).length === 1 && abbyy.significantGroups[0].group === "software",
  abbyy.significantGroups
);
expect("abbyy_content_verified_software_only", abbyy.contentVerified === true, {
  contentVerified: abbyy.contentVerified,
  groups: abbyy.significantGroups,
});

const noisyParagonHtml = `
<html><head><title>Paragon Software | Main page</title></head>
<body>
<nav>NTFS for Mac · Hard Disk Manager · File Systems</nav>
<main><h1>Paragon Software Group</h1><p>Disk utilities and file system drivers.</p></main>
<footer>kitchen animals tires furniture moda pojisteni sport hotel cookie banner ads</footer>
</body></html>`;

const paragon = extractWeightedAssortmentEvidence(noisyParagonHtml, {
  title: "Paragon Software | Main page",
  merchantIdentity: "Paragon Software Group",
});
expect(
  "paragon_primary_software",
  paragon.primaryAssortment?.group === "software" ||
    (paragon.significantGroups || []).some((g) => g.group === "software"),
  paragon
);
expect(
  "paragon_no_footer_noise_significant",
  !(paragon.significantGroups || []).some((g) =>
    ["kuchyn", "zvirata", "pneu", "nabytek", "moda", "pojisteni", "sport"].includes(g.group)
  ),
  paragon.significantGroups
);

// Body-only keywords without title/nav/identity must NOT be significant.
const bodyOnly = extractWeightedAssortmentEvidence(
  `<html><body><div>kitchen fashion insurance hotel sport pet tire furniture moda pojisteni</div></body></html>`,
  { title: "", merchantIdentity: null }
);
expect(
  "body_only_not_significant",
  (bodyOnly.significantGroups || []).length === 0 && bodyOnly.contentVerified === false,
  bodyOnly
);

// Link inventory spam cannot invent a competing primary section beyond cap.
const spamLinks = Array.from({ length: 40 }, (_, i) => ({
  linkId: String(1000 + i),
  linkName: "Kitchen moda pojisteni sport pet tire furniture gift",
  destination: "https://example.com/p/" + i,
  linkType: "Text Link",
}));
const capped = buildAssortmentProfile({
  advertiser: {
    advertiserId: "2624620",
    advertiserName: "ABBYY Europe Affiliate Program",
    programUrl: "https://www.abbyy.com",
    primaryCategory: { parent: "Software", child: "Business Software" },
  },
  links: spamLinks,
  websiteEvidence: abbyy,
});
const kuchyn = (capped.allScoredGroups || []).find((g) => g.sectionId === "aff-kuchyn");
expect(
  "link_spam_capped",
  !kuchyn || kuchyn.weight <= LINK_INVENTORY_SECTION_CAP,
  { kuchyn, cap: LINK_INVENTORY_SECTION_CAP, primary: capped.primaryAssortment }
);
expect(
  "abbyy_profile_stays_software",
  capped.primaryAssortment?.sectionId === "aff-software" ||
    capped.primaryAssortment?.group === "software",
  capped.primaryAssortment
);

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, proofs }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      IU_CJ_PHASE3Z_ASSORTMENT_EVIDENCE_SELFTEST: "OK",
      proofCount: proofs.length,
      proofs,
    },
    null,
    2
  )
);
