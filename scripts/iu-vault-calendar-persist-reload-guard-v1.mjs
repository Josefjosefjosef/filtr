#!/usr/bin/env node
/**
 * Calendar UI save must durable-commit (form/inline ACK) and survive reload.
 * Repro: form save while persist blocked must NOT claim success / keep memory;
 * hydrated create → reload → SAME via calendarCreateEvent + form path.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import fs from "fs";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium, firefox, webkit } = require("playwright");

const KEY = "iu.calendar.store.v1";
const PIN = "847291";

function staticChecks(fails) {
  const cal = fs.readFileSync(path.join(REPO, "assets", "iu-calendar-overlay-v1.js"), "utf8");
  if (!/isCalendarReadOpaque/.test(cal)) fails.push("static_missing_opaque_read");
  if (!/calendarPersistFailMessage/.test(cal)) fails.push("static_missing_persist_fail_msg");
  if (!/prevSnapshot/.test(cal)) fails.push("static_missing_form_rollback");
  if (/indexedDB\.open\(CAL_NS \+ "\.idb"/.test(cal)) fails.push("static_legacy_idb_open_still_present");
  if (!/iu-calendar-persist-ack-v1-20260830/.test(fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8"))) {
    fails.push("static_app_cal_url_cache_bust_missing");
  }
}

async function ensureCal(page) {
  await page.evaluate(async () => {
    await window.__iuEnsureCalendarOverlay();
  });
  await page.waitForFunction(
    () =>
      window.iuCalendarService &&
      !window.iuCalendarService.__iuCalendarLazyStub &&
      typeof window.iuCalendarService.calendarCreateEvent === "function",
    null,
    { timeout: 60000 }
  );
}

async function markerState(page, marker) {
  return page.evaluate(async ({ KEY, marker }) => {
    const out = { sync: false, idb: false, mem: false, msg: "" };
    try {
      out.sync = String(localStorage.getItem(KEY) || "").includes(marker);
    } catch (_) {}
    try {
      const { readRecord } = await import("/assets/iu-vault-db-v1.js");
      const { decryptString } = await import("/assets/iu-vault-core-v1.js");
      const { getMdk } = await import("/assets/iu-vault-lock-v1.js");
      const env = await readRecord(KEY);
      if (env) {
        const pt = await decryptString(getMdk(), KEY, env);
        out.idb = String(pt || "").includes(marker);
      }
    } catch (_) {}
    try {
      const ev = window.iuCalendarService.calendarGetEventsSnapshot() || [];
      out.mem = ev.some((e) => e && String(e.title || "").includes(marker));
    } catch (_) {}
    try {
      out.msg = String((document.getElementById("iuCalendarFormMsg") || {}).textContent || "");
    } catch (_) {}
    return out;
  }, { KEY, marker });
}

async function createApi(page, marker) {
  return page.evaluate(async ({ marker }) => {
    const t = new Date();
    const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    return window.iuCalendarService.calendarCreateEvent({
      date,
      time: "10:45",
      title: marker,
      note: "g",
      type: "personal",
      allDay: false,
      attachments: [],
    });
  }, { marker });
}

async function formSave(page, marker) {
  return page.evaluate(async ({ marker }) => {
    window.iuCalendarService.openOverlay();
    await new Promise((r) => setTimeout(r, 80));
    const form = document.getElementById("iuCalendarEventForm");
    if (!form) return { ok: false, reason: "no_form" };
    const t = new Date();
    const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    form.elements.id.value = "";
    form.elements.date.value = date;
    form.elements.time.value = "16:20";
    form.elements.title.value = marker;
    if (form.elements.note) form.elements.note.value = "form";
    if (form.elements.type) form.elements.type.value = "personal";
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    const msg = String((document.getElementById("iuCalendarFormMsg") || {}).textContent || "");
    const mem = (window.iuCalendarService.calendarGetEventsSnapshot() || []).some((e) =>
      String(e && e.title || "").includes(marker)
    );
    return { ok: true, msg, mem };
  }, { marker });
}

async function runEngine(browserType, name, base) {
  const fails = [];
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
  } catch (e) {
    return { name, fails: [], skipped: `launch:${String(e && e.message ? e.message : e)}` };
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
    localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
  });
  const page = await context.newPage();
  const marker = `IU_CAL_TEST_${Date.now()}_${name}`;
  try {
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page, 90000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await ensureCal(page);

    // A) Form save while persist blocked must NOT claim durable success
    const blocked = await page.evaluate(async ({ marker }) => {
      window.__iuVaultHydrationPending = true;
      window.iuCalendarService.openOverlay();
      await new Promise((r) => setTimeout(r, 80));
      const form = document.getElementById("iuCalendarEventForm");
      if (!form) {
        window.__iuVaultHydrationPending = false;
        return { ok: false, reason: "no_form" };
      }
      const t = new Date();
      const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      form.elements.id.value = "";
      form.elements.date.value = date;
      form.elements.time.value = "15:10";
      form.elements.title.value = marker + "_BLOCKED";
      if (form.elements.type) form.elements.type.value = "personal";
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 500));
      const msg = String((document.getElementById("iuCalendarFormMsg") || {}).textContent || "");
      const mem = (window.iuCalendarService.calendarGetEventsSnapshot() || []).some((e) =>
        String(e && e.title || "").includes(marker + "_BLOCKED")
      );
      window.__iuVaultHydrationPending = false;
      const { readRecord } = await import("/assets/iu-vault-db-v1.js");
      const { decryptString } = await import("/assets/iu-vault-core-v1.js");
      const { getMdk } = await import("/assets/iu-vault-lock-v1.js");
      const env = await readRecord("iu.calendar.store.v1");
      let idb = false;
      try {
        const pt = env ? await decryptString(getMdk(), "iu.calendar.store.v1", env) : "";
        idb = String(pt).includes(marker + "_BLOCKED");
      } catch (_) {}
      return { ok: true, msg, mem, idb };
    }, { marker });
    if (!blocked.ok) fails.push(`${name}_A_no_form`);
    if (blocked.msg === "Uloženo.") fails.push(`${name}_A_false_ulozeno`);
    if (blocked.mem) fails.push(`${name}_A_mem_kept_after_blocked`);
    if (blocked.idb) fails.push(`${name}_A_idb_wrote_while_blocked`);

    // B) SECURITY OFF create → reload → SAME
    const mB = marker + "_OFF";
    const cB = await createApi(page, mB);
    if (!cB || !cB.ok) fails.push(`${name}_B_create_fail`);
    await page.evaluate(async () => {
      await window.iuVault.flushPendingWrites();
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page, 90000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await ensureCal(page);
    await new Promise((r) => setTimeout(r, 300));
    let st = await markerState(page, mB);
    if (!(st.idb && st.mem)) fails.push(`${name}_B_reload_lost:${JSON.stringify(st)}`);

    // C) Form save after hydrate → reload → SAME
    const mC = marker + "_FORM";
    const form = await formSave(page, mC);
    if (!form.ok) fails.push(`${name}_C_form_missing`);
    if (form.msg !== "Uloženo.") fails.push(`${name}_C_form_msg:${form.msg}`);
    st = await markerState(page, mC);
    if (!(st.idb && st.mem)) fails.push(`${name}_C_form_not_durable:${JSON.stringify(st)}`);
    await page.evaluate(async () => {
      await window.iuVault.flushPendingWrites();
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page, 90000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await ensureCal(page);
    await new Promise((r) => setTimeout(r, 300));
    st = await markerState(page, mC);
    if (!(st.idb && st.mem)) fails.push(`${name}_C_form_reload_lost:${JSON.stringify(st)}`);

    // D) PIN: pre event → setupPin → unlock → SAME; post event → reload unlock → SAME
    const mPre = marker + "_PRE";
    const mPost = marker + "_POST";
    const cPre = await createApi(page, mPre);
    if (!cPre || !cPre.ok) fails.push(`${name}_D_pre_create`);
    await page.evaluate(async () => {
      await window.iuVault.flushPendingWrites();
    });
    const pinRes = await page.evaluate(async ({ PIN }) => {
      try {
        await window.iuVault.setupPin(PIN, PIN);
        return { ok: true };
      } catch (e) {
        return { ok: false, err: String(e && e.message ? e.message : e) };
      }
    }, { PIN });
    if (!pinRes.ok) fails.push(`${name}_D_setupPin:${pinRes.err}`);
    else {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(() => window.iuVault && window.iuVault.unlockPin, null, { timeout: 60000 });
      await page.evaluate(async ({ PIN }) => {
        await window.iuVault.unlockPin(PIN);
        if (typeof window.iuVault.afterUnlock === "function") await window.iuVault.afterUnlock();
      }, { PIN });
      await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
      await ensureCal(page);
      await new Promise((r) => setTimeout(r, 400));
      st = await markerState(page, mPre);
      if (!(st.idb && st.mem)) fails.push(`${name}_D_pre_lost:${JSON.stringify(st)}`);
      const cPost = await createApi(page, mPost);
      if (!cPost || !cPost.ok) fails.push(`${name}_D_post_create`);
      await page.evaluate(async () => {
        await window.iuVault.flushPendingWrites();
      });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(() => window.iuVault && window.iuVault.unlockPin, null, { timeout: 60000 });
      await page.evaluate(async ({ PIN }) => {
        await window.iuVault.unlockPin(PIN);
        if (typeof window.iuVault.afterUnlock === "function") await window.iuVault.afterUnlock();
      }, { PIN });
      await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
      await ensureCal(page);
      await new Promise((r) => setTimeout(r, 400));
      const pre = await markerState(page, mPre);
      const post = await markerState(page, mPost);
      if (!(pre.idb && pre.mem)) fails.push(`${name}_D_pre_after:${JSON.stringify(pre)}`);
      if (!(post.idb && post.mem)) fails.push(`${name}_D_post_after:${JSON.stringify(post)}`);
    }

    // E) Control: notes still writable
    const noteMarker = marker + "_NOTE";
    const noteOk = await page.evaluate(async ({ noteMarker }) => {
      const payload = JSON.stringify({
        schemaVersion: 1,
        notes: [{ id: "n1", title: noteMarker, body: "b", tags: [], createdAt: 1, updatedAt: 1 }],
      });
      await window.iuVault.durableSet("iu.notes.store.v1", payload);
      await window.iuVault.flushPendingWrites();
      const raw = localStorage.getItem("iu.notes.store.v1") || "";
      return raw.includes(noteMarker);
    }, { noteMarker });
    if (!noteOk) fails.push(`${name}_E_notes_control_fail`);

    return { name, fails, skipped: null };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const fails = [];
  staticChecks(fails);
  if (fails.length) {
    console.log(JSON.stringify({ pass: false, fails }, null, 2));
    process.exit(2);
  }
  const started = await startGuardStaticServer(pickGuardPort(9800, 300));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const results = [];
  try {
    const engines = [
      [chromium, "chromium"],
      [firefox, "firefox"],
      [webkit, "webkit"],
    ];
    for (const [bt, name] of engines) {
      try {
        results.push(await runEngine(bt, name, base));
      } catch (e) {
        results.push({ name, fails: [`engine_error:${String(e && e.message ? e.message : e)}`], skipped: null });
      }
    }
    const hard = [];
    for (const r of results) {
      if (r.name === "chromium") hard.push(...r.fails);
      else if (r.skipped) {
        /* soft-skip missing browser */
      } else hard.push(...r.fails);
    }
    const pass = hard.length === 0;
    console.log(JSON.stringify({ pass, results, hard }, null, 2));
    process.exit(pass ? 0 : 2);
  } finally {
    await stopGuardProcess(started.proc).catch(() => {});
  }
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
