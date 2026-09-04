#!/usr/bin/env node
/**
 * Guard: iCentrum GDPR/VOP/Ads legal layer + public /gdpr-a-vop/ + version consistency.
 * Run: npm run iu-gdpr-vop-legal-layer-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function fail(m) {
  fails.push(m);
  console.error("FAIL " + m);
}
function ok(m) {
  console.log("PASS " + m);
}
function read(p) {
  return fs.readFileSync(p, "utf8");
}

const INDEX = path.join(REPO, "projects", "index.html");
const IC = path.join(REPO, "assets", "iu-info-center.js");
const BODY = path.join(REPO, "assets", "iu-gdpr-vop-legal-body-v1.js");
const PUBLIC = path.join(REPO, "projects", "gdpr-a-vop", "index.html");
const VER = path.join(REPO, "projects", "data", "legal", "legal-docs-version.json");
const CSP = path.join(REPO, "cloudflare", "iu-site-redirects", "src", "csp-promote.ts");
const PUBLISH = path.join(REPO, "scripts", "iu-pages-root-publish.mjs");
const STAGE = path.join(REPO, "scripts", "iu-pages-stage-artifact-v1.mjs");
const SITEMAP = path.join(REPO, "sitemap.xml");

const html = read(INDEX);
const ic = read(IC);
const body = read(BODY);
const pub = read(PUBLIC);
const csp = read(CSP);
const publish = read(PUBLISH);
const stage = read(STAGE);
const sitemap = read(SITEMAP);

let ver;
try {
  ver = JSON.parse(read(VER));
} catch (e) {
  fail("version_json_parse:" + (e && e.message ? e.message : e));
  ver = {};
}

const VERSION = "2026-09-05-v1";
if (ver.versionId !== VERSION) fail("version_json_versionId");
else ok("version_json_versionId");
if (ver.effectiveDate !== "2026-09-05") fail("version_json_effectiveDate");
else ok("version_json_effectiveDate");
if (ver.publicPath !== "/gdpr-a-vop/") fail("version_json_publicPath");
else ok("version_json_publicPath");
if (ver.documentId !== "gdpr-vop-ads") fail("version_json_documentId");
else ok("version_json_documentId");

if (!html.includes('data-iu-info-section="gdpr-vop"')) fail("index_tile_section");
else ok("index_tile_section");
if (!html.includes("GDPR a Všeobecné obchodní podmínky")) fail("index_tile_label");
else ok("index_tile_label");
if (
  !html.includes(
    "Informace o zpracování osobních údajů a podmínkách používání služeb InfoUzel.cz."
  )
) {
  fail("index_tile_hint");
} else ok("index_tile_hint");
if (!html.includes("📜")) fail("index_tile_icon");
else ok("index_tile_icon");
if (!html.includes('id="iuInfoCenterDetailGdprVop"')) fail("index_detail_shell");
else ok("index_detail_shell");
if (!html.includes("iu-gdpr-vop-legal-body-v1.js")) fail("index_script_body");
else ok("index_script_body");

// Menu order: stats → gdpr-vop → contact (Ads tile injected before gdpr-vop at runtime)
const statsIdx = html.indexOf('data-iu-info-section="stats"');
const gdprIdx = html.indexOf('data-iu-info-section="gdpr-vop"');
const contactIdx = html.indexOf('data-iu-info-section="contact"');
if (statsIdx < 0 || gdprIdx < 0 || contactIdx < 0 || !(statsIdx < gdprIdx && gdprIdx < contactIdx)) {
  fail("index_tile_order_stats_gdpr_contact");
} else ok("index_tile_order_stats_gdpr_contact");

if (!ic.includes('"gdpr-vop": "GDPR a Všeobecné obchodní podmínky"')) fail("ic_section_title");
else ok("ic_section_title");
if (!ic.includes("ensureAdsClientTile")) fail("ic_ads_tile_fn");
else ok("ic_ads_tile_fn");
if (!ic.includes('data-iu-info-section="gdpr-vop"')) fail("ic_ads_insert_before_gdpr");
else ok("ic_ads_insert_before_gdpr");
if (!ic.includes("ensureGdprVopMounted")) fail("ic_mount_fn");
else ok("ic_mount_fn");
if (!ic.includes('DOC_VERSION = "2.0"')) fail("ic_doc_version_20");
else ok("ic_doc_version_20");

if (!body.includes("iuGdprVopLegal")) fail("body_export");
else ok("body_export");
if (!body.includes('id="iu-legal-gdpr"')) fail("body_gdpr_anchor");
else ok("body_gdpr_anchor");
if (!body.includes('id="iu-legal-vop"')) fail("body_vop_anchor");
else ok("body_vop_anchor");
if (!body.includes('id="iu-legal-ads"')) fail("body_ads_anchor");
else ok("body_ads_anchor");
if (!body.includes("Ochrana osobních údajů – GDPR")) fail("body_gdpr_heading");
else ok("body_gdpr_heading");
if (!body.includes("Všeobecné obchodní podmínky")) fail("body_vop_heading");
else ok("body_vop_heading");
if (!body.includes("Pravidla reklamy a InfoUzel Ads")) fail("body_ads_heading");
else ok("body_ads_heading");
if (!body.includes("Media Uzel s.r.o.")) fail("body_controller_name");
else ok("body_controller_name");
if (!body.includes("29482241")) fail("body_controller_ico");
else ok("body_controller_ico");
if (!body.includes("info@infouzel.cz")) fail("body_controller_email");
else ok("body_controller_email");
if (!body.includes("C 447292")) fail("body_controller_file");
else ok("body_controller_file");
if (!body.includes("Kněžická 96")) fail("body_controller_address");
else ok("body_controller_address");
if (!body.includes(VERSION)) fail("body_version_id");
else ok("body_version_id");
if (!body.includes("www.uoou.cz")) fail("body_uoou");
else ok("body_uoou");
if (!body.includes("www.coi.cz")) fail("body_adr_coi");
else ok("body_adr_coi");
if (!body.includes("Formulář odstoupení")) fail("body_withdrawal_form");
else ok("body_withdrawal_form");
if (!body.includes("data-iu-legal-processing-table")) fail("body_processing_table");
else ok("body_processing_table");
if (!body.includes("data-iu-legal-ads-categories")) fail("body_ads_categories");
else ok("body_ads_categories");
if (!body.includes("data-iu-legal-processors")) fail("body_processors");
else ok("body_processors");
if (!body.includes("Politickou reklamu InfoUzel nepřijímá")) fail("body_political_ban");
else ok("body_political_ban");
if (!body.includes("DSA klasifikace")) fail("body_dsa");
else ok("body_dsa");
if (!body.includes("local-first")) fail("body_local_first");
else ok("body_local_first");
if (!body.includes("/gdpr-a-vop/")) fail("body_public_url");
else ok("body_public_url");

// Controller consistency vs contact card
const contactMatch = html.match(
  /id="iuInfoCenterDetailContact"[\s\S]*?<\/article>/
);
if (!contactMatch) fail("contact_section_missing");
else {
  const c = contactMatch[0];
  for (const token of ["Media Uzel s.r.o.", "29482241", "info@infouzel.cz", "Kněžická 96", "C 447292", "294822412/5500"]) {
    if (!c.includes(token)) fail("contact_missing:" + token);
    if (!body.includes(token)) fail("gdpr_body_missing_vs_contact:" + token);
  }
  if (fails.filter((x) => x.indexOf("contact_missing") === 0 || x.indexOf("gdpr_body_missing") === 0).length === 0) {
    ok("controller_identity_consistent");
  }
}

// Forbidden absolute claims
const blob = body + "\n" + html + "\n" + pub;
const forbidden = [
  /100%\s*GDPR/i,
  /stoprocentně\s+GDPR/i,
  /nikdy\s+nezpracovává\s+žádné\s+osobní/i,
  /Data\s+nikdy\s+neopustí\s+zařízení/i,
  /100%\s+bezpečný/i,
  /nenese\s+žádnou\s+odpovědnost/i,
  /\bTODO\b/,
  /\bXX\b/,
  /doplnit@/i,
  /fake@/i,
];
let absOk = true;
for (const re of forbidden) {
  if (re.test(blob)) {
    fail("forbidden_claim:" + re.toString());
    absOk = false;
  }
}
if (absOk) ok("no_forbidden_absolute_claims");

if (!pub.includes("iu-gdpr-vop-legal-body-v1.js")) fail("public_loads_body");
else ok("public_loads_body");
if (!pub.includes("iuGdprVopLegal")) fail("public_mount_api");
else ok("public_mount_api");
if (!pub.includes('rel="canonical"')) fail("public_canonical");
else ok("public_canonical");

if (!csp.includes('pathname.startsWith("/gdpr-a-vop/")')) fail("csp_html_path");
else ok("csp_html_path");
if (!publish.includes('"gdpr-a-vop"')) fail("root_publish_copy");
else ok("root_publish_copy");
if (!stage.includes('"gdpr-a-vop"')) fail("stage_allow_dir");
else ok("stage_allow_dir");
if (!sitemap.includes("https://infouzel.cz/gdpr-a-vop/")) fail("sitemap_url");
else ok("sitemap_url");

// Reality: analytics privacy claims stay consent-gated / no IP in D1 (spot-check)
const analyticsPrivacy = path.join(REPO, "scripts", "iu-analytics-privacy-guard.mjs");
if (!fs.existsSync(analyticsPrivacy)) fail("analytics_privacy_guard_missing");
else ok("analytics_privacy_guard_present");
if (!body.includes("souhlas") || !/neukládá IP|ne\s+IP|ne\*\* IP|\*\*ne\*\* IP/i.test(body)) {
  fail("body_analytics_ip_consent_truth");
} else ok("body_analytics_ip_consent_truth");

// Ads tracking: document must not invent pixels if inject claims none
if (/third-party pixel/i.test(body) && !/Bez third-party pixel/i.test(body) && !/bez third-party pixel/i.test(body)) {
  fail("body_ads_pixel_claim_ambiguous");
} else ok("body_ads_no_pixel_model");

if (fails.length) {
  console.error("IU_GDPR_VOP_LEGAL_LAYER_GUARD=FAIL count=" + fails.length);
  process.exit(1);
}
console.log("IU_GDPR_VOP_LEGAL_LAYER_GUARD=PASS");
process.exit(0);
