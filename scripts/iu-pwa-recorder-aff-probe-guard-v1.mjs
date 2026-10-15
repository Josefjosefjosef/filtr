#!/usr/bin/env node
/**
 * Affiliate section probe: aff-cestovni-kancelare — scoped metrics vs global geometry.
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8973", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?nosw=1&section=aff-cestovni-kancelare`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const rec = read("assets/iu-pwa-return-recorder-v1.js");
  must(/affiliateSectionProbeState/.test(rec), "static:affiliate_probe_state");
  must(/globalAffView/.test(rec), "static:scoped_geometry");
  must(/aff_section_inactive/.test(rec), "static:inactive_reason");
  must(/getAffiliateSectionProbeState/.test(rec), "static:probe_api");
  must(/getAffiliateContentMetrics/.test(rec), "static:metrics_api");
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (urlPath.endsWith("/")) urlPath += "index.html";
        const filePath = path.join(REPO, urlPath.replace(/^\/+/, ""));
        if (!filePath.startsWith(REPO) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404);
          res.end("nf");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === ".html"
            ? "text/html; charset=utf-8"
            : ext === ".js"
              ? "text/javascript; charset=utf-8"
              : "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(fs.readFileSync(filePath));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  staticGate();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuPwaReturnRecorder.getAffiliateContentMetrics, null, {
      timeout: 90000,
    });
    const paradox = await page.evaluate(() => {
      document.body.classList.add("iu-mobileMainVisible");
      document.body.setAttribute("data-iu-tool-main", "1");
      var aff = document.getElementById("iuAffiliateView");
      if (aff) aff.hidden = true;
      var m = window.iuPwaReturnRecorder.getAffiliateContentMetrics();
      var geom = window.iuPwaReturnRecorder.getLayoutGeometrySnapshot();
      return { m: m, geom: geom, hub: new URL(location.href).searchParams.get("section") };
    });
    must(paradox.hub === "aff-cestovni-kancelare", "ui:hub");
    must(paradox.m && paradox.m.contentReadinessScope === true, "ui:content_readiness_scope");
    must(paradox.m && paradox.m.affiliateProbe && paradox.m.affiliateProbe.routeChromeActive === true, "ui:route_chrome");
    must(paradox.m && paradox.m.affiliateProbe.sectionActive === false, "ui:section_not_active_hidden_shell");
    must(paradox.m && paradox.m.affInScope === false, "ui:aff_in_scope_scoped_false");
    must(paradox.m && paradox.m.affLayoutMounted === false, "ui:aff_layout_mounted_false");
    must(paradox.m && Array.isArray(paradox.m.probeUnmetReasons) && paradox.m.probeUnmetReasons.length > 0, "ui:unmet_not_empty");
    must(
      paradox.m.probeUnmetReasons.indexOf("aff_route_chrome_without_shell") >= 0,
      "ui:route_chrome_unmet_reason"
    );
    must(paradox.m.probeUnmetReasons.indexOf("aff_shell") >= 0, "ui:aff_shell_unmet");
    must(paradox.m && paradox.m.affDomProbe && paradox.m.affDomProbe.htmlHidden === true, "ui:html_hidden_separate");

    const physicalHiddenBox = await page.evaluate(() => {
      var aff = document.getElementById("iuAffiliateView");
      if (aff) {
        aff.hidden = true;
        aff.style.width = "402px";
        aff.style.minHeight = "1290px";
        aff.style.display = "block";
      }
      var r = aff ? aff.getBoundingClientRect() : null;
      var m = window.iuPwaReturnRecorder.getAffiliateContentMetrics();
      return { w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0, m: m };
    });
    must(physicalHiddenBox.w >= 8 && physicalHiddenBox.h >= 8, "ui:physical_nonzero_box");
    must(physicalHiddenBox.m && physicalHiddenBox.m.affInScope === false, "ui:physical_hidden_aff_out_of_scope");
    must(physicalHiddenBox.m && physicalHiddenBox.m.affLayoutMounted === false, "ui:physical_hidden_not_layout_mounted");
    must(
      physicalHiddenBox.m &&
        physicalHiddenBox.m.probeUnmetReasons &&
        physicalHiddenBox.m.probeUnmetReasons.indexOf("aff_shell") >= 0,
      "ui:physical_hidden_shell_unmet"
    );

    const mounted = await page.evaluate(() => {
      var aff = document.getElementById("iuAffiliateView");
      if (aff) {
        aff.hidden = false;
        aff.style.minHeight = "480px";
        aff.style.display = "block";
      }
      var m = window.iuPwaReturnRecorder.getAffiliateContentMetrics();
      return m;
    });
    must(mounted && mounted.affiliateProbe && mounted.affiliateProbe.sectionActive === true, "ui:mounted_section");
    must(mounted && mounted.affInScope === true, "ui:aff_in_scope_when_unhidden");
    must(mounted && mounted.affShell === true, "ui:aff_shell_when_unhidden");
  } finally {
    await browser.close();
    server.close();
  }
  if (fails.length) {
    console.log("IU_PWA_RECORDER_AFF_PROBE_GUARD=FAIL");
    console.log(fails.join(","));
    process.exit(1);
  }
  console.log("IU_PWA_RECORDER_AFF_PROBE_GUARD=PASS");
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
