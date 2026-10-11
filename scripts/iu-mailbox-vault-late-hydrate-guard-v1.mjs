#!/usr/bin/env node
/**
 * Hypothesis check: if iu-vault-hydrated fired before iuMailboxesInit, Add stayed hidden.
 * Post-fix: __iuVaultHydrationComplete triggers re-render; dispatching hydrated again must not duplicate listeners.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { pickGuardPort, startGuardStaticServer, stopGuardProcess } from "./guards/guard-playwright-lifecycle.mjs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

async function main() {
  const started = await startGuardStaticServer(pickGuardPort(9460, 400));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.removeItem("iu_mailboxes_v1");
    } catch (_) {}
  });
  const page = await ctx.newPage();
  await page.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForVaultReady(page, 120000);
  await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });

  const sim = await page.evaluate(() => {
    const add = document.getElementById("iuMailboxAdd");
    if (add) add.style.display = "none";
    const clicksBefore = window.__iuMailboxAddClickCount || 0;
    window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
    window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
    const st = add ? getComputedStyle(add) : null;
    return {
      addDisplay: st ? st.display : "",
      initDone: window.__iuMailboxesInitDone === 1,
    };
  });

  await page.evaluate(async () => {
    if (typeof window.__iuEnsureFeedPipeline === "function") await window.__iuEnsureFeedPipeline();
    if (typeof window.iuArticleActionsOpenOverlay === "function") await window.iuArticleActionsOpenOverlay();
  });
  await page.waitForFunction(() => window.__iuMailboxesInitDone === 1, null, { timeout: 90000 });

  const after = await page.evaluate(() => {
    const add = document.getElementById("iuMailboxAdd");
    const st = add ? getComputedStyle(add) : null;
    const rows = document.querySelectorAll("#iuMailboxList .iu-mailbox-row").length;
    let vis = 0;
    try {
      const p = JSON.parse(localStorage.getItem("iu_mailboxes_v1") || "{}");
      vis = (p.items || []).filter((x) => !x.hidden).length;
    } catch (_) {}
    return {
      addDisplay: st ? st.display : "",
      rows,
      vis,
    };
  });

  await browser.close();
  await stopGuardProcess(started.proc);

  const pass =
    sim.initDone === true &&
    (after.addDisplay === "inline" || after.addDisplay === "inline-block") &&
    after.rows >= 4 &&
    after.vis < 10;
  console.log("IU_MAILBOX_LATE_HYDRATE_SIM=" + JSON.stringify({ sim, after }));
  console.log("IU_MAILBOX_VAULT_LATE_HYDRATE_PASS=" + pass);
  if (!pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
