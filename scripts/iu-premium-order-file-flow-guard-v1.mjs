#!/usr/bin/env node
/**
 * Real file-input workflow for premium order form (local Playwright).
 * Run: npm run iu-premium-order-file-flow-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function extractLiveSlotCssExport() {
  const src = read("cloudflare/iu-ads/src/premium-order-ui.ts");
  if (!/PREMIUM_LIVE_SLOT_CSS/.test(src)) throw new Error("missing PREMIUM_LIVE_SLOT_CSS import");
  const slotSrc = read("cloudflare/iu-ads/src/premium-live-slot-css.ts");
  const gridM = slotSrc.match(/export const PREMIUM_AFFILIATE_SLOT_GRID_CSS = `([\s\S]*?)`;/);
  const m = slotSrc.match(/export const PREMIUM_LIVE_SLOT_CSS = `([\s\S]*?)`;/);
  if (!m) throw new Error("missing PREMIUM_LIVE_SLOT_CSS");
  const grid = gridM ? gridM[1] : "";
  return m[1].replace("${PREMIUM_AFFILIATE_SLOT_GRID_CSS}", grid);
}

function buildClientScript() {
  const renderJs = read("assets/iu-premium-creative-render-v1.js");
  const errTs = read("cloudflare/iu-ads/src/premium-order-errors.ts");
  const errMatch = errTs.match(/export const PREMIUM_ORDER_ERROR_CS[^=]*=\s*(\{[\s\S]*?\n\});/);
  if (!errMatch) throw new Error("missing PREMIUM_ORDER_ERROR_CS");
  const ERR_CS = Function("return " + errMatch[1])();
  const orderScript = read("cloudflare/iu-ads/src/premium-order-ui-script.ts");
  const fnStart = orderScript.indexOf("export function buildPremiumOrderClientScript");
  const templateStart = orderScript.indexOf("`function userMsg", fnStart);
  const templateEnd = orderScript.lastIndexOf("})();`");
  if (templateStart < 0 || templateEnd < 0) throw new Error("missing client script template");
  const inner = orderScript.slice(templateStart + 1, templateEnd + "})();".length);
  const filled = inner
    .replace("ERR_CS[code]", "ERR_CS[code]")
    .replace(/^function userMsg/, "function userMsg");
  return (
    renderJs +
    "\n;(function(){\n" +
    '"use strict";\n' +
    "var ERR_CS=" +
    JSON.stringify(ERR_CS) +
    ";\n" +
    "var termsVersion=" +
    JSON.stringify("guard-v1") +
    ";\n" +
    "var termsEffective=" +
    JSON.stringify("2026-01-01") +
    ";\n" +
    "var MAX_FILE_BYTES=5*1024*1024;\n" +
    "var ALLOWED_MIME={\"image/png\":1,\"image/jpeg\":1,\"image/webp\":1};\n" +
    filled
  );
}

function extractOrderCreativeSection() {
  const orderUi = read("cloudflare/iu-ads/src/premium-order-ui.ts");
  const start = orderUi.indexOf('<label for="file">Soubor s kreativou *</label>');
  const end = orderUi.indexOf('<label for="note">Poznámka</label>');
  if (start < 0 || end < 0) throw new Error("creative section bounds");
  return orderUi.slice(start, end);
}

function staticChecks() {
  const orderUi = read("cloudflare/iu-ads/src/premium-order-ui.ts");
  const orderScript = read("cloudflare/iu-ads/src/premium-order-ui-script.ts");
  const filePos = orderUi.indexOf('id="file"');
  const modePos = orderUi.indexOf("creative_mode_label");
  ok("upload_before_mode", filePos > 0 && modePos > filePos);
  ok("confirm_btn", /id="creative_confirm_btn"/.test(orderUi) && /Potvrdit vzhled/.test(orderUi));
  ok("edit_btn", /id="creative_edit_btn"/.test(orderUi) && /Upravit vzhled/.test(orderUi));
  ok("file_pick_btn", /id="file_pick_btn"/.test(orderUi));
  ok("resolve_mime", /resolveCreativeMime/.test(orderScript));
  ok("object_url_preview", /createObjectURL/.test(orderScript));
  ok("file_input_listener", /addEventListener\("input",onFileInputEvent\)/.test(orderScript));
  ok("confirm_submit_gate", /ensureCreativeConfirmedForSubmit/.test(orderScript));
  ok("mode_invalidate", /invalidateCreativeConfirmation/.test(orderScript));
}

staticChecks();
if (fails.length) {
  console.error("FAIL iu-premium-order-file-flow-guard-v1 static");
  for (const f of fails) console.error(f);
  process.exit(1);
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const s = net.createConnection({ host, port }, () => {
        s.end();
        resolve();
      });
      s.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("port_timeout"));
        else setTimeout(tick, 100);
      });
    };
    tick();
  });
}

const previewCssInline = extractLiveSlotCssExport();
const creativeHtml = extractOrderCreativeSection();
const clientScript = buildClientScript();

function fixtureHtml() {
  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root{--line:#d6d0c4;--ink:#1a221e;--muted:#5c675f;--accent:#0f6b5c;--iuChipH:110px;--iuChipPadX:12px}
body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#f7f5f1;color:var(--ink)}
main{max-width:720px;margin:0 auto;padding:1.25rem}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:1rem}
label{display:block;font-size:.85rem;color:var(--muted);margin:.5rem 0 .15rem}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:.6rem 1rem;font:inherit;cursor:pointer;width:100%;margin-top:.75rem}
button.btn-secondary{background:#fff;color:var(--ink);border:1px solid var(--line);margin-top:.5rem}
.muted{color:var(--muted);font-size:.9rem}
.field-err{color:#9b2c2c;font-size:.85rem;margin:.2rem 0 0}
.creative-req{font-size:.85rem;margin:.25rem 0 .5rem;padding-left:1rem}
.creative-mode-label{display:block;font-size:.85rem;color:var(--muted);margin:.5rem 0 .35rem}
.creative-mode-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.45rem;margin:0 0 .65rem;width:100%;box-sizing:border-box}
.creative-mode-option{display:flex;align-items:center;gap:.45rem;border:1px solid var(--line);border-radius:8px;padding:.45rem .55rem;font-size:.88rem;cursor:pointer;background:#faf9f7;min-width:0}
.creative-mode-option input{width:1rem;height:1rem;margin:0;flex-shrink:0}
.iuPremiumFilePick{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem .75rem;margin:.25rem 0 .5rem;width:100%;box-sizing:border-box}
.iuPremiumFilePick-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;opacity:0;pointer-events:none}
.iuPremiumFilePick-btn{display:inline-flex;align-items:center;justify-content:center;padding:.55rem .85rem;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-weight:600;cursor:pointer;flex-shrink:0;width:auto;margin-top:0}
.iuPremiumFilePick-name{flex:1 1 8rem;min-width:0;font-size:.88rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.creative-confirm-block{margin:.65rem 0 .25rem}
.creative-confirm-btn{width:auto;margin-top:0;display:inline-flex;align-items:center;justify-content:center;padding:.55rem 1rem}
.creative-confirm-status{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;margin:.5rem 0 0;font-size:.95rem;line-height:1.35}
.creative-confirm-status[hidden]{display:none!important}
.creative-confirm-ok{color:#0f6b5c;font-weight:600}
.creative-edit-btn{width:auto;margin-top:0;padding:.45rem .85rem;font-size:.9rem}
.summary-h{margin:0 0 .5rem;font-size:1.05rem}
${previewCssInline}
</style>
</head>
<body><main><form id="form" class="card">
${creativeHtml}
<input type="hidden" id="placement" value="test"/>
</form></main>
<script>${clientScript}</script>
</body></html>`;
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8971", 10);
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fixtureHtml());
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
await waitForPort("127.0.0.1", PORT, 10000);

const pngPath = path.join(os.tmpdir(), "iu-premium-file-flow-fixture.png");
const pngBuf = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
  "base64"
);
fs.writeFileSync(pngPath, pngBuf);

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle", timeout: 60000 });

  await page.setInputFiles("#file", pngPath);
  await page.waitForFunction(
    () => {
      const name = document.getElementById("file_name_display");
      const img = document.querySelector("#previewSlot img.iuPremiumSlotImg");
      return name && name.textContent && name.textContent.indexOf(".png") >= 0 && img && img.naturalWidth > 0;
    },
    { timeout: 15000 }
  );

  const fileName = await page.textContent("#file_name_display");
  ok("filename_visible", fileName && fileName.includes("iu-premium-file-flow-fixture.png"), fileName);

  const imgVisible = await page.evaluate(() => {
    const img = document.querySelector("#previewSlot img.iuPremiumSlotImg");
    return !!(img && img.naturalWidth > 0 && img.clientWidth > 0);
  });
  ok("preview_image_visible", imgVisible);

  const modes = [
    ["image_small", "blend"],
    ["image_medium", "blend"],
    ["image_large", "blend"],
    ["full_bleed_banner", "banner"],
    ["logo", "logo"],
  ];
  for (const [value, suffix] of modes) {
    await page.locator(`input[name="creative_mode_choice"][value="${value}"]`).check();
    await page.waitForFunction(
      (suf) => {
        const slot = document.getElementById("previewSlot");
        return slot && slot.classList.contains("iuPremiumSlot--" + suf);
      },
      suffix,
      { timeout: 5000 }
    );
  }
  ok("mode_switch_updates_preview", true);

  await page.locator("#creative_confirm_btn").click();
  await page.waitForSelector("#creative_confirm_status:not([hidden])", { timeout: 5000 });
  const confirmedText = await page.textContent("#creative_confirm_ok");
  ok("confirmed_state", confirmedText && confirmedText.includes("potvrzen"), confirmedText);

  await page.locator('input[name="creative_mode_choice"][value="image_medium"]').check();
  const confirmBtnVisible = await page.isVisible("#creative_confirm_btn");
  ok("mode_change_invalidates", confirmBtnVisible);

  await page.locator("#creative_confirm_btn").click();
  await page.waitForSelector("#creative_confirm_status:not([hidden])", { timeout: 5000 });

  const emptyMime = await page.evaluate(() => {
    const input = document.getElementById("file");
    const f = input && input.files && input.files[0];
    if (!f) return false;
    Object.defineProperty(f, "type", { value: "" });
    return true;
  });
  ok("empty_mime_fixture", emptyMime);
  await page.evaluate(() => {
    const input = document.getElementById("file");
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector("#previewSlot img.iuPremiumSlotImg")?.naturalWidth > 0,
    { timeout: 5000 }
  );
  ok("empty_mime_still_previews", true);

  await context.close();
} finally {
  await browser.close();
  server.close();
  try {
    fs.unlinkSync(pngPath);
  } catch (_) {}
}

if (fails.length) {
  console.error("FAIL iu-premium-order-file-flow-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-order-file-flow-guard-v1");
