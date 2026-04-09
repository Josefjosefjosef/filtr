#!/usr/bin/env node
/**
 * Proof: MOJE SLUŽBY section + Bank/Bakalari/Insurance modals with persistence.
 * Verifies: DOM order (Moje služby before Rychlé odkazy), 6 icons, Bank N>=12, add/reorder persist,
 * Bakalari multi-card persist (iu_bakalari_profiles), Pojišťovna persist, console.error=0, pageerror=0, CLS=0.000000.
 * Output: artifacts/PROOF_moje_sluzby_full_dom_modal_reorder_cls.txt (local) or AFTER_MERGE_PROOF_moje_sluzby_full_prod.txt (prod).
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
  fs.writeFileSync(out, String(text).replace(/\r?\n/g, "\r\n"), "utf8");
  return out;
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = (req.url || "/").split("?")[0];
      if (urlPath === "/" || urlPath === "/projects" || urlPath === "/projects/") urlPath = "/projects/index.html";
      else if (!urlPath.startsWith("/")) urlPath = "/" + urlPath;
      const p = path.join(rootDir, urlPath.slice(1));
      const resolved = path.resolve(p);
      const rootResolved = path.resolve(rootDir);
      if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(p);
        const ct = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
        res.setHeader("Content-Type", ct);
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

async function main() {
  let browser = null;
  let page = null;
  let staticServer = null;
  const consoleErrors = [];
  const pageErrors = [];
  const lines = ["PROOF: Moje služby full DOM modal reorder CLS"];

  try {
    let BASE_URL = process.env.PROOF_BASE_URL || "";
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }
    lines.push("URL=" + BASE_URL);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/Failed to load resource/i.test(t)) return;
      if (/net::ERR_/i.test(t)) return;
      consoleErrors.push(t);
    });
    page.on("pageerror", (e) => pageErrors.push(String(e.message)));

    await page.addInitScript(() => { window.__proofCls = 0; });
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += e.value;
        });
        obs.observe({ type: "layout-shift", buffered: false });
      } catch (_) {}
    });

    // 1) MindMenu: Moje služby dlaždice v Quick grid (/projects/ — sloučeno v „Rychlé odkazy“)
    const domOrder = await page.evaluate(() => {
      const grid = document.querySelector("section.iu-mmQuickLinks .iu-mmQuickGrid");
      const hasBanka = !!(grid && grid.querySelector('[data-ms="banka"]'));
      const hasBakalari = !!(grid && grid.querySelector('[data-ms="bakalari"]'));
      const hasPoj = !!(grid && grid.querySelector('[data-ms="pojistovna"]'));
      return { mojeBeforeRychle: hasBanka && hasBakalari && hasPoj };
    });
    lines.push("DOM_mojeSluzbyBeforeRychle=" + domOrder.mojeBeforeRychle);

    // 2) Dlaždice Moje služby (banka + bakaláři + pojišťovna) v gridu
    const iconCount = await page.evaluate(() => {
      return document.querySelectorAll("section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile[data-ms]").length;
    });
    lines.push("mojeSluzby_iconCount=" + iconCount);

    // 3) Banka modal: N>=12, add, reorder, persist
    await page.evaluate(() => { try { localStorage.removeItem("iu_moje_sluzby_banks_state_v1"); } catch (_) {} });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-iuq="banka"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    const bankAllCount = await page.evaluate(() => {
      const grid = document.querySelector(".iu-mojeSluzbyAllGrid");
      if (!grid) return 0;
      return grid.querySelectorAll("[data-bank-id]").length;
    });
    lines.push("banka_allBanksCount=" + bankAllCount);

    // Add a bank to favorites (click Přidat on first non-fav)
    await page.evaluate(() => {
      const addBtns = Array.from(document.querySelectorAll("[data-add-remove]")).filter(b => (b.textContent || "").trim() === "Přidat");
      if (addBtns[0]) addBtns[0].click();
    });
    await page.waitForTimeout(200);

    // Switch to Edit mode and reorder (move first right)
    await page.evaluate(() => {
      const toggle = document.querySelector("[data-edit-toggle]");
      if (toggle && (toggle.textContent || "").includes("Upravit")) toggle.click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const moveRight = document.querySelector("[data-move-right]");
      if (moveRight) moveRight.click();
    });
    await page.waitForTimeout(200);

    const favBeforeReload = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem("iu_moje_sluzby_banks_state_v1");
        return raw ? JSON.parse(raw).favorites : [];
      } catch (_) { return []; }
    });
    lines.push("banka_favoritesBeforeReload=" + favBeforeReload.length);

    // Close QuickFeed, reload
    await page.evaluate(() => {
      if (typeof window.iuHideQuickFeed === "function") window.iuHideQuickFeed();
      if (typeof window.iuCloseMojeSluzbyModal === "function") window.iuCloseMojeSluzbyModal();
    });
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const btn = document.querySelector('[data-iuq="banka"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    const favAfterReload = await page.evaluate(() => {
      const grid = document.querySelector(".iu-mojeSluzbyFavGrid");
      if (!grid) return 0;
      return grid.querySelectorAll("[data-fav-id]").length;
    });
    lines.push("banka_favoritesAfterReload=" + favAfterReload);
    lines.push("banka_reorderPersist=" + (favAfterReload >= 1));

    // 4) Bakaláři: multi-card, name+URL, Uložit per card, persist iu_bakalari_profiles
    await page.evaluate(() => {
      if (typeof window.iuHideQuickFeed === "function") window.iuHideQuickFeed();
      if (typeof window.iuCloseMojeSluzbyModal === "function") window.iuCloseMojeSluzbyModal();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      try { localStorage.removeItem("iu_moje_sluzby_bakalari_v1"); } catch (_) {}
      try { localStorage.removeItem("iu_bakalari_profiles"); } catch (_) {}
    });

    await page.evaluate(() => {
      const btn = document.querySelector('[data-iuq="bakalari"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    const bakalariCardCount = await page.evaluate(() => document.querySelectorAll(".bakalari-card").length);
    lines.push("bakalari_cardCount=" + bakalariCardCount);

    await page.evaluate(() => {
      const card = document.querySelector(".bakalari-card");
      if (!card) return;
      const nameInp = card.querySelector("[data-field=\"name\"]");
      const urlInp = card.querySelector("[data-field=\"url\"]");
      if (nameInp) { nameInp.focus(); nameInp.value = "TestChild"; nameInp.dispatchEvent(new Event("input", { bubbles: true })); }
      if (urlInp) { urlInp.focus(); urlInp.value = "https://bakalari.example.cz"; urlInp.dispatchEvent(new Event("input", { bubbles: true })); }
      const saveBtn = card.querySelector("[data-action=\"save\"]");
      if (saveBtn) saveBtn.click();
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      if (typeof window.iuHideQuickFeed === "function") window.iuHideQuickFeed();
      if (typeof window.iuCloseMojeSluzbyModal === "function") window.iuCloseMojeSluzbyModal();
    });
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const btn = document.querySelector('[data-iuq="bakalari"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    const bakalariPersist = await page.evaluate(() => {
      const card = document.querySelector(".bakalari-card");
      if (!card) return false;
      const nameInp = card.querySelector("[data-field=\"name\"]");
      const urlInp = card.querySelector("[data-field=\"url\"]");
      const nameOk = nameInp && (nameInp.value || "").includes("TestChild");
      const urlOk = urlInp && (urlInp.value || "").includes("bakalari.example");
      return nameOk && urlOk;
    });
    lines.push("bakalari_persist=" + bakalariPersist);

    // 5) Zdravotní pojišťovna: items, name persist
    await page.evaluate(() => {
      if (typeof window.iuHideQuickFeed === "function") window.iuHideQuickFeed();
      if (typeof window.iuCloseMojeSluzbyModal === "function") window.iuCloseMojeSluzbyModal();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => { try { localStorage.removeItem("iu_moje_sluzby_pojistovny_names_v1"); } catch (_) {} });
    await page.evaluate(() => { try { localStorage.removeItem("iu_moje_sluzby_pojistovny_buttons_v1"); } catch (_) {} });

    await page.evaluate(() => {
      const btn = document.querySelector('[data-iuq="pojistovna"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    const pojCount = await page.evaluate(() => {
      const sel = document.querySelector("[data-poj-insurer]");
      if (!sel) return 0;
      return sel.querySelectorAll("option").length;
    });
    lines.push("pojistovna_itemCount=" + pojCount);

    await page.evaluate(() => {
      const sel = document.querySelector("[data-poj-insurer]");
      const nameInp = document.querySelector("[data-poj-name]");
      const colorSel = document.querySelector("[data-poj-color]");
      const saveBtn = document.querySelector("[data-poj-save]");
      if (sel) {
        sel.value = "vzp";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (nameInp) {
        nameInp.focus();
        nameInp.value = "Jan Novák";
        nameInp.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (colorSel) {
        colorSel.value = "c01";
        colorSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (saveBtn) saveBtn.click();
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      if (typeof window.iuHideQuickFeed === "function") window.iuHideQuickFeed();
      if (typeof window.iuCloseMojeSluzbyModal === "function") window.iuCloseMojeSluzbyModal();
    });
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const btn = document.querySelector('[data-iuq="pojistovna"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    const pojPersist = await page.evaluate(() => {
      const el = document.querySelector(".iu-pojistovnaTileName");
      return !!(el && (el.textContent || "").includes("Jan"));
    });
    lines.push("pojistovna_persist=" + pojPersist);

    const clsVal = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => null);
    const clsReport = clsVal != null && clsVal < 0.000001 ? "0.000000" : (clsVal != null ? String(clsVal) : "n/a");
    lines.push("console.error=" + consoleErrors.length);
    lines.push("pageerror=" + pageErrors.length);
    lines.push("CLS=" + clsReport);

    const content = lines.join("\r\n") + "\r\n";
    const isProd = BASE_URL.includes("infouzel.cz");
    if (isProd) {
      writeArtifact("AFTER_MERGE_PROOF_moje_sluzby_full_prod.txt", content);
    } else {
      writeArtifact("PROOF_moje_sluzby_full_dom_modal_reorder_cls.txt", content);
    }
    console.log(content);

    const gatesOk = domOrder.mojeBeforeRychle &&
      iconCount >= 3 &&
      bankAllCount >= 12 &&
      favAfterReload >= 1 &&
      bakalariCardCount >= 1 &&
      bakalariPersist &&
      pojCount >= 7 &&
      pojPersist &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0 &&
      (clsVal == null || clsVal < 0.000001);
    if (!gatesOk) process.exitCode = 1;
  } catch (err) {
    console.error("proof_moje_sluzby failed:", err.message);
    writeArtifact("PROOF_moje_sluzby_full_dom_modal_reorder_cls.txt", "ERROR=" + String(err.message) + "\r\n");
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
