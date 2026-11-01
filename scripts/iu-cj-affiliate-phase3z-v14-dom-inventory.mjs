#!/usr/bin/env node
/**
 * Phase 3Z V14 — full DOM inventory + preview HTML for all static main buttons.
 * Preview-only; never arms PUBLIC_SWAP / liveEnabled.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl, assertAllowedDataWrite } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

export const PHASE3Z_V14_DOM_SCHEMA = "iu-affiliate-cj-dom-inventory-v14";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function longTitleAttr(title) {
  const n = String(title || "").length;
  if (n > 36) return "2";
  if (n > 24) return "1";
  return "0";
}

/** Section accent colors — mirror production affiliate accents (not Radio palette). */
const SECTION_COLORS = {
  "aff-auto-moto": "#455a64",
  "aff-boty": "#6d4c41",
  "aff-cestovni-kancelare": "#0277bd",
  "aff-cestovni-pojisteni": "#00838f",
  "aff-deti-hracky": "#f9a825",
  "aff-dilna-naradi": "#5d4037",
  "aff-drogerie": "#7b1fa2",
  "aff-dum-zahrada": "#2e7d32",
  "aff-elektro": "#546e7a",
  "aff-inzerce-bazary": "#ef6c00",
  "aff-jidlo": "#c62828",
  "aff-kancelarske-potreby": "#3949ab",
  "aff-knihy": "#5e35b1",
  "aff-kosmetika": "#8e24aa",
  "aff-kuchyn": "#00897b",
  "aff-kvetiny-darky": "#d81b60",
  "aff-lekarny": "#00695c",
  "aff-letenky": "#1565c0",
  "aff-letenky-letecka-doprava": "#1e88e5",
  "aff-mobily": "#37474f",
  "aff-moda": "#c2185b",
  "aff-nabytek": "#6d4c41",
  "aff-pneu-pneuservis": "#424242",
  "aff-pojisteni": "#0277bd",
  "aff-software": "#283593",
  "aff-sperky-hodinky": "#ad1457",
  "aff-sport-outdoor": "#2e7d32",
  "aff-tv-streamovani": "#4527a0",
  "aff-ubytovani-hotely": "#00695c",
  "aff-zdravi-doplnky": "#00897b",
  "aff-zvirata": "#558b2f",
};

