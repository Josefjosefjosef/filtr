/**
 * Unit tests: P0 source matching for content freshness guard (cluster merge safe).
 * Run: node scripts/content-freshness-guard-unit.mjs
 */
import {
  P0_CONTENT_SOURCES,
  articleMatchesP0Source,
  newestProductionForP0,
} from "./content-freshness-guard-lib.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const ct24Def = P0_CONTENT_SOURCES.find((d) => d.id === "ct24");
const idnesDef = P0_CONTENT_SOURCES.find((d) => d.id === "idnes");
const novinkyDef = P0_CONTENT_SOURCES.find((d) => d.id === "novinky");
const seznamDef = P0_CONTENT_SOURCES.find((d) => d.id === "seznam");
const sportDef = P0_CONTENT_SOURCES.find((d) => d.id === "sportcz");

// 1. CT24 URL match
const ct24UrlArticle = {
  url: "https://ct24.ceskatelevize.cz/clanek/domaci/test-373502",
  sources: [{ name: "ČT24", url: "https://ct24.ceskatelevize.cz/clanek/domaci/test-373502" }],
  publishedAt: "2026-06-02T05:00:00.000Z",
};
assert(articleMatchesP0Source(ct24UrlArticle, ct24Def), "CT24 URL match");

// 2. CT24 source metadata match (iDNES winner URL, ČT24 contributor)
const ct24ContributorArticle = {
  url: "https://www.idnes.cz/zpravy/domaci/example.A260516_101845_domaci_svm",
  feedId: "zpr_idnes_zpravy",
  sourceLabel: "iDNES.cz",
  sources: [
    {
      name: "iDNES.cz",
      url: "https://www.idnes.cz/zpravy/domaci/example.A260516_101845_domaci_svm",
    },
    {
      name: "ČT24",
      url: "https://ct24.ceskatelevize.cz/clanek/domaci/example-373502",
    },
  ],
  publishedAt: "2026-06-02T06:34:00.000Z",
};
assert(articleMatchesP0Source(ct24ContributorArticle, ct24Def), "CT24 source metadata match");

const ct24FeedIdArticle = {
  url: "https://www.idnes.cz/zpravy/domaci/feedid-only",
  feedId: "zpr_ct24_domaci",
  sources: [{ name: "iDNES.cz", url: "https://www.idnes.cz/zpravy/domaci/feedid-only" }],
  publishedAt: "2026-06-02T06:34:00.000Z",
};
assert(articleMatchesP0Source(ct24FeedIdArticle, ct24Def), "CT24 root feedId match");

// 3. iDNES without CT24 metadata — negative
const idnesOnlyArticle = {
  url: "https://www.idnes.cz/zpravy/domaci/no-ct24",
  feedId: "zpr_idnes_zpravy",
  sourceLabel: "iDNES.cz",
  sources: [{ name: "iDNES.cz", url: "https://www.idnes.cz/zpravy/domaci/no-ct24" }],
  publishedAt: "2026-06-02T06:34:00.000Z",
};
assert(!articleMatchesP0Source(idnesOnlyArticle, ct24Def), "iDNES without CT24 metadata negative");

// 4. Existing P0 host matching regression
assert(
  articleMatchesP0Source(
    { url: "https://www.novinky.cz/clanek/123", sources: [{ name: "Novinky.cz" }] },
    novinkyDef,
  ),
  "Novinky host match",
);
assert(
  articleMatchesP0Source(
    { url: "https://www.seznamzpravy.cz/clanek/123", sources: [{ name: "Seznam Zprávy" }] },
    seznamDef,
  ),
  "Seznam host match",
);
assert(
  articleMatchesP0Source(
    { url: "https://www.idnes.cz/zpravy/domaci/x", sources: [{ name: "iDNES.cz" }] },
    idnesDef,
  ),
  "iDNES host match",
);
assert(
  articleMatchesP0Source(
    { url: "https://www.sport.cz/clanek/123", sources: [{ name: "Sport.cz" }] },
    sportDef,
  ),
  "Sport.cz host match",
);

// 5. newestProductionForP0 picks contributor-backed CT24 freshness
const oldCt24 = {
  url: "https://ct24.ceskatelevize.cz/clanek/domaci/old-373000",
  sources: [{ name: "ČT24", url: "https://ct24.ceskatelevize.cz/clanek/domaci/old-373000" }],
  publishedAt: "2026-06-02T05:00:00.000Z",
};
const newerMerged = { ...ct24ContributorArticle };
const best = newestProductionForP0([oldCt24, newerMerged, idnesOnlyArticle], ct24Def);
assert(best && best.ts === Date.parse("2026-06-02T06:34:00.000Z"), "newestProductionForP0 CT24 contributor");

console.log("PASS content-freshness-guard-unit");
