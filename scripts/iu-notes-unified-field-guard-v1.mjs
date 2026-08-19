#!/usr/bin/env node
/**
 * Guard: Notes unified single field (title+content merge, Silver save, card preview).
 * Run: npm run iu-notes-unified-field-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/ npm run iu-notes-unified-field-guard
 */
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SCRIPT = path.join(REPO, "server", "projects-static.mjs");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8925", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const STORE_KEY = "iu.notes.store.v1";

const VIEWPORTS = [
  { w: 390, h: 844, label: "mobile" },
  { w: 768, h: 1024, label: "tablet" },
  { w: 1280, h: 900, label: "pc" },
];

const MERGE_CASES = [
  { id: "A", title: "Adam narozeniny 26.6.", content: "Adam narozeniny 26.6.", expect: "Adam narozeniny 26.6." },
  { id: "B", title: "Adam narozeniny 26.6.", content: "", expect: "Adam narozeniny 26.6." },
  { id: "C", title: "Adam narozeniny 26.6.", content: "Koupit dort.", expect: "Adam narozeniny 26.6.\n\nKoupit dort." },
  {
    id: "D",
    title: "Adam narozeniny 26.6.",
    content: "Adam narozeniny 26.6.\n\nKoupit dort.",
    expect: "Adam narozeniny 26.6.\n\nKoupit dort.",
  },
  { id: "E", title: "", content: "Koupit dort.", expect: "Koupit dort." },
];

function fail(msg) {
  return { ok: false, msg };
}

async function preparePage(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureNotesOverlay === "function") {
      await window.__iuEnsureNotesOverlay();
    }
  });
  await page.waitForFunction(() => {
    return (
      window.iuNotesStorage &&
      typeof window.iuNotesStorage.noteMergeLegacyToBody === "function" &&
      typeof window.iuNotesStorage.noteCardHeadingAndPreview === "function"
    );
  }, null, { timeout: 60000 });
  await page.waitForTimeout(500);
}

async function testMergeCases(page) {
  const results = await page.evaluate((cases) => {
    const st = window.iuNotesStorage;
    if (!st || typeof st.noteMergeLegacyToBody !== "function") return { ok: false, msg: "missing iuNotesStorage helpers" };
    const out = [];
    for (const c of cases) {
      const got = st.noteMergeLegacyToBody(c.title, c.content);
      out.push({ id: c.id, pass: got === c.expect, got, expect: c.expect });
    }
    return { ok: out.every((x) => x.pass), out };
  }, MERGE_CASES);
  return results;
}

async function testCardPreview(page) {
  return page.evaluate(() => {
    const st = window.iuNotesStorage;
    const dup = st.noteCardHeadingAndPreview({ title: "Adam narozeniny 26.6.", content: "Adam narozeniny 26.6." });
    const multi = st.noteCardHeadingAndPreview({
      title: "Adam narozeniny 26.6.",
      content: "Adam narozeniny 26.6.\n\nKoupit dort.\nZavolat rodičům.",
    });
    const single = st.noteCardHeadingAndPreview({ title: "Jen jeden řádek", content: "Jen jeden řádek" });
    return {
      ok:
        dup.heading === "Adam narozeniny 26.6." &&
        dup.preview === "" &&
        multi.heading === "Adam narozeniny 26.6." &&
        multi.preview === "Koupit dort. Zavolat rodičům." &&
        single.heading === "Jen jeden řádek" &&
        single.preview === "",
      dup,
      multi,
      single,
    };
  });
}

async function testSilverSaveNoDup(page) {
  const text = "Adam narozeniny 26.6.\n\nKoupit dort.\nZavolat rodičům.";
  return page.evaluate(({ key, body }) => {
    const svc = window.iuNotesService;
    if (!svc || typeof svc.notesSaveSilverDraft !== "function") return { ok: false, msg: "missing notesSaveSilverDraft" };
    try {
      localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, notes: [] }));
    } catch (_) {}
    const res = svc.notesSaveSilverDraft({ text: body });
    if (!res || !res.ok || !res.note) return { ok: false, msg: "save failed", res };
    const n = res.note;
    const st = window.iuNotesStorage;
    const merged = st.noteBodyFromNote(n);
    const card = st.noteCardHeadingAndPreview(n);
    const dupTitleContent = String(n.title || "").trim() === String(n.content || "").trim();
    return {
      ok: !dupTitleContent && merged === body && card.heading === "Adam narozeniny 26.6." && card.preview.includes("Koupit dort"),
      note: n,
      merged,
      card,
      dupTitleContent,
    };
  }, { key: STORE_KEY, body: text });
}

