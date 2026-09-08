#!/usr/bin/env node
/**
 * Guard: MindMenu "Zamknout InfoUzel" opens existing iCentrum security settings.
 * Run: npm run iu-mindmenu-lock-infouzel-security-entry-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const feed = fs.readFileSync(path.join(ROOT, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  const mobileCss = fs.readFileSync(path.join(ROOT, "assets", "iu-mindmenu-mobile-tablet-v61.css"), "utf8");
  const deskCss = fs.readFileSync(path.join(ROOT, "assets", "iu-myinfouzel-premium-overlay.css"), "utf8");
  const infoCss = fs.readFileSync(path.join(ROOT, "assets", "iu-info-center.css"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");

  ok("feed:open_privacy", /iuInfoCenterOpenSection\(["']privacy["']\)/.test(feed));
  ok("feed:no_duplicate_vault_ui", !/Aktivovat zabezpečení InfoUzlu/.test(feed));
  ok("feed:mobile_markup", /iuMmLockInfoUzelBtn--mobile/.test(feed) && /Zamknout[\s\S]{0,40}InfoUzel/.test(feed));
  ok("feed:desktop_markup", /iuMmLockInfoUzelBtn--desktop/.test(feed) && /🔒/.test(feed));
  ok("feed:aria_label", /aria-label="Zamknout InfoUzel"/.test(feed));
  ok("feed:ensure_mobile", /data-iu-mm-lock-infouzel/.test(feed) && /iuMobileGateEnsureInfoButtons/.test(feed));
  ok("feed:ensure_desktop", /iuMyInfoUzelEnsureLockBtn/.test(feed));
  ok("css:mobile_grid_lock", /iuMmLockInfoUzelBtn--mobile/.test(mobileCss) && /grid-column:\s*1/.test(mobileCss));
  ok("css:desktop_btn", /iuMmLockInfoUzelBtn--desktop/.test(deskCss));
  ok("css:two_line_mobile", /iuMmLockInfoUzelBtn__line/.test(mobileCss));
  ok(
    "css:pc_privacy_above_mindmenu",
    /@media\s*\(\s*min-width:\s*1025px\s*\)[\s\S]{0,400}body\.iu-myinfouzel-open\s+\.iuInfoCenterV2\.iuTopbarInfoOverlay:not\(\[hidden\]\)\s*\{[\s\S]{0,80}z-index:\s*12200/.test(
      infoCss
    )
  );
  ok(
    "css:mobile_info_center_not_raised_with_myinfouzel",
    !/@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]{0,800}body\.iu-myinfouzel-open\s+\.iuInfoCenterV2/.test(infoCss)
  );
  ok(
    "index:info_center_css_cache",
    /iu-info-center\.css\?v=pc-mindmenu-privacy-stack-v1-20260908/.test(index)
  );
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

async function dismissConsent(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
    const b = document.getElementById("iuConsentAllowStats");
    if (b) b.click();
    const layer = document.getElementById("iuConsentLayer");
    if (layer) layer.remove();
  });
}

async function ensureFeed(page) {
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureFeedPipeline === "function") {
      try {
        await window.__iuEnsureFeedPipeline();
      } catch (_) {}
    }
  });
}

async function openMobileTools(page) {
  await page.waitForFunction(
    () => {
      const wrap = document.getElementById("iuMobileGateWrap");
      return !!(wrap && typeof wrap.__iuMobileGateSetTab === "function");
    },
    null,
    { timeout: 60000 }
  );
  await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    if (wrap && typeof wrap.__iuMobileGateSetTab === "function") wrap.__iuMobileGateSetTab("tools");
    else {
      const tab = document.getElementById("iuMobileGateTabTools");
      if (tab) tab.click();
    }
  });
  await page.waitForFunction(
    () => {
      const panel = document.getElementById("iuMobileGatePanelTools");
      const flow = document.getElementById("iuMobileMindMenuFlow");
      const head = document.querySelector("#iuMobileGatePanelTools section.iu-mailboxes .iu-mmSectionHead");
      return !!(panel && flow && panel.contains(flow) && head);
    },
    null,
    { timeout: 60000 }
  );
  await page.evaluate(() => {
    if (typeof window.iuMobileGateEnsureInfoButtons === "function") window.iuMobileGateEnsureInfoButtons();
    else if (typeof window.iuMobileGateReorder === "function") window.iuMobileGateReorder();
  });
  await page.waitForSelector("#iuMobileGatePanelTools [data-iu-mm-lock-infouzel]", { timeout: 30000 });
}

async function openDesktopMindMenu(page) {
  await page.waitForFunction(
    () =>
      typeof window.iuArticleActionsOpenOverlay === "function" ||
      !!document.getElementById("iuMyInfoUzelOpenBtn"),
    null,
    { timeout: 60000 }
  );
  await page.evaluate(async () => {
    if (typeof window.iuArticleActionsOpenOverlay === "function") {
      try {
        await window.iuArticleActionsOpenOverlay();
      } catch (_) {}
    } else {
      const btn = document.getElementById("iuMyInfoUzelOpenBtn");
      if (btn) btn.click();
    }
  });
  await page.waitForSelector("#iuMyInfoUzelOverlay:not([hidden])", { timeout: 45000 });
  await page.evaluate(() => {
    if (typeof window.iuMyInfoUzelEnsureLockBtn === "function") {
      try {
        window.iuMyInfoUzelEnsureLockBtn(document.getElementById("iuMyInfoUzelOverlay"));
      } catch (_) {}
    }
  });
  await page.waitForSelector("#iuMyInfoUzelOverlay [data-iu-mm-lock-infouzel]", { timeout: 30000 });
}

auditStatic();
if (fails.length) {
  console.log(JSON.stringify({ IU_MINDMENU_LOCK_INFOUZEL_SECURITY_ENTRY_GUARD: "FAIL", phase: "static", fails }, null, 2));
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8943", 10);
const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const fp = path.join(ROOT, p.replace(/^\/+/, ""));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const mime =
      fp.endsWith(".css")
        ? "text/css; charset=utf-8"
        : fp.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : fp.endsWith(".html")
            ? "text/html; charset=utf-8"
            : "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(fs.readFileSync(fp));
  } catch (_) {
    res.writeHead(500);
    res.end("err");
  }
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
await waitForPort("127.0.0.1", PORT, 10000);

const browser = await chromium.launch({ headless: true });
try {
  {
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await bootstrapGuardPage(context);
    await page.goto(`http://127.0.0.1:${PORT}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await dismissConsent(page);
    await ensureFeed(page);
    await page.waitForFunction(() => typeof window.iuMobileGateEnsureInfoButtons === "function", null, {
      timeout: 90000,
    });
    await openMobileTools(page);

    const lockBtn = page.locator("#iuMobileGatePanelTools [data-iu-mm-lock-infouzel]");
    ok("mobile:btn_present", (await lockBtn.count()) > 0);
    if ((await lockBtn.count()) > 0) {
      const label = await lockBtn.getAttribute("aria-label");
      ok("mobile:aria", label === "Zamknout InfoUzel");
      const twoLine = await lockBtn.evaluate((el) => {
        const lines = el.querySelectorAll(".iuMmLockInfoUzelBtn__line");
        return (
          lines.length === 2 &&
          (lines[0].textContent || "").trim() === "Zamknout" &&
          (lines[1].textContent || "").trim() === "InfoUzel"
        );
      });
      ok("mobile:two_line_visual", twoLine);
      await lockBtn.click({ force: true });
      await page.waitForTimeout(1200);
      const snap = await page.evaluate(() => {
        const overlay = document.getElementById("iuTopbarInfoOverlay");
        const privacy = document.querySelector('[data-iu-info-section="privacy"]');
        return {
          overlayOpen: !!(overlay && !overlay.hidden),
          privacyVisible: !!(privacy && !privacy.hidden),
        };
      });
      ok("mobile:opens_privacy", snap.overlayOpen && snap.privacyVisible, JSON.stringify(snap));
      ok("mobile:existing_vault_or_section", snap.privacyVisible);
    }
    const overflow = await page.evaluate(() => {
      const head = document.querySelector("#iuMobileGatePanelTools .iu-mmSectionHead--gateInfo");
      if (!head) return false;
      return head.scrollWidth > head.clientWidth + 1;
    });
    ok("mobile:no_h_overflow", !overflow);
    await context.close();
  }

  {
    const context = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 } });
    const page = await bootstrapGuardPage(context);
    await page.goto(`http://127.0.0.1:${PORT}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await dismissConsent(page);
    await ensureFeed(page);
    await page.waitForFunction(() => typeof window.iuOpenInfoCenterSecuritySettings === "function", null, {
      timeout: 90000,
    });
    await openDesktopMindMenu(page);

    const deskBtn = page.locator("#iuMyInfoUzelOverlay [data-iu-mm-lock-infouzel]");
    ok("desktop:btn_present", (await deskBtn.count()) > 0);
    if ((await deskBtn.count()) > 0) {
      const txt = await deskBtn.innerText();
      ok("desktop:text_one_line", /Zamknout InfoUzel/.test(txt));
      await deskBtn.click({ force: true });
      await page.waitForTimeout(1200);
      const snap = await page.evaluate(() => {
        const overlay = document.getElementById("iuTopbarInfoOverlay");
        const privacy = document.getElementById("iuInfoCenterDetailPrivacy");
        const mind = document.getElementById("iuMyInfoUzelOverlay");
        const panel = overlay && overlay.querySelector(".iuTopbarInfoOverlay__panel");
        const backdrop = overlay && overlay.querySelector(".iuTopbarInfoOverlay__backdrop");
        const zOf = (el) => {
          if (!el) return null;
          const z = getComputedStyle(el).zIndex;
          const n = Number(z);
          return Number.isFinite(n) ? n : z;
        };
        const mindZ = zOf(mind);
        const infoZ = zOf(overlay);
        let hit = null;
        if (panel) {
          const r = panel.getBoundingClientRect();
          const x = Math.min(window.innerWidth - 2, Math.max(2, r.left + Math.min(40, r.width / 2)));
          const y = Math.min(window.innerHeight - 2, Math.max(2, r.top + Math.min(40, r.height / 2)));
          const topEl = document.elementFromPoint(x, y);
          hit = {
            inInfo: !!(topEl && overlay.contains(topEl)),
            inMind: !!(topEl && mind && mind.contains(topEl) && !(overlay && overlay.contains(topEl))),
            tag: topEl ? topEl.tagName : null,
          };
        }
        const unlockChoices = [...document.querySelectorAll('#iuInfoCenterDetailPrivacy input[type="radio"], #iuInfoCenterDetailPrivacy [name="iuVaultMindMenuMethod"], #iuVaultMindMenuMethodNone, #iuVaultMindMenuMethodDevice, #iuVaultMindMenuMethodPin')];
        const back = document.querySelector('#iuTopbarInfoOverlay [data-iu-info-back], #iuTopbarInfoOverlay [data-act="info-back"], .iuInfoCenter__backBtn');
        const close = document.getElementById("iuTopbarInfoOverlayClose");
        return {
          overlayOpen: !!(overlay && !overlay.hidden),
          privacyVisible: !!(privacy && !privacy.hidden),
          mindOpen: !!(mind && !mind.hidden && document.body.classList.contains("iu-myinfouzel-open")),
          mindZ,
          infoZ,
          infoAboveMind: typeof infoZ === "number" && typeof mindZ === "number" ? infoZ > mindZ : null,
          hit,
          hasBackdrop: !!(backdrop && getComputedStyle(backdrop).display !== "none"),
          unlockUiCount: unlockChoices.length,
          hasBack: !!back,
          hasClose: !!close,
        };
      });
      ok("desktop:opens_privacy", snap.overlayOpen && snap.privacyVisible, JSON.stringify(snap));
      ok("desktop:mindmenu_still_open_under", snap.mindOpen === true);
      ok("desktop:info_z_above_mind", snap.infoAboveMind === true, JSON.stringify({ mindZ: snap.mindZ, infoZ: snap.infoZ }));
      ok("desktop:hit_info_not_mind", snap.hit && snap.hit.inInfo === true && snap.hit.inMind !== true, JSON.stringify(snap.hit));
      ok("desktop:backdrop_present", snap.hasBackdrop === true);
      ok("desktop:unlock_ui_present", snap.unlockUiCount >= 1, String(snap.unlockUiCount));
      ok("desktop:close_present", snap.hasClose === true);

      // Close via × then reopen — no duplicate overlays.
      await page.locator("#iuTopbarInfoOverlayClose").click({ force: true });
      await page.waitForTimeout(500);
      const closed = await page.evaluate(() => {
        const overlay = document.getElementById("iuTopbarInfoOverlay");
        return {
          overlayHidden: !overlay || overlay.hidden,
          mindOpen: document.body.classList.contains("iu-myinfouzel-open"),
          infoCount: document.querySelectorAll("#iuTopbarInfoOverlay, .iuInfoCenterV2.iuTopbarInfoOverlay").length,
        };
      });
      ok("desktop:close_x_returns_mindmenu", closed.overlayHidden && closed.mindOpen, JSON.stringify(closed));
      ok("desktop:no_duplicate_info_root", closed.infoCount <= 1, String(closed.infoCount));

      await page.locator("#iuMyInfoUzelOverlay [data-iu-mm-lock-infouzel]").click({ force: true });
      await page.waitForTimeout(1000);
      const reopen = await page.evaluate(() => {
        const overlay = document.getElementById("iuTopbarInfoOverlay");
        const mind = document.getElementById("iuMyInfoUzelOverlay");
        const panel = overlay && overlay.querySelector(".iuTopbarInfoOverlay__panel");
        let hitOk = false;
        if (panel && overlay && !overlay.hidden) {
          const r = panel.getBoundingClientRect();
          const topEl = document.elementFromPoint(
            Math.min(window.innerWidth - 2, Math.max(2, r.left + 24)),
            Math.min(window.innerHeight - 2, Math.max(2, r.top + 24))
          );
          hitOk = !!(topEl && overlay.contains(topEl));
        }
        const infoZ = Number(getComputedStyle(overlay).zIndex);
        const mindZ = Number(getComputedStyle(mind).zIndex);
        return {
          open: !!(overlay && !overlay.hidden),
          hitOk,
          above: infoZ > mindZ,
          roots: document.querySelectorAll("#iuTopbarInfoOverlay").length,
        };
      });
      ok("desktop:reopen_above_mind", reopen.open && reopen.above && reopen.hitOk, JSON.stringify(reopen));
      ok("desktop:reopen_no_dup", reopen.roots === 1, String(reopen.roots));

      // Back navigation if present
      const backBtn = page.locator(
        '#iuTopbarInfoOverlay [data-iu-info-back], #iuTopbarInfoOverlay .iuInfoCenter__backBtn, #iuTopbarInfoOverlay [aria-label*="Zpět"]'
      );
      if ((await backBtn.count()) > 0) {
        await backBtn.first().click({ force: true });
        await page.waitForTimeout(600);
        const afterBack = await page.evaluate(() => {
          const overlay = document.getElementById("iuTopbarInfoOverlay");
          const view = overlay && overlay.getAttribute("data-iu-info-view");
          return {
            mindOpen: document.body.classList.contains("iu-myinfouzel-open"),
            view,
            privacyHidden: (() => {
              const p = document.getElementById("iuInfoCenterDetailPrivacy");
              return !p || p.hidden;
            })(),
          };
        });
        ok(
          "desktop:back_keeps_mindmenu",
          afterBack.mindOpen === true,
          JSON.stringify(afterBack)
        );
      }
    }
    await context.close();
  }
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      IU_MINDMENU_LOCK_INFOUZEL_SECURITY_ENTRY_GUARD: pass ? "PASS" : "FAIL",
      fails,
      REAL_IOS: "NOT_TESTED",
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
