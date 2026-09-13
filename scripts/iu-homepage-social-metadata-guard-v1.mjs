/**
 * IU_HOMEPAGE_SOCIAL_METADATA_GUARD — P1-A OG/Twitter/JSON-LD contract.
 * Locks truthful homepage social + structured metadata without title/H1/body changes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

const EXPECTED_DESCRIPTION =
  "infoUzel.cz — přehled zpráv, počasí, kalendáře a nástrojů na jednom místě. Rychlé odkazy, zprávy, počasí a nástroje na jednom místě.";
const EXPECTED_OG_IMAGE =
  "https://infouzel.cz/assets/images/infouzel-prehled-dne-banner.webp";
const EXPECTED_TITLE = "infoUzel.cz";
const EXPECTED_CANONICAL = "https://infouzel.cz/";
const ALLOWED_LD_TYPES = new Set(["WebSite", "Organization"]);

const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const headers = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");

function countMeta(attr, name) {
  const re = new RegExp(
    `<meta\\b[^>]*\\b${attr}=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "gi"
  );
  return (index.match(re) || []).length;
}

function metaContent(attr, name) {
  const re = new RegExp(
    `<meta\\b[^>]*\\b${attr}=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i"
  );
  const m = index.match(re);
  if (!m) return null;
  const cm = m[0].match(/\bcontent=["']([^"']*)["']/i);
  return cm ? cm[1] : null;
}

must((index.match(/<title>\s*infoUzel\.cz\s*<\/title>/i) || []).length === 1, "title_exactly_infouzel");
must(!/InfoUzel\.cz\s*[–-]\s*internet v internetu/i.test(index), "no_p1b_title_candidate");

const descMatches = [
  ...index.matchAll(/<meta\b[^>]*\bname=["']description["'][^>]*>/gi),
];
must(descMatches.length === 1, "meta_description_count_1");
must(metaContent("name", "description") === EXPECTED_DESCRIPTION, "meta_description_unchanged");

const canon = [...index.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi)];
must(canon.length === 1, "canonical_count_1");
must(/href=["']https:\/\/infouzel\.cz\/["']/.test(canon[0][0]), "canonical_url");

must(metaContent("name", "robots") === "index,follow", "robots_unchanged");

must(countMeta("property", "og:type") === 1, "og_type_count");
must(countMeta("property", "og:site_name") === 1, "og_site_name_count");
must(countMeta("property", "og:title") === 1, "og_title_count");
must(countMeta("property", "og:description") === 1, "og_description_count");
must(countMeta("property", "og:url") === 1, "og_url_count");
must(countMeta("property", "og:image") === 1, "og_image_count");

must(metaContent("property", "og:type") === "website", "og_type_value");
must(metaContent("property", "og:site_name") === "InfoUzel.cz", "og_site_name_value");
must(metaContent("property", "og:title") === EXPECTED_TITLE, "og_title_value");
must(metaContent("property", "og:description") === EXPECTED_DESCRIPTION, "og_description_value");
must(metaContent("property", "og:url") === EXPECTED_CANONICAL, "og_url_value");
must(metaContent("property", "og:image") === EXPECTED_OG_IMAGE, "og_image_value");
must(metaContent("property", "og:image:type") === "image/webp", "og_image_type");
must(metaContent("property", "og:image:width") === "1661", "og_image_width");
must(metaContent("property", "og:image:height") === "616", "og_image_height");

must(countMeta("name", "twitter:card") === 1, "twitter_card_count");
must(countMeta("name", "twitter:title") === 1, "twitter_title_count");
must(countMeta("name", "twitter:description") === 1, "twitter_description_count");
must(countMeta("name", "twitter:image") === 1, "twitter_image_count");
must(metaContent("name", "twitter:card") === "summary_large_image", "twitter_card_value");
must(metaContent("name", "twitter:title") === EXPECTED_TITLE, "twitter_title_value");
must(metaContent("name", "twitter:description") === EXPECTED_DESCRIPTION, "twitter_description_value");
must(metaContent("name", "twitter:image") === EXPECTED_OG_IMAGE, "twitter_image_value");
must(!/name=["']twitter:site["']/.test(index), "no_twitter_site_unverified");

const ldBlocks = [...index.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
must(ldBlocks.length === 1, "jsonld_count_1");

let parsed = null;
try {
  parsed = JSON.parse(ldBlocks[0][1]);
} catch (_) {
  parsed = null;
}
must(!!parsed, "jsonld_parse");
must(parsed && parsed["@context"] === "https://schema.org", "jsonld_context");
must(parsed && Array.isArray(parsed["@graph"]), "jsonld_graph");

const types = (parsed && parsed["@graph"] ? parsed["@graph"] : []).map((n) => n && n["@type"]);
must(types.length === 2, "jsonld_graph_len_2");
must(types.includes("WebSite") && types.includes("Organization"), "jsonld_types_website_org");
must(types.every((t) => ALLOWED_LD_TYPES.has(t)), "jsonld_no_extra_types");
must(
  !JSON.stringify(parsed).match(/AggregateRating|Review|Offer|Product|SearchAction|WebApplication/i),
  "jsonld_no_spam_types"
);

const website = parsed["@graph"].find((n) => n["@type"] === "WebSite");
const org = parsed["@graph"].find((n) => n["@type"] === "Organization");
must(website && website.name === "InfoUzel.cz" && website.url === EXPECTED_CANONICAL, "jsonld_website_truth");
must(
  org &&
    org.name === "Media Uzel s.r.o." &&
    org.url === EXPECTED_CANONICAL &&
    org.email === "info@infouzel.cz",
  "jsonld_org_truth"
);

const ldHash =
  "'sha256-" + crypto.createHash("sha256").update(ldBlocks[0][1], "utf8").digest("base64") + "'";
const scriptSrcMeta = (index.match(/script-src\s+([^;]+)/i) || [])[1] || "";
const scriptSrcHeader = (headers.match(/script-src\s+([^;]+)/i) || [])[1] || "";
must(scriptSrcMeta.includes(ldHash), "csp_meta_has_jsonld_hash");
must(scriptSrcHeader.includes(ldHash), "csp_headers_has_jsonld_hash");
must(!/'unsafe-inline'/.test(scriptSrcMeta) && !/'unsafe-inline'/.test(scriptSrcHeader), "csp_no_unsafe_inline");

must(
  /iuPd__bannerImg[^>]*src="\/assets\/images\/infouzel-prehled-dne-banner\.webp"/.test(index),
  "critical_banner_src_untouched"
);
must(/iuPd__bannerImg[^>]*fetchpriority="high"/.test(index), "critical_banner_fp_untouched");
must(/iuPd__bannerImg[^>]*loading="eager"/.test(index), "critical_banner_eager_untouched");

must(fs.existsSync(path.join(ROOT, "assets", "images", "infouzel-prehled-dne-banner.webp")), "og_image_asset_exists");

if (fails.length) {
  console.error("[iu-homepage-social-metadata-guard] FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("[iu-homepage-social-metadata-guard] PASS");
