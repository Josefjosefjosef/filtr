#!/usr/bin/env node
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_LEGAL_PREVIEW_PROOF_PORT || 8117);

function serveFile(urlPath) {
  let filePath = path.join(ROOT, (urlPath || "/").replace(/^\//, "").split("?")[0] || "index.html");
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT))) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath.split("?")[0] || "");
        const ct = ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const { chromium } = await import("playwright");
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}:${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror:${e.message}`));

  await page.goto(`http://127.0.0.1:${PORT}/projects/index.html?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(4000);

  const myinfouzel = process.env.IU_LEGAL_PREVIEW_MYINFOUZEL === "1";

  await page.evaluate((withMy) => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      localStorage.setItem("iu:legal-confirm:contracts:v1", "accepted");
      if (withMy) document.body.classList.add("iu-myinfouzel-open");
    } catch (_) {}
  }, myinfouzel);

  const openRes = await page.evaluate(async () => {
    const boot = typeof window.iuEnsureLegalDocsOverlayBoot === "function" ? window.iuEnsureLegalDocsOverlayBoot() : Promise.resolve();
    await boot;
    await new Promise((r) => setTimeout(r, 300));
    if (typeof window.iuLegalDocsOpenSurface !== "function") return { err: "no open fn" };
    window.iuLegalDocsOpenSurface();
    await new Promise((r) => setTimeout(r, 500));
    const cat = document.querySelector('[data-iu-legal-cat="smlouvy"]');
    if (!cat) return { err: "no cat", cats: document.querySelectorAll("[data-iu-legal-cat]").length };
    cat.click();
    await new Promise((r) => setTimeout(r, 500));
    const docBtn = document.querySelector("[data-iu-legal-open-doc]");
    if (!docBtn) return { err: "no doc btn" };
    docBtn.click();
    await new Promise((r) => setTimeout(r, 700));
    const previewBtn = document.querySelector("[data-iu-legal-preview-open]");
    if (!previewBtn) return { err: "no preview btn" };
    previewBtn.click();
    await new Promise((r) => setTimeout(r, 1000));
    const layer = document.getElementById("iuLegalDocsPreviewPortal");
    const host = layer?.querySelector("[data-iu-legal-preview-host]");
    const paper = host?.querySelector(".iu-legal-doc-paper");
    let cs = null;
    if (layer) {
      const s = window.getComputedStyle(layer);
      cs = { display: s.display, visibility: s.visibility, opacity: s.opacity, zIndex: s.zIndex };
    }
    const panel = document.getElementById("iuLegalDocsPanel");
    let panelCs = null;
    if (panel) {
      const s = window.getComputedStyle(panel);
      panelCs = { display: s.display, visibility: s.visibility, zIndex: s.zIndex };
    }
    const backdrop = document.getElementById("iuLegalDocsBackdrop");
    let bdCs = null;
    if (backdrop) {
      const s = window.getComputedStyle(backdrop);
      bdCs = { display: s.display, zIndex: s.zIndex };
    }
    const rect = layer ? layer.getBoundingClientRect() : null;
    return {
      bodyClass: document.body.className,
      layerHidden: layer?.hidden,
      layerOpen: layer?.classList.contains("iu-legal-preview-portal--open"),
      hostLen: host ? host.innerHTML.length : 0,
      paper: !!paper,
      cs,
      panelCs,
      bdCs,
      rect: rect ? { w: rect.width, h: rect.height, top: rect.top } : null,
    };
  });

  const pass =
    openRes.paper &&
    openRes.layerOpen &&
    !openRes.layerHidden &&
    openRes.hostLen > 100 &&
    openRes.cs &&
    openRes.cs.display !== "none" &&
    openRes.cs.visibility !== "hidden" &&
    Number(openRes.cs.zIndex) >= Number(openRes.panelCs?.zIndex || 0);

  await browser.close();
  server.close();
  console.log(JSON.stringify({ pass, openRes, logs: logs.slice(0, 15) }, null, 2));
  if (!pass) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
