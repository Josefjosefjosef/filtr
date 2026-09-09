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
const FREE =
  "Běžné používání InfoUzel.cz a jeho local-first nástrojů je zdarma a nevyžaduje registraci ani vytvoření uživatelského účtu.";
const PAID_SPLIT =
  "Placené reklamní, obchodní nebo jiné individuálně sjednané služby a spolupráce";
const A_TITLE = "Pomozte nám zlepšovat InfoUzel.cz";
const A_DENY = "Nepovolit anonymní statistiky";
const A_ALLOW = "Povolit anonymní statistiky";
const A_SETTINGS = "Nastavení";
const VER = "2026-09-08-v1";

function staticGate() {
  const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");
  const acc = fs.readFileSync(path.join(ROOT, "assets/iu-terms-acceptance-v1.js"), "utf8");
  const gate = fs.readFileSync(path.join(ROOT, "assets/iu-terms-gate-v1.js"), "utf8");
  const gateCss = fs.readFileSync(path.join(ROOT, "assets/iu-terms-gate-v1.css"), "utf8");
  const infoCss = fs.readFileSync(path.join(ROOT, "assets/iu-info-center.css"), "utf8");
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
  must(index.includes(FREE), "static:free_text");
  must(index.includes(PAID_SPLIT), "static:paid_split_kept");
  must(index.includes('id="iuTermsAcceptCheck"'), "static:checkbox");
  must(index.includes('id="iuTermsGateConfirm"'), "static:confirm_footer");
  must(index.includes('id="iuTermsGateDeclined"'), "static:declined_panel");
  must(index.includes("Znovu zobrazit podmínky"), "static:show_again");
  must(!index.includes('id="iuTermsOpenPublicBtn"'), "static:no_open_public_btn");
  must(!index.includes("Otevřít GDPR a Všeobecné obchodní podmínky"), "static:no_open_gdpr_text");
  must(!/iuTermsOpenPublicBtn/.test(gate), "static:gate_no_open_public");
  {
    const confirmPos = index.indexOf('id="iuTermsGateConfirm"');
    const checkPos = index.indexOf('id="iuTermsAcceptCheck"');
    const readPos = index.indexOf('id="iuTermsReadBtn"');
    must(confirmPos > 0 && checkPos > confirmPos, "static:check_in_confirm");
    must(readPos > 0 && confirmPos > readPos, "static:read_before_confirm");
  }
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
  must(/isCiLocalAutomationBypass/.test(acc), "static:ci_bypass_helper");
  must(/__IU_FORCE_TERMS_GATE__/.test(acc), "static:force_gate_flag");
  must(/iu:terms-accepted/.test(gate) || /iu:terms-accepted/.test(acc), "static:event");
  must(/iuInfoCenterOpenSection/.test(gate), "static:gate_opens_icentrum");
  must(/scrollTop\s*=\s*0/.test(gate), "static:scroll_reset");
  must(/preventScroll/.test(gate), "static:focus_prevent_scroll");
  must(/iu-terms-icentrum-read/.test(gate), "static:icentrum_read_flag");
  must(/iu-terms-icentrum-read/.test(gateCss) || /iu-terms-icentrum-read/.test(infoCss), "static:icentrum_stack_css");
  must(/iuTermsGate__confirm/.test(gateCss), "static:confirm_css");
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

async function forceTermsGate(ctx) {
  await ctx.addInitScript(() => {
    try {
      window.__IU_FORCE_TERMS_GATE__ = true;
    } catch (_) {}
  });
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
      // A: fresh user — terms yes, analytics no + icentrum pre-accept path
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await forceTermsGate(ctx);
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
          const scroll = terms && terms.querySelector(".iuTermsGate__scroll");
          const title = document.getElementById("iuTermsGateTitle");
          const bodyText = scroll ? String(scroll.textContent || "") : "";
          return {
            termsVisible: !!(terms && !terms.hidden),
            consVisible: !!(cons && !cons.hidden),
            checked: !!(cb && cb.checked),
            acceptDisabled: !!(acc && acc.disabled),
            scrollTop: scroll ? scroll.scrollTop : -1,
            titleTop: title ? title.getBoundingClientRect().top : -1,
            scrollTopBound: scroll ? scroll.getBoundingClientRect().top : -1,
            freeOk: bodyText.indexOf("je zdarma a nevyžaduje registraci") !== -1,
          };
        });
        must(snap.termsVisible, "rt:fresh_terms_visible");
        must(!snap.consVisible, "rt:fresh_analytics_hidden");
        must(!snap.checked, "rt:checkbox_false");
        must(snap.acceptDisabled, "rt:accept_disabled");
        must(snap.scrollTop === 0, "rt:scroll_top_zero");
        must(snap.freeOk, "rt:free_text_visible");
        must(
          snap.titleTop >= snap.scrollTopBound - 2 && snap.titleTop < snap.scrollTopBound + 80,
          "rt:title_near_top"
        );

        const fixedLayout = await page.evaluate(async () => {
          const main = document.getElementById("iuTermsGateMain");
          const scroll = main && main.querySelector(".iuTermsGate__scroll");
          const confirm = document.getElementById("iuTermsGateConfirm");
          const cb = document.getElementById("iuTermsAcceptCheck");
          const read = document.getElementById("iuTermsReadBtn");
          const acc = document.getElementById("iuTermsAcceptBtn");
          const decline = document.getElementById("iuTermsDeclineBtn");
          if (!scroll || !confirm || !cb || !read || !acc || !decline) {
            return { ok: false, reason: "missing_nodes" };
          }
          const checkOutsideScroll = !scroll.contains(cb) && confirm.contains(cb);
          const readInsideScroll = scroll.contains(read);
          const actionsInConfirm = confirm.contains(acc) && confirm.contains(decline);
          const y0 = confirm.getBoundingClientRect().top;
          const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
          scroll.scrollTop = maxScroll;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const y1 = confirm.getBoundingClientRect().top;
          const scrolled = scroll.scrollTop > 0 || maxScroll === 0;
          const readVisible =
            read.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom + 2 ||
            scroll.scrollTop >= maxScroll - 2;
          scroll.scrollTop = 0;
          return {
            ok: true,
            checkOutsideScroll,
            readInsideScroll,
            actionsInConfirm,
            confirmFixed: Math.abs(y1 - y0) < 1.5,
            scrolled,
            readReachable: readVisible,
            maxScroll,
          };
        });
        must(fixedLayout.ok, "rt:fixed_layout_nodes");
        must(fixedLayout.checkOutsideScroll, "rt:check_outside_scroll");
        must(fixedLayout.readInsideScroll, "rt:read_inside_scroll");
        must(fixedLayout.actionsInConfirm, "rt:actions_in_confirm");
        must(fixedLayout.confirmFixed, "rt:confirm_fixed_on_scroll");
        must(fixedLayout.scrolled || fixedLayout.maxScroll === 0, "rt:content_can_scroll");
        must(fixedLayout.readReachable, "rt:read_btn_reachable");

        await page.click("#iuTermsReadBtn");
        await page.waitForSelector("#iuTopbarInfoOverlay:not([hidden])", { timeout: 20000 });
        const ic = await page.evaluate(() => {
          const overlay = document.getElementById("iuTopbarInfoOverlay");
          const terms = document.getElementById("iuTermsGate");
          const gdpr = document.getElementById("iuInfoCenterDetailGdprVop");
          const menu = document.getElementById("iuInfoCenterMenu");
          const back = document.getElementById("iuInfoCenterBack");
          return {
            overlayOpen: !!(overlay && !overlay.hidden),
            termsStill: !!(terms && !terms.hidden),
            gdprOpen: !!(gdpr && !gdpr.hidden),
            menuHidden: !!(menu && menu.hidden),
            backVisible: !!(back && !back.hidden),
            accepted: localStorage.getItem("iu:terms:accepted:v1"),
            readMode: !!window.__IU_TERMS_ICENTRUM_READ__,
          };
        });
        must(ic.overlayOpen, "rt:icentrum_open");
        must(ic.termsStill, "rt:terms_under_icentrum");
        must(ic.gdprOpen, "rt:gdpr_detail_open");
        must(ic.menuHidden, "rt:menu_hidden_on_detail");
        must(ic.backVisible, "rt:back_visible");
        must(ic.accepted !== "1", "rt:read_no_accept");
        must(ic.readMode, "rt:read_mode_flag");

        await page.click("#iuInfoCenterBack");
        await page.waitForFunction(() => {
          const menu = document.getElementById("iuInfoCenterMenu");
          return menu && !menu.hidden;
        }, null, { timeout: 10000 });
        await page.click('.iuInfoCenter__tile[data-iu-info-section="about"]');
        const aboutOk = await page.evaluate(() => {
          const about = document.querySelector('.iuInfoCenter__detail[data-iu-info-section="about"]');
          return !!(about && !about.hidden);
        });
        must(aboutOk, "rt:other_section_open");

        await page.click("#iuTopbarInfoOverlayClose");
        await page.waitForFunction(() => {
          const overlay = document.getElementById("iuTopbarInfoOverlay");
          return !overlay || overlay.hidden;
        }, null, { timeout: 10000 });
        const backToTerms = await page.evaluate(() => {
          const terms = document.getElementById("iuTermsGate");
          const main = document.getElementById("iuTermsGateMain");
          const cb = document.getElementById("iuTermsAcceptCheck");
          const scroll = terms && terms.querySelector("#iuTermsGateMain .iuTermsGate__scroll");
          const confirm = document.getElementById("iuTermsGateConfirm");
          return {
            termsVisible: !!(terms && !terms.hidden),
            mainVisible: !!(main && !main.hidden),
            checked: !!(cb && cb.checked),
            accepted: localStorage.getItem("iu:terms:accepted:v1"),
            readMode: !!window.__IU_TERMS_ICENTRUM_READ__,
            scrollTop: scroll ? scroll.scrollTop : -1,
            unlocked: !document.documentElement.classList.contains("iu-terms-gate-open"),
            confirmVisible: !!(confirm && confirm.getBoundingClientRect().height > 0),
            checkOutsideScroll: !!(scroll && cb && !scroll.contains(cb)),
          };
        });
        must(backToTerms.termsVisible, "rt:close_returns_terms");
        must(backToTerms.mainVisible, "rt:main_after_close");
        must(!backToTerms.checked, "rt:close_does_not_check");
        must(backToTerms.accepted !== "1", "rt:close_no_accept");
        must(!backToTerms.readMode, "rt:read_mode_cleared");
        must(backToTerms.scrollTop === 0, "rt:scroll_reset_after_icentrum");
        must(!backToTerms.unlocked, "rt:gate_still_locked");
        must(backToTerms.confirmVisible, "rt:confirm_visible_after_icentrum");
        must(backToTerms.checkOutsideScroll, "rt:check_still_outside_scroll");

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
        await forceTermsGate(ctx);
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
        await forceTermsGate(ctx);
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
        const declinedUi = await page.evaluate(() => {
          const panel = document.getElementById("iuTermsGateDeclined");
          const text = panel ? panel.textContent || "" : "";
          const openPublic = document.getElementById("iuTermsOpenPublicBtn");
          const again = document.getElementById("iuTermsShowAgainBtn");
          const hit = text.includes("Otevřít GDPR a Všeobecné obchodní podmínky");
          return {
            hit,
            hasOpenPublic: !!openPublic,
            hasAgain: !!(again && again.offsetParent !== null),
            accepted: localStorage.getItem("iu:terms:accepted:v1"),
            ver: localStorage.getItem("iu:terms:accepted-version:v1"),
            consVisible: !!(document.getElementById("iuConsentLayer") && !document.getElementById("iuConsentLayer").hidden),
          };
        });
        must(!declinedUi.hit, "rt:decline_no_open_gdpr_text");
        must(!declinedUi.hasOpenPublic, "rt:decline_no_open_public_btn");
        must(declinedUi.hasAgain, "rt:decline_show_again_visible");
        must(declinedUi.accepted !== "1", "rt:decline_no_accept");
        must(!declinedUi.ver, "rt:decline_no_version");
        must(!declinedUi.consVisible, "rt:decline_no_analytics");
        await page.click("#iuTermsShowAgainBtn");
        await page.waitForSelector("#iuTermsGateMain:not([hidden])", { timeout: 10000 });
        const againState = await page.evaluate(() => {
          const scroll = document.querySelector("#iuTermsGateMain .iuTermsGate__scroll");
          const read = document.getElementById("iuTermsReadBtn");
          const readText = read ? (read.textContent || "").trim() : "";
          return {
            scrollTop: scroll ? scroll.scrollTop : -1,
            accepted: localStorage.getItem("iu:terms:accepted:v1"),
            readOk: readText === "Přečíst GDPR a Všeobecné obchodní podmínky",
          };
        });
        must(againState.scrollTop === 0, "rt:again_scroll_top");
        must(againState.accepted !== "1", "rt:again_no_accept");
        must(againState.readOk, "rt:again_read_btn_intact");
        await ctx.close();
      }

      // D: old version + requiresReacceptance → show again
      {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await forceTermsGate(ctx);
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
        await forceTermsGate(ctx);
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
