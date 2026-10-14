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
    await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuPwaReturnRecorder.getAffiliateSectionProbeState, null, {
      timeout: 90000,
    });
    const out = await page.evaluate(() => {
      const probe = window.iuPwaReturnRecorder.getAffiliateSectionProbeState();
      const geom = window.iuPwaReturnRecorder.getLayoutGeometrySnapshot();
      return { probe, geom, hub: new URL(location.href).searchParams.get("section") };
    });
    must(out.hub === "aff-cestovni-kancelare", "ui:hub");
    must(out.probe && out.probe.hubAffiliate === true, "ui:hub_aff_flag");
    must(out.probe && out.probe.sectionActive === true, "ui:section_active_when_hub_aff");
    if (out.probe && !out.probe.sectionActive) {
      must(out.geom && out.geom.affView === null, "ui:scoped_aff_null_when_inactive");
      if (out.geom && out.geom.globalAffView && out.geom.globalAffView.w > 0) {
        must(!!out.geom.affiliateProbe.globalRectNote, "ui:global_rect_note");
      }
    }
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
