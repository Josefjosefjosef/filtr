#!/usr/bin/env node
/**
 * Behavioral repro: export 114/115 affiliate paradox (route chrome + hidden #iuAffiliateView).
 * Legacy bug: sectionActive widened by mobileMain/toolMain => affInScope true while layoutMounted false.
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8980", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?nosw=1&section=aff-cestovni-kancelare`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
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
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuPwaReturnRecorder.getAffiliateContentMetrics, null, {
      timeout: 90000,
    });
    const out = await page.evaluate(() => {
      document.body.classList.add("iu-mobileMainVisible");
      document.body.setAttribute("data-iu-tool-main", "1");
      var aff = document.getElementById("iuAffiliateView");
      if (aff) aff.hidden = true;
      var hubAff = true;
      var mobileMain = true;
      var toolMain = true;
      function layoutMounted(el) {
        if (!el || el.hidden) return false;
        try {
          var r = el.getBoundingClientRect();
          return r.width >= 8 && r.height >= 8;
        } catch (_) {
          return false;
        }
      }
      var legacySectionActive = hubAff && (layoutMounted(aff) || mobileMain || toolMain);
      var legacyAffInScope = hubAff && legacySectionActive;
      var legacyAffShell = legacyAffInScope && layoutMounted(aff);
      var rect = aff ? aff.getBoundingClientRect() : null;
      var m = window.iuPwaReturnRecorder.getAffiliateContentMetrics();
      var unmet = window.iuPwaReturnRecorder.getAffiliateContentMetrics();
      var sectionUnmet = [];
      try {
        var u = m.probeUnmetReasons || [];
        sectionUnmet = u.slice();
      } catch (_) {}
      return {
        legacy: {
          sectionActive: legacySectionActive,
          affInScope: legacyAffInScope,
          affShell: legacyAffShell,
          affShellMounted: layoutMounted(aff),
        },
        fixed: m,
        geom: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
        htmlHidden: aff ? !!aff.hidden : null,
        sectionUnmet: sectionUnmet,
      };
    });
    must(out.legacy.affInScope === true, "legacy:aff_in_scope_true");
    must(out.legacy.affShell === false, "legacy:aff_shell_false");
    must(out.legacy.affShellMounted === false, "legacy:shell_mounted_false");
    must(out.htmlHidden === true, "legacy:html_hidden_attr");
    /* Physical export 114/115: getBoundingClientRect can stay non-zero while html hidden; headless often 0×0. */
    must(out.fixed.contentReadinessScope === true, "fixed:readiness_scope");
    must(out.fixed.affInScope === false, "fixed:aff_in_scope_false");
    must(out.fixed.affLayoutMounted === false, "fixed:layout_mounted_false");
    must(out.fixed.probeUnmetReasons && out.fixed.probeUnmetReasons.length > 0, "fixed:unmet_nonempty");
    must(out.fixed.probeUnmetReasons.indexOf("aff_route_chrome_without_shell") >= 0, "fixed:route_chrome_unmet");
    must(out.fixed.probeUnmetReasons.indexOf("aff_shell") >= 0, "fixed:aff_shell_unmet");
    console.log(
      JSON.stringify({
        IU_PWA_AFFILIATE_PARADOX_REPRO: fails.length ? "FAIL" : "PASS",
        legacyExport114115Shape: out.legacy,
        fixedMetrics: {
          contentReadinessScope: out.fixed.contentReadinessScope,
          affInScope: out.fixed.affInScope,
          affLayoutMounted: out.fixed.affLayoutMounted,
          probeUnmetReasons: out.fixed.probeUnmetReasons,
        },
        htmlHidden: out.htmlHidden,
        globalRect: out.geom,
      })
    );
  } finally {
    await browser.close();
    server.close();
  }
  if (fails.length) {
    console.log(fails.join(","));
    process.exit(1);
  }
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
