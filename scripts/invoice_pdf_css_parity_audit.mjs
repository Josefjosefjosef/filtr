#!/usr/bin/env node
/**
 * CSS parity audit: #iuInvoicePanel preview vs .iu-pdf-render-mode export host.
 * node scripts/invoice_pdf_css_parity_audit.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8097);
const LOCAL = `http://127.0.0.1:${PORT}`;

function printBlocks(label, obj) {
  console.log(`=== ${label} ===`);
  Object.keys(obj).forEach((k) => console.log(`${k}=${obj[k]}`));
  console.log(`=== END ${label} ===`);
}

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
      const data = serveFile(req.url?.split("?")[0] || "/");
      if (data) {
        const ext = path.extname((req.url || "").split("?")[0] || "");
        const ct =
          ext === ".css"
            ? "text/css"
            : ext === ".js"
              ? "application/javascript"
              : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const STYLE_KEYS = [
  "background",
  "backgroundImage",
  "backgroundColor",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "border",
  "borderTop",
  "borderCollapse",
  "borderRadius",
  "padding",
  "paddingTop",
  "textAlign",
  "boxShadow",
  "visibility",
  "opacity",
  "display",
  "width",
  "maxWidth",
];

const REGIONS = [
  { key: "HLAVIČKA", sel: ".iu-inv-pr-head" },
  { key: "DODAVATEL_H", sel: ".iu-inv-pr-h" },
  { key: "TABULKA_TH", sel: ".iu-inv-pr-table th" },
  { key: "TABULKA_TD", sel: ".iu-inv-pr-table td" },
  { key: "META_TH", sel: ".iu-inv-pr-meta th" },
  { key: "SOUHRN_DUE", sel: ".iu-inv-pr-due" },
  { key: "PATIČKA", sel: ".iu-inv-pr-foot" },
];

function pickStyles(cs) {
  const o = {};
  STYLE_KEYS.forEach((k) => {
    const prop = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    try {
      o[k] = cs.getPropertyValue(prop) || cs[k] || "";
    } catch (_) {
      o[k] = "";
    }
  });
  return o;
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const engineHref = pathToFileURL(path.join(ROOT, "assets", "iu-invoice-engine.js")).href;
  const { buildInvoicePaperHtml, computeTotals } = await import(engineHref);
  const st = {
    supplierVatPayer: true,
    supplierKind: "fo",
    buyerKind: "fo",
    supplierFo: {
      firstName: "Jan",
      lastName: "Dodavatel",
      ico: "12345679",
      address: "Praha",
      accountNumber: "123456789/0100",
    },
    buyerFo: { firstName: "Eva", lastName: "Kup", address: "Brno" },
    invoice: {
      number: "AUDIT-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      payment: "transfer",
      accountNumber: "123456789/0100",
    },
    lines: [{ name: "Služba", qty: "2", unit: "ks", unitPrice: "1000", vatRate: "21" }],
  };
  const html = buildInvoicePaperHtml(st, computeTotals(st));

  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function");
    if (ok) break;
    await page.waitForTimeout(400);
  }
  await page.evaluate(async () => {
    if (typeof window.iuEnsureInvoiceOverlayBoot === "function") await window.iuEnsureInvoiceOverlayBoot();
  });
  await page.waitForTimeout(400);

  const audit = await page.evaluate(
    async ({ html, regions, styleKeys }) => {
      function pick(cs) {
        const o = {};
        styleKeys.forEach((k) => {
          const prop = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
          o[k] = cs.getPropertyValue(prop) || "";
        });
        return o;
      }
      function norm(v) {
        return String(v || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      }

      const panel = document.createElement("div");
      panel.id = "iuInvoicePanel";
      panel.innerHTML =
        '<div class="iu-inv-previewScroll"><div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--mobile">' +
        '<div class="iu-invoice-preview-mobile"><div class="iu-invoice-preview-scale">' +
        '<div class="iu-invoice-paper">' +
        html +
        "</div></div></div></div></div>";
      document.body.appendChild(panel);

      const exportProd = document.createElement("div");
      exportProd.className = "iu-pdf-render-mode iu-pdf-render-mode--export";
      exportProd.innerHTML = '<div class="iu-invoice-paper">' + html + "</div>";
      document.body.appendChild(exportProd);

      const exportVisible = document.createElement("div");
      exportVisible.className = "iu-pdf-render-mode iu-pdf-render-mode--audit-visible";
      exportVisible.innerHTML = html;
      document.body.appendChild(exportVisible);

      const previewPaper = panel.querySelector(".iu-inv-pr");
      const exportPaper = exportProd.querySelector(".iu-inv-pr");
      const exportVisPaper = exportVisible.querySelector(".iu-inv-pr");

      const htmlPreview = previewPaper ? previewPaper.outerHTML : "";
      const htmlExport = exportPaper ? exportPaper.outerHTML : "";
      const htmlParity = htmlPreview === htmlExport;

      const missingInExport = [];
      if (previewPaper) {
        if (!exportProd.querySelector(".iu-invoice-paper")) missingInExport.push(".iu-invoice-paper");
        if (panel.querySelector(".iu-invoice-preview-scale") && !exportProd.querySelector(".iu-invoice-preview-scale"))
          missingInExport.push(".iu-invoice-preview-scale");
      }

      const cssDiffs = [];
      const missingStyles = [];
      regions.forEach((r) => {
        const pv = panel.querySelector(r.sel);
        const exRules = exportVisible.querySelector(r.sel);
        const exProd = exportProd.querySelector(r.sel);
        if (!pv || !exRules) {
          cssDiffs.push(r.key + ":missing_element");
          return;
        }
        const ps = pick(getComputedStyle(pv));
        const es = pick(getComputedStyle(exRules));
        styleKeys.forEach((k) => {
          if (k === "visibility" || k === "opacity" || k === "fontFamily") return;
          if (norm(ps[k]) !== norm(es[k])) {
            missingStyles.push(r.key + "." + k + ":preview=" + ps[k] + "|export=" + es[k]);
          }
        });
        if (exProd) {
          const ep = pick(getComputedStyle(exProd));
          if (ep.visibility === "hidden" || parseFloat(ep.opacity || "1") < 0.05) {
            missingStyles.push(r.key + ".productionHostVisibility:hidden_breaks_canvas");
          }
        }
      });

      const hostCs = getComputedStyle(exportProd);
      const hostLeft = parseFloat(hostCs.left || "0");
      const exportHostCaptureReady =
        hostCs.visibility !== "hidden" && parseFloat(hostCs.opacity || "1") >= 0.95 && hostLeft <= -5000;
      const exportHostHidden =
        hostCs.visibility === "hidden" || parseFloat(hostCs.opacity || "1") < 0.05;

      const headPv = panel.querySelector(".iu-inv-pr-head");
      const headEx = exportProd.querySelector(".iu-inv-pr-head");
      const thPv = panel.querySelector(".iu-inv-pr-table th");
      const thEx = exportProd.querySelector(".iu-inv-pr-table th");

      let html2canvasLimits = [];
      let canvasHiddenScore = 0;
      let canvasVisibleScore = 0;

      async function loadHtml2Pdf() {
        if (typeof window.html2pdf !== "undefined") return;
        if (typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function") {
          await new Promise((r) => setTimeout(r, 200));
          if (typeof window.html2pdf !== "undefined") return;
        }
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "/assets/vendor/html2pdf.bundle.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
        await new Promise((r) => setTimeout(r, 600));
      }

      function borderScore(canvas) {
        if (!canvas || !canvas.getContext) return 0;
        const ctx = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        const img = ctx.getImageData(0, 0, w, h).data;
        let borderish = 0;
        let bordo = 0;
        for (let i = 0; i < img.length; i += 4) {
          const r = img[i];
          const g = img[i + 1];
          const b = img[i + 2];
          const a = img[i + 3];
          if (a < 8) continue;
          if (r < 240 || g < 240 || b < 240) borderish++;
          if (r > 80 && r < 160 && g < 60 && b < 80) bordo++;
        }
        return { borderish, bordo, pixels: w * h };
      }

      try {
        await loadHtml2Pdf();
        const h2c =
          window.html2canvas ||
          (window.html2pdf && window.html2pdf().html2canvas) ||
          null;
        if (h2c && previewPaper) {
          const cHidden = await h2c(exportProd, {
            scale: 1,
            width: 794,
            windowWidth: 794,
            backgroundColor: "#ffffff",
            logging: false,
          });
          const cVisible = await h2c(exportVisible, {
            scale: 1,
            width: 794,
            windowWidth: 794,
            backgroundColor: "#ffffff",
            logging: false,
          });
          canvasHiddenScore = borderScore(cHidden);
          canvasVisibleScore = borderScore(cVisible);
          if (canvasVisibleScore.borderish > 0 && canvasHiddenScore.borderish < canvasVisibleScore.borderish * 0.25) {
            html2canvasLimits.push("visibility_hidden_host_strips_borders_and_backgrounds");
          }
          const gradPv = headPv ? getComputedStyle(headPv).backgroundImage : "";
          if (gradPv && gradPv !== "none" && canvasVisibleScore.bordo < 50) {
            html2canvasLimits.push("linear_gradient_may_rasterize_weakly");
          }
          if (canvasVisibleScore.borderish > 100 && canvasHiddenScore.borderish < 50) {
            html2canvasLimits.push("opacity_zero_or_hidden_host_collapses_table_chrome");
          }
        } else {
          html2canvasLimits.push("html2canvas_unavailable_in_audit_page");
        }
      } catch (e) {
        html2canvasLimits.push("html2canvas_audit_error:" + String(e.message || e));
      }

      const cssRuleParity =
        missingStyles.filter((m) => m.indexOf("productionHostNotCaptureReady") === -1).length === 0;
      const cssParity = cssRuleParity;
      const exportHostSame = htmlParity && missingInExport.length <= 1 && cssRuleParity && exportHostCaptureReady;

      panel.remove();
      exportProd.remove();
      exportVisible.remove();

      return {
        htmlParity,
        htmlLenPreview: htmlPreview.length,
        htmlLenExport: htmlExport.length,
        missingInExport,
        missingStyles: missingStyles.slice(0, 40),
        missingStylesCount: missingStyles.length,
        cssParity,
        exportHostHidden,
        exportHostCaptureReady,
        exportHostSameAsPreview: exportHostSame,
        headBgPreview: headPv ? getComputedStyle(headPv).backgroundImage : "",
        headBgExport: headEx ? getComputedStyle(headEx).backgroundImage : "",
        thBgPreview: thPv ? getComputedStyle(thPv).backgroundColor : "",
        thBgExport: thEx ? getComputedStyle(thEx).backgroundColor : "",
        thBorderPreview: thPv ? getComputedStyle(thPv).border : "",
        thBorderExport: thEx ? getComputedStyle(thEx).border : "",
        html2canvasLimits,
        canvasHiddenScore,
        canvasVisibleScore,
        inlineHeadBorder: headPv ? headPv.getAttribute("style") : "",
      };
    },
    { html, regions: REGIONS, styleKeys: STYLE_KEYS },
  );

  let rootCause = "unknown";
  if (!audit.htmlParity) rootCause = "html_mismatch_between_hosts";
  else if (!audit.exportHostCaptureReady && audit.exportHostHidden)
    rootCause =
      "export_host_visibility_hidden_or_opacity_zero_breaks_html2canvas";
  else if (!audit.exportHostCaptureReady)
    rootCause = "export_host_not_capture_ready_offscreen_visible_required";
  else if (audit.html2canvasLimits.some((x) => x.indexOf("hidden") !== -1 || x.indexOf("collapses") !== -1))
    rootCause = "export_host_visibility_hidden_breaks_html2canvas_rasterization";
  else if (audit.missingStylesCount > 0) rootCause = "computed_css_diff_preview_vs_export";
  else if (audit.html2canvasLimits.length) rootCause = "html2canvas_raster_limits:" + audit.html2canvasLimits.join(",");
  else rootCause = "dom_css_match_but_pdf_pipeline_differs";

  printBlocks("invoice_pdf_css_parity_audit", {
    ROOT_CAUSE: rootCause,
    EXPORT_HOST_SAME_AS_PREVIEW: audit.exportHostSameAsPreview ? "ANO" : "NE",
    HTML_PARITY: audit.htmlParity ? "PASS" : "FAIL",
    CSS_PARITY: audit.cssParity ? "PASS" : "FAIL",
    EXPORT_HOST_HIDDEN: String(audit.exportHostHidden),
    EXPORT_HOST_CAPTURE_READY: String(!!audit.exportHostCaptureReady),
    MISSING_CLASSES: audit.missingInExport.join(",") || "(wrapper_only)",
    MISSING_STYLES_COUNT: audit.missingStylesCount,
    MISSING_STYLES_SAMPLE: (audit.missingStyles[0] || "none").slice(0, 200),
    HEAD_BG_PREVIEW: (audit.headBgPreview || "").slice(0, 80),
    HEAD_BG_EXPORT: (audit.headBgExport || "").slice(0, 80),
    TH_BG_PREVIEW: audit.thBgPreview || "",
    TH_BG_EXPORT: audit.thBgExport || "",
    INLINE_HEAD_BORDER: audit.inlineHeadBorder || "",
    HTML2CANVAS_LIMITATIONS: audit.html2canvasLimits.join(";") || "none_detected",
    CANVAS_HIDDEN_BORDERISH: String(audit.canvasHiddenScore.borderish || 0),
    CANVAS_VISIBLE_BORDERISH: String(audit.canvasVisibleScore.borderish || 0),
    CANVAS_VISIBLE_BORDO: String(audit.canvasVisibleScore.bordo || 0),
  });

  if (audit.missingStyles.length) {
    printBlocks("MISSING_STYLES_DETAIL", {
      lines: audit.missingStyles.slice(0, 15).join(" || "),
    });
  }

  await browser.close();
  if (server) server.close();

  process.exit(audit.exportHostSameAsPreview && audit.cssParity && audit.exportHostCaptureReady ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
