#!/usr/bin/env node
/**
 * Guard: TERMS clickwrap gate + analytics priority + version persistence.
 * Deterministic static + local Playwright runtime. Analytics copy must stay intact.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

const TITLE = "Podmínky používání InfoUzel.cz";
const ACCEPT = "Souhlasím a pokračuji";
const DECLINE = "Nesouhlasím";
const READ = "Přečíst GDPR a Všeobecné obchodní podmínky";
const A_TITLE = "Pomozte nám zlepšovat InfoUzel.cz";
const A_DENY = "Nepovolit anonymní statistiky";
const A_ALLOW = "Povolit anonymní statistiky";
const A_SETTINGS = "Nastavení";
const VER = "2026-09-08-v1";

function staticGate() {
  const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");
  const acc = fs.readFileSync(path.join(ROOT, "assets/iu-terms-acceptance-v1.js"), "utf8");
  const gate = fs.readFileSync(path.join(ROOT, "assets/iu-terms-gate-v1.js"), "utf8");
  const layer = fs.readFileSync(path.join(ROOT, "assets/iu-consent-layer.js"), "utf8");
  const legal = fs.readFileSync(path.join(ROOT, "assets/iu-gdpr-vop-legal-body-v1.js"), "utf8");
  const ver = JSON.parse(
    fs.readFileSync(path.join(ROOT, "projects/data/legal/legal-docs-version.json"), "utf8")
  );

  must(index.includes('id="iuTermsGate"'), "static:terms_markup");
  must(index.includes(TITLE), "static:terms_title");
  must(index.includes(ACCEPT), "static:accept_btn");
  must(index.includes(DECLINE), "static:decline_btn");
  must(index.includes(READ), "static:read_btn");
  must(index.includes('id="iuTermsAcceptCheck"'), "static:checkbox");
  must(index.includes("iu-terms-acceptance-v1.js"), "static:acc_script");
  must(index.includes("iu-terms-gate-v1.js"), "static:gate_script");
  must(index.includes(A_TITLE), "static:analytics_title_unchanged");
  must(index.includes(A_DENY), "static:analytics_deny_unchanged");
  must(index.includes(A_ALLOW), "static:analytics_allow_unchanged");
  must(index.includes(">" + A_SETTINGS + "<"), "static:analytics_settings_unchanged");
  must(index.includes('data-iu-info-section="gdpr-vop"'), "static:icentrum_gdpr_tile");
  must(index.includes("GDPR a Všeobecné obchodní podmínky"), "static:icentrum_label");

  must(/needsAcceptance/.test(acc), "static:acc_api");
  must(/iu:terms:accepted-version:v1/.test(acc), "static:acc_key");
  must(/acceptCurrentVersion/.test(acc), "static:acc_accept");
  must(/recordDecline/.test(acc), "static:acc_decline_no_write_path");
  must(/iu:terms-accepted/.test(gate) || /iu:terms-accepted/.test(acc), "static:event");
  must(/iu:terms-accepted/.test(layer), "static:consent_waits_terms");
  must(/iuConsentLayerShowIfNeeded/.test(layer), "static:consent_export_show");
  must(/showConsentLayerIfNeeded/.test(layer), "static:consent_deferred_helper");
  must(legal.includes('versionId: "' + VER + '"'), "static:legal_version");
  must(/requiresReacceptance:\s*true/.test(legal), "static:reaccept_flag");
  must(legal.includes("Přijetí podmínek"), "static:legal_accept_section");
  must(ver.versionId === VER, "static:version_json");
  must(ver.requiresReacceptance === true, "static:version_json_reaccept");
  must(fs.existsSync(path.join(ROOT, "projects/data/legal/archive/2026-09-05-v1.meta.json")), "static:archive_meta");
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function withServer(fn) {
  const PORT = 8961 + Math.floor(Math.random() * 40);
  const child = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 25000);
    await fn("http://127.0.0.1:" + PORT);
  } finally {
    try {
      child.kill();
    } catch (_) {}
  }
}

async function runtime() {
  const browser = await chromium.launch({ headless: true });
  try {
    await withServer(async (origin) => {
      // A: fresh user — terms yes, analytics no
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await ctx.addInitScript(() => {
          try {
            localStorage.clear();
          } catch (_) {}
        });
        const page = await ctx.newPage();
        await page.goto(origin + "/projects/?terms=fresh", { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForSelector("#iuTermsGate:not([hidden])", { timeout: 60000 });
        const snap = await page.evaluate(() => {
          const terms = document.getElementById("iuTermsGate");
          const cons = document.getElementById("iuConsentLayer");
          const cb = document.getElementById("iuTermsAcceptCheck");
          const acc = document.getElementById("iuTermsAcceptBtn");
          return {
            termsVisible: !!(terms && !terms.hidden),
            consVisible: !!(cons && !cons.hidden),
            checked: !!(cb && cb.checked),
            acceptDisabled: !!(acc && acc.disabled),
          };
        });
        must(snap.termsVisible, "rt:fresh_terms_visible");
        must(!snap.consVisible, "rt:fresh_analytics_hidden");
        must(!snap.checked, "rt:checkbox_false");
        must(snap.acceptDisabled, "rt:accept_disabled");

        await page.click("#iuTermsReadBtn");
        await page.waitForSelector("#iuTermsGateDoc:not([hidden])", { timeout: 15000 });
        await page.click("#iuTermsDocBackBtn");
        await page.waitForSelector("#iuTermsGateMain:not([hidden])", { timeout: 15000 });
        const stillUnchecked = await page.evaluate(() => {
          const cb = document.getElementById("iuTermsAcceptCheck");
          return !(cb && cb.checked);
        });
        must(stillUnchecked, "rt:read_does_not_check");

        await page.check("#iuTermsAcceptCheck");
        await page.waitForFunction(() => {
          const acc = document.getElementById("iuTermsAcceptBtn");
          return acc && !acc.disabled;
        }, null, { timeout: 5000 });
        await page.click("#iuTermsAcceptBtn");
        await page.waitForFunction(() => {
          const t = document.getElementById("iuTermsGate");
          return t && t.hidden;
        }, null, { timeout: 15000 });
        await page.waitForSelector("#iuConsentLayer:not([hidden])", { timeout: 30000 });
        const after = await page.evaluate(() => {
          const cons = document.getElementById("iuConsentLayer");
          const title = cons && cons.querySelector(".iuConsentLayer__title");
          return {
            consVisible: !!(cons && !cons.hidden),
            title: title ? String(title.textContent || "").trim() : "",
            ver: localStorage.getItem("iu:terms:accepted-version:v1"),
            accepted: localStorage.getItem("iu:terms:accepted:v1"),
          };
        });
        must(after.consVisible, "rt:analytics_after_terms");
        must(after.title === A_TITLE, "rt:analytics_title");
        must(after.ver === VER, "rt:stored_version");
        must(after.accepted === "1", "rt:stored_flag");
        await ctx.close();
      }

      // B: returning visitor — no terms
      {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript((v) => {
          try {
            localStorage.setItem("iu:terms:accepted:v1", "1");
            localStorage.setItem("iu:terms:accepted-version:v1", v);
            localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
            localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
            localStorage.setItem("iu:consent:analytics:v1", "denied");
          } catch (_) {}
        }, VER);
        const page = await ctx.newPage();
        await page.goto(origin + "/projects/?terms=return", { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForTimeout(1200);
        const hid = await page.evaluate(() => {
          const t = document.getElementById("iuTermsGate");
          return !!(t && t.hidden);
        });
        must(hid, "rt:return_no_terms");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForTimeout(800);
        const hid2 = await page.evaluate(() => {
          const t = document.getElementById("iuTermsGate");
          return !!(t && t.hidden);
        });
        must(hid2, "rt:reload_no_terms");
        await ctx.close();
      }

      // C: decline — no acceptance
      {
        const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true });
        await ctx.addInitScript(() => {
          try {
            localStorage.clear();
          } catch (_) {}
        });
        const page = await ctx.newPage();
        await page.goto(origin + "/projects/?terms=decline", { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForSelector("#iuTermsGate:not([hidden])", { timeout: 60000 });
        await page.click("#iuTermsDeclineBtn");
        await page.waitForSelector("#iuTermsGateDeclined:not([hidden])", { timeout: 10000 });
        const d = await page.evaluate(() => ({
          accepted: localStorage.getItem("iu:terms:accepted:v1"),
          ver: localStorage.getItem("iu:terms:accepted-version:v1"),
          consVisible: !!(document.getElementById("iuConsentLayer") && !document.getElementById("iuConsentLayer").hidden),
        }));
        must(d.accepted !== "1", "rt:decline_no_accept");
        must(!d.ver, "rt:decline_no_version");
        must(!d.consVisible, "rt:decline_no_analytics");
        await ctx.close();
      }

      // D: old version + requiresReacceptance → show again
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await ctx.addInitScript(() => {
          try {
            localStorage.setItem("iu:terms:accepted:v1", "1");
            localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-05-v1");
            localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
          } catch (_) {}
        });
        const page = await ctx.newPage();
        await page.goto(origin + "/projects/?terms=reaccept", { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForSelector("#iuTermsGate:not([hidden])", { timeout: 60000 });
        const vis = await page.evaluate(() => {
          const t = document.getElementById("iuTermsGate");
          return !!(t && !t.hidden);
        });
        must(vis, "rt:reaccept_shows");
        await ctx.close();
      }

      // E: existing local-first data preserved after accept
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await ctx.addInitScript(() => {
          try {
            localStorage.clear();
            localStorage.setItem("iu_notes_v1", JSON.stringify({ items: [{ id: "n1", text: "keep-me" }] }));
            localStorage.setItem("iu_tasks_v1", JSON.stringify({ items: [{ id: "t1", title: "keep-task" }] }));
          } catch (_) {}
        });
        const page = await ctx.newPage();
        await page.goto(origin + "/projects/?terms=data", { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForSelector("#iuTermsGate:not([hidden])", { timeout: 60000 });
        await page.check("#iuTermsAcceptCheck");
        await page.click("#iuTermsAcceptBtn");
        await page.waitForFunction(() => {
          const t = document.getElementById("iuTermsGate");
          return t && t.hidden;
        }, null, { timeout: 15000 });
        const kept = await page.evaluate(() => ({
          notes: localStorage.getItem("iu_notes_v1") || "",
          tasks: localStorage.getItem("iu_tasks_v1") || "",
        }));
        must(kept.notes.includes("keep-me"), "rt:notes_preserved");
        must(kept.tasks.includes("keep-task"), "rt:tasks_preserved");
        await ctx.close();
      }
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.log(JSON.stringify({ IU_TERMS_CLICKWRAP_GATE_GUARD: "FAIL", fails }, null, 2));
    process.exit(1);
  }
  await runtime();
  if (fails.length) {
    console.log(JSON.stringify({ IU_TERMS_CLICKWRAP_GATE_GUARD: "FAIL", fails }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ IU_TERMS_CLICKWRAP_GATE_GUARD: "PASS", fails: [] }));
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