async function testUnifiedFormUi(page, vp) {
  const seedPayload = {
    schemaVersion: 1,
    notes: [
      {
        id: "guard_note_1",
        title: "Adam narozeniny 26.6.",
        content: "Adam narozeniny 26.6.\n\nKoupit dort.",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        tags: [],
        deleted: false,
      },
    ],
  };
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.addInitScript(({ key, payload }) => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (_) {}
  }, { key: STORE_KEY, payload: seedPayload });
  // Notes overlay does not need info-system cutover; keep feed.json hydrate off on CI.
  const url = BASE.includes("?")
    ? BASE + "&iuInfoSystem=off&nosw=1"
    : BASE + "?iuInfoSystem=off&nosw=1";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureNotesOverlay === "function") {
      await window.__iuEnsureNotesOverlay();
    }
  });
  await page.waitForFunction(() => typeof window.iuNotesService?.openOverlay === "function" && !window.iuNotesService.__iuNotesLazyStub, null, { timeout: 60000 });
  await page.evaluate(() => {
    if (window.iuNotesService && typeof window.iuNotesService.openOverlay === "function") {
      window.iuNotesService.openOverlay();
    }
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const btn = document.querySelector('.iu-notesOverlay__itemBtn[data-iu-note-id="guard_note_1"]');
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForFunction(() => !!document.getElementById("iuNoteBody"), null, { timeout: 15000 });
  const ui = await page.evaluate(() => {
    const body = document.getElementById("iuNoteBody");
    const title = document.getElementById("iuNoteTitle");
    const content = document.getElementById("iuNoteContent");
    const preview = document.querySelector('[data-iu-note-id="guard_note_1"] [data-iu-note-preview]');
    const titleEl = document.querySelector('[data-iu-note-id="guard_note_1"] .iu-notesOverlay__itemTitle');
    return {
      hasBody: !!body,
      noTitleField: !title,
      noContentField: !content,
      bodyText: body ? String(body.value || "") : "",
      previewText: preview ? String(preview.textContent || "") : "",
      cardTitle: titleEl ? String(titleEl.textContent || "") : "",
    };
  });
  const ok =
    ui.hasBody &&
    ui.noTitleField &&
    ui.noContentField &&
    ui.bodyText.includes("Koupit dort") &&
    ui.cardTitle === "Adam narozeniny 26.6." &&
    ui.previewText === "Koupit dort." &&
    !ui.previewText.includes("Adam narozeniny");
  return { label: vp.label, ok, ui };
}

async function main() {
  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const tick = () => {
        const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
          else if (Date.now() >= deadline) reject(new Error("server not ready"));
          else setTimeout(tick, 300);
        });
        req.on("error", () => {
          if (Date.now() >= deadline) reject(new Error("server not ready"));
          else setTimeout(tick, 300);
        });
      };
      tick();
    });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];
  const passes = [];

  try {
    await preparePage(page);

    const merge = await testMergeCases(page);
    if (merge.ok) passes.push("merge_cases_A_E");
    else failures.push({ test: "merge_cases_A_E", detail: merge });

    const card = await testCardPreview(page);
    if (card.ok) passes.push("card_preview_no_dup");
    else failures.push({ test: "card_preview_no_dup", detail: card });

    const silver = await testSilverSaveNoDup(page);
    if (silver.ok) passes.push("silver_save_no_dup");
    else failures.push({ test: "silver_save_no_dup", detail: silver });

    for (const vp of VIEWPORTS) {
      const ui = await testUnifiedFormUi(page, vp);
      if (ui.ok) passes.push("ui_" + vp.label);
      else failures.push({ test: "ui_" + vp.label, detail: ui });
    }
  } finally {
    await browser.close();
    if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
  }

  const pass = failures.length === 0;
  const out = {
    pass,
    base: BASE,
    passes: passes.length,
    failures,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