function loadChipCss() {
  const p = path.join(ROOT, "assets", "iu-affiliate-phase3z-partner-chips-v1.css");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

export function buildDomInventory(staticCatalog) {
  const buttons = staticCatalog?.buttons || [];
  const sections = staticCatalog?.sections || [];
  const failures = [];
  const dom = [];
  const seenAdv = new Set();
  let dup = 0;
  let unauthorized = 0;
  let missingAttrs = 0;

  for (const sec of sections) {
    for (const b of sec.buttons || []) {
      const adv = String(b.advertiserId || "");
      if (!adv) failures.push({ id: "missing_advertiser", title: b.title });
      if (seenAdv.has(adv)) {
        dup += 1;
        failures.push({ id: "duplicate_advertiser", advertiserId: adv });
      } else if (adv) seenAdv.add(adv);
      const url = String(b.url || "");
      if (!isCjTrackingUrl(url)) {
        unauthorized += 1;
        failures.push({ id: "unauthorized_link", advertiserId: adv, url });
      }
      const target = b.target || "_blank";
      const rel = b.rel || "sponsored noopener";
      if (target !== "_blank" || !String(rel).includes("sponsored") || !String(rel).includes("noopener")) {
        missingAttrs += 1;
        failures.push({ id: "bad_link_attrs", advertiserId: adv, target, rel });
      }
      dom.push({
        advertiserId: adv,
        sectionId: sec.sectionId,
        title: b.title,
        url,
        target,
        rel,
        cssClass: "iuRadioChip iuAffiliateChip",
        dataLongTitle: longTitleAttr(b.title),
        color: SECTION_COLORS[sec.sectionId] || "#37474f",
        source: b.source || "cj_first_main_button_v13",
      });
    }
  }

  const gt8 = Object.entries(staticCatalog?.sectionCounts || {}).filter(([, n]) => n > 8);
  return {
    schema: PHASE3Z_V14_DOM_SCHEMA,
    publicButtonSwapArmed: false,
    liveEnabled: false,
    browserCjApiDependency: false,
    counts: {
      buttons: dom.length,
      sections: sections.length,
      duplicates: dup,
      unauthorized,
      missingAttrs,
      expected: staticCatalog?.counts?.buttons ?? null,
    },
    sectionCounts: staticCatalog?.sectionCounts || {},
    gt8Sections: gt8,
    longNames: dom.filter((d) => String(d.title).length > 28),
    buttons: dom,
    ok:
      failures.length === 0 &&
      dom.length === (staticCatalog?.counts?.buttons || 0) &&
      dup === 0 &&
      unauthorized === 0,
    failures,
  };
}

export function buildPreviewHtml(staticCatalog, inventory) {
  const chipCss = loadChipCss();
  let colorCss = "";
  for (const [id, color] of Object.entries(SECTION_COLORS)) {
    colorCss += `.iuAffiliatePhase3zPreview[data-section="${id}"] .iuAffiliateChip{background:${color};color:#fff;}\n`;
  }
  let body = "";
  body += `<header class="meta"><h1>V14 CJ static catalog DOM preview</h1>`;
  body += `<p>PUBLIC_SWAP=DISARMED · liveEnabled=false · browserCjApiDependency=false · buttons=${inventory.counts.buttons} · sections=${inventory.counts.sections} · duplicates=${inventory.counts.duplicates}</p></header>`;
  for (const sec of staticCatalog.sections || []) {
    const color = SECTION_COLORS[sec.sectionId] || "#37474f";
    body += `<section class="iuAffiliateSection iuAffiliatePhase3zPreview" data-iu-phase3z-chips="1" data-section="${esc(sec.sectionId)}" style="--aff-accent:${color}">`;
    body += `<h2>${esc(sec.sectionId)} (${sec.buttonCount})</h2>`;
    body += `<div class="iuAffiliateGrid" role="list">`;
    for (const b of sec.buttons || []) {
      const lt = longTitleAttr(b.title);
      body += `<a class="iuRadioChip iuAffiliateChip" role="listitem" href="${esc(b.url)}" target="_blank" rel="sponsored noopener" data-aff-ready="1" data-advertiser-id="${esc(b.advertiserId)}" data-long-title="${lt}" style="background:${color};color:#fff"><span class="iuRadioChipTitle">${esc(b.title)}</span></a>`;
    }
    body += `</div></section>`;
  }
  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V14 CJ DOM preview (DISARMED)</title><style>
body{margin:0;padding:16px;background:#0f1419;color:#e8eef5;font-family:Segoe UI,sans-serif}
.meta{margin-bottom:20px;font-size:13px;opacity:.9}
h1{font-size:20px;margin:0 0 8px}h2{font-size:15px;margin:28px 0 10px;border-bottom:1px solid #334;padding-bottom:4px}
.iuAffiliateChip{text-decoration:none;display:flex}
${chipCss}
${colorCss}
</style></head><body data-iu-public-swap="DISARMED">${body}</body></html>`;
}

export async function captureScreenshots(htmlPath, outDir) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { ok: false, reason: "playwright_unavailable", shots: [] };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");
  const viewports = [
    { name: "pc-edge", width: 1366, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const browser = await chromium.launch({ headless: true });
  const shots = [];
  try {
    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(fileUrl, { waitUntil: "load" });
      const count = await page.locator("a.iuAffiliateChip").count();
      const sample = await page.locator("a.iuAffiliateChip").first().boundingBox();
      const attrs = await page.locator("a.iuAffiliateChip").first().evaluate((el) => ({
        target: el.getAttribute("target"),
        rel: el.getAttribute("rel"),
      }));
      const shot = path.join(outDir, `preview-${vp.name}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      // Per-section crops for sections with >8 buttons + moda
      const focus = ["aff-moda", "aff-dum-zahrada", "aff-kosmetika", "aff-sport-outdoor"];
      for (const sid of focus) {
        const loc = page.locator(`section[data-section="${sid}"]`);
        if ((await loc.count()) === 0) continue;
        const secShot = path.join(outDir, `section-${sid}-${vp.name}.png`);
        await loc.screenshot({ path: secShot });
        shots.push({ viewport: vp.name, sectionId: sid, path: secShot });
      }
      shots.push({
        viewport: vp.name,
        path: shot,
        chipCount: count,
        sampleBox: sample,
        attrs,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return { ok: true, shots };
}

async function main() {
  const argv = process.argv.slice(2);
  const staticCatalog = readJson(
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json")
  );
  const inventory = buildDomInventory(staticCatalog);
  const html = buildPreviewHtml(staticCatalog, inventory);
  const outDir = path.join(ROOT, "projects", "data");
  const htmlPath = path.join(outDir, "iu-affiliate-cj-dom-preview-v14.html");
  const invPath = path.join(outDir, "iu-affiliate-cj-dom-inventory-v14.json");
  const writeRepo = argv.includes("--write-repo") || process.env.IU_CJ_PHASE3Z_WRITE_REPO === "1";
  const shotDir = path.join(process.env.TEMP || "/tmp", "iu-v14-dom-shots");
  let shotMeta = { ok: false, reason: "skipped" };
  if (argv.includes("--screenshots") || process.env.IU_CJ_V14_SCREENSHOTS === "1") {
    // Write HTML to TEMP first for screenshots even if not writing repo
    const tmpHtml = path.join(process.env.TEMP || "/tmp", "iu-v14-preview.html");
    fs.writeFileSync(tmpHtml, html, "utf8");
    shotMeta = await captureScreenshots(tmpHtml, shotDir);
  }
  const contentSha = crypto.createHash("sha256").update(JSON.stringify(inventory.buttons)).digest("hex");
  const report = {
    ...inventory,
    contentSha256: contentSha,
    previewHtmlBytes: Buffer.byteLength(html, "utf8"),
    screenshots: shotMeta,
  };
  if (writeRepo) {
    assertAllowedDataWrite(invPath);
    writeJson(invPath, report);
    // HTML preview is audit/local; keep JSON as allowlisted artifact only unless gate extended
  }
  // Always emit HTML to TEMP for audit packing
  fs.writeFileSync(path.join(process.env.TEMP || "/tmp", "iu-v14-preview.html"), html, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        counts: report.counts,
        gt8: report.gt8Sections.length,
        longNames: report.longNames.length,
        screenshots: shotMeta.ok,
        shotCount: (shotMeta.shots || []).length,
        wrote: writeRepo,
        contentSha256: contentSha,
      },
      null,
      2
    )
  );
  if (!report.ok) process.exitCode = 2;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
