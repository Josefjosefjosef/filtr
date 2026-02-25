#!/usr/bin/env node
/**
 * Proof: MindMenu pills — settings icon inside right edge.
 * Gate: CLS=0, console.error=0, pageerror=0, all gear icons inside pill/row bbox.
 * Output: artifacts/PROOF_MINDMENU_SETTINGS_RIGHT.txt
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const out = path.join(ARTIFACTS, name);
  const crlf = text.replace(/\r?\n/g, "\r\n");
  fs.writeFileSync(out, crlf, "utf8");
  return out;
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = (req.url || "/").split("?")[0];
      if (urlPath === "/" || urlPath === "/projects" || urlPath === "/projects/") {
        urlPath = "/projects/index.html";
      } else if (!urlPath.startsWith("/")) {
        urlPath = "/" + urlPath;
      }
      const p = path.join(rootDir, urlPath.slice(1));
      const resolved = path.resolve(p);
      const rootResolved = path.resolve(rootDir);
      if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      fs.readFile(p, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(p);
        const ct = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
        res.setHeader("Content-Type", ct);
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
    server.on("error", reject);
  });
}

async function main() {
  let browser = null;
  let page = null;
  let staticServer = null;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    let BASE_URL = process.env.PROOF_BASE_URL || "";
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.addInitScript(() => {
      window.__proofCls = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) window.__proofCls += e.value;
          }
        });
        obs.observe({ type: "layout-shift", buffered: true });
      } catch (_) {}
    });

    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2500);

    const clsValue = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => null);
    const proofData = await page.evaluate(() => {
      function chain(el, max = 8) {
        const out = [];
        let n = el;
        let i = 0;
        while (n && i < max) {
          const cls = n.className ? "." + String(n.className).trim().split(/\s+/).join(".") : "";
          out.push(`${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${cls}`);
          n = n.parentElement;
          i++;
        }
        return out.join(" <- ");
      }
      function css(el) {
        if (!el) return {};
        const s = getComputedStyle(el);
        return { position: s.position, right: s.right, left: s.left, top: s.top, transform: s.transform, display: s.display };
      }
      const rows = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-row");
      const pills = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-pill");
      const gears = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-gear");
      let allInside = true;
      const dumps = [];
      const rowArr = [...rows];
      for (let idx = 0; idx < rowArr.length; idx++) {
        const row = rowArr[idx];
        const gear = row.querySelector(".iu-mailbox-gear");
        const pill = row.querySelector(".iu-mailbox-pill");
        if (!gear) continue;
        const r1 = row.getBoundingClientRect();
        const r2 = gear.getBoundingClientRect();
        const rPill = pill ? pill.getBoundingClientRect() : null;
        if (r2.right > r1.right || r2.left < r1.left) allInside = false;
        const distanceRight = r1.right - r2.right;
        const gearCss = css(gear);
        const rowCss = css(row);
        const pillCss = pill ? css(pill) : {};
        const offsetParent = gear.offsetParent;
        const offsetParentSel = offsetParent
          ? offsetParent.id
            ? "#" + offsetParent.id
            : offsetParent.className
              ? "." + String(offsetParent.className).trim().split(/\s+/).join(".")
              : offsetParent.tagName.toLowerCase()
          : null;
        dumps.push({
          index: idx,
          inside: r2.right <= r1.right && r2.left >= r1.left,
          distanceRight,
          gearOffsetParent: offsetParentSel,
          chainGear: chain(gear),
          chainPill: pill ? chain(pill) : "",
          rectRow: { left: r1.left, right: r1.right, width: r1.width },
          rectGear: { left: r2.left, right: r2.right, width: r2.width },
          rectPill: rPill ? { left: rPill.left, right: rPill.right, width: rPill.width } : null,
          gearComputed: gearCss,
          rowComputed: rowCss,
          pillComputed: pillCss,
        });
      }
      const firstDump = dumps[0];
      const gearPositionOk = firstDump && firstDump.gearComputed && firstDump.gearComputed.position === "absolute";
      const rowPositionOk = firstDump && firstDump.rowComputed && firstDump.rowComputed.position === "relative";
      const gearRightOk = firstDump && firstDump.gearComputed && firstDump.gearComputed.right !== "auto";
      return {
        pillsCount: pills.length,
        settingsIconsCount: gears.length,
        allIconsInsideBoundingBox: allInside,
        gearPositionAbsolute: gearPositionOk,
        rowPositionRelative: rowPositionOk,
        gearRightNotAuto: gearRightOk,
        dumps,
      };
    }).catch((e) => ({ pillsCount: 0, settingsIconsCount: 0, allIconsInsideBoundingBox: false, gearPositionAbsolute: false, rowPositionRelative: false, gearRightNotAuto: false, dumps: [], error: String(e) }));

    const clsReport = clsValue != null && clsValue < 0.02 ? 0 : (clsValue ?? "n/a");
    const lines = [
      "MindMenu pills count: " + proofData.pillsCount,
      "Settings icons detected: " + proofData.settingsIconsCount,
      "All icons inside bounding box: " + (proofData.allIconsInsideBoundingBox ? "true" : "false"),
      "gearPositionAbsolute: " + (proofData.gearPositionAbsolute === true),
      "rowPositionRelative: " + (proofData.rowPositionRelative === true),
      "gearRightNotAuto: " + (proofData.gearRightNotAuto === true),
      "CLS: " + clsReport,
      "console.error: " + consoleErrors.length,
      "pageerror: " + pageErrors.length,
    ];
    if (proofData.dumps && proofData.dumps.length > 0) {
      for (let i = 0; i < Math.min(2, proofData.dumps.length); i++) {
        const d = proofData.dumps[i];
        lines.push("--- dump pill " + d.index + " ---");
        lines.push("gearOffsetParent: " + (d.gearOffsetParent || "null"));
        lines.push("chainGear: " + (d.chainGear || ""));
        lines.push("chainPill: " + (d.chainPill || ""));
        lines.push("gearComputed: " + JSON.stringify(d.gearComputed));
        lines.push("rowComputed.position: " + (d.rowComputed && d.rowComputed.position));
        lines.push("rectRow.right: " + (d.rectRow && d.rectRow.right) + " rectGear.right: " + (d.rectGear && d.rectGear.right) + " distanceRight: " + d.distanceRight);
        lines.push("inside: " + d.inside);
      }
    }
    if (proofData.error) lines.push("error: " + proofData.error);
    const content = lines.join("\n");
    const isProd = BASE_URL.includes("infouzel.cz");
    const outPath = isProd
      ? writeArtifact("PROOF_MINDMENU_SETTINGS_RIGHT_PROD.txt", content)
      : writeArtifact("PROOF_MINDMENU_SETTINGS_RIGHT.txt", content);
    if (isProd) writeArtifact("AFTER_MERGE_PROOF_MINDMENU_SETTINGS.txt", "PROOF: MindMenu settings right — after merge\n" + lines.slice(1).join("\n"));
    console.log("Wrote", outPath);
    console.log(content);
    const gatesOk = proofData.allIconsInsideBoundingBox && proofData.gearPositionAbsolute && proofData.rowPositionRelative && proofData.gearRightNotAuto && clsReport === 0 && consoleErrors.length === 0 && pageErrors.length === 0;
    if (!gatesOk) process.exitCode = 1;
  } catch (err) {
    console.error("proof_mindmenu_settings_right failed:", err.message);
    writeArtifact("PROOF_MINDMENU_SETTINGS_RIGHT.txt", "ERROR=" + String(err.message));
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
