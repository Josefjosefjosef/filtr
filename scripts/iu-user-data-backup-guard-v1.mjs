#!/usr/bin/env node
/**
 * InfoUzel user data backup — unit + Playwright guard (5× export cycles).
 * Run: npm run iu-user-data-backup-guard
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  exportBackupJson,
  parseBackupJson,
  verifyBackupIntegrity,
  applyBackupReplaceMode,
  storageSnapshotsEqual,
  assertSafeJsonValue,
  userMessageForError,
} from "../assets/iu-user-data-backup-core.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const INDEX = path.join(REPO, "projects", "index.html");
const CORE = path.join(REPO, "assets", "iu-user-data-backup-core.mjs");
const UI = path.join(REPO, "assets", "iu-user-data-backup-ui-v1.mjs");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8944", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CYCLES = 5;

function createMockStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return Array.from(map.keys());
    },
    dump() {
      return new Map(map);
    },
  };
}

function cloneFromStorage(storage) {
  const seed = {};
  for (const key of storage.keys()) seed[key] = storage.getItem(key);
  return createMockStorage(seed);
}

async function runUnitTests() {
  const results = [];
  const subtle = globalThis.crypto && globalThis.crypto.subtle ? globalThis.crypto.subtle : undefined;

  function pass(id) {
    results.push({ id, pass: true });
  }
  function fail(id, err) {
    results.push({ id, pass: false, err: String(err && err.message ? err.message : err) });
  }

  try {
    const storage = createMockStorage({
      "iu.notes.store.v1": JSON.stringify({ schemaVersion: 1, notes: [{ id: "n1", title: "Test 🎉", body: "Ahoj\nsvět" }] }),
      "iu.tasks.mvp.v1": JSON.stringify({ schemaVersion: 1, tasks: [{ id: "t1", title: "Úkol" }] }),
    });
    const before = cloneFromStorage(storage);
    const json = await exportBackupJson(storage, "test-build", subtle);
    const after = cloneFromStorage(storage);
    if (!storageSnapshotsEqual(before, after)) throw new Error("export mutated storage");
    const parsed = parseBackupJson(json);
    await verifyBackupIntegrity(parsed, subtle);
    if (parsed.format !== BACKUP_FORMAT) throw new Error("bad format");
    pass("export_readonly");
  } catch (e) {
    fail("export_readonly", e);
  }

  try {
    assertSafeJsonValue(JSON.parse('{"__proto__":{"x":1}}'));
    fail("reject_proto", "expected throw");
  } catch (e) {
    if (String(e.message).includes("UNSAFE")) pass("reject_proto");
    else fail("reject_proto", e);
  }

  try {
    parseBackupJson("{not-json");
    fail("reject_bad_json", "expected throw");
  } catch (e) {
    pass("reject_bad_json");
  }

  try {
    const storage = createMockStorage({
      "iu.notes.store.v1": JSON.stringify({ schemaVersion: 1, notes: [{ id: "a", title: "A" }] }),
    });
    const json = await exportBackupJson(storage, "v1", subtle);
    const backup = await verifyBackupIntegrity(parseBackupJson(json), subtle);
    storage.setItem("iu.notes.store.v1", JSON.stringify({ schemaVersion: 1, notes: [] }));
    await applyBackupReplaceMode(storage, {}, backup);
    const notes = JSON.parse(storage.getItem("iu.notes.store.v1") || "{}");
    if (!Array.isArray(notes.notes) || notes.notes.length !== 1) throw new Error("import failed");
    pass("import_replace");
  } catch (e) {
    fail("import_replace", e);
  }

  try {
    const storage = createMockStorage({
      "iu.notes.store.v1": JSON.stringify({ schemaVersion: 1, notes: [{ id: "keep", title: "Keep" }] }),
      "iu.tasks.mvp.v1": JSON.stringify({ schemaVersion: 1, tasks: [{ id: "t", title: "Task" }] }),
    });
    const json = await exportBackupJson(storage, "v1", subtle);
    const backup = await verifyBackupIntegrity(parseBackupJson(json), subtle);
    let failNextSet = true;
    const origSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (failNextSet) {
        failNextSet = false;
        throw new Error("SIMULATED_WRITE_FAIL");
      }
      origSet(key, value);
    };
    try {
      await applyBackupReplaceMode(storage, {}, backup);
      fail("rollback_on_write_fail", "expected throw");
    } catch (e) {
      if (!String(e.message).includes("SIMULATED")) throw e;
      storage.setItem = origSet;
      const notes = storage.getItem("iu.notes.store.v1") || "";
      const tasks = storage.getItem("iu.tasks.mvp.v1") || "";
      if (!notes.includes("keep") || !tasks.includes("Task")) throw new Error("rollback missing");
      pass("rollback_on_write_fail");
    }
  } catch (e) {
    fail("rollback_on_write_fail", e);
  }

  try {
    const msg = userMessageForError("BACKUP_NEWER_VERSION");
    if (!msg.includes("novější")) throw new Error("bad msg");
    pass("user_messages");
  } catch (e) {
    fail("user_messages", e);
  }

  const fails = results.filter((r) => !r.pass);
  return { pass: fails.length === 0, results, fails: fails.map((f) => f.id) };
}

function staticGate() {
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    { id: "core_file", pass: fs.existsSync(CORE) },
    { id: "ui_file", pass: fs.existsSync(UI) },
    { id: "tile_data_mgmt", pass: /data-iu-info-section="data-management"/.test(index) },
    { id: "export_btn", pass: /id="iuDataMgmtExportBtn"/.test(index) },
    { id: "import_btn", pass: /id="iuDataMgmtImportBtn"/.test(index) },
    { id: "script_ui", pass: /iu-user-data-backup-ui-v1\.mjs/.test(index) },
    { id: "info_center_bump", pass: /info-center-data-mgmt-v1-20260711/.test(index) },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
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
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function runPlaywright() {
  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(REPO, p.replace(/^\/+/, ""));
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const mime =
        fp.endsWith(".css") ? "text/css; charset=utf-8" :
        fp.endsWith(".mjs") ? "text/javascript; charset=utf-8" :
        fp.endsWith(".js") ? "text/javascript; charset=utf-8" :
        fp.endsWith(".html") ? "text/html; charset=utf-8" :
        "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(fs.readFileSync(fp));
    } catch {
      res.writeHead(500);
      res.end("err");
    }
  });

  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  await waitForPort("127.0.0.1", PORT, 10000);

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => typeof window.iuUserDataBackupExportJson === "function", { timeout: 45000 });

  const seedNotes = JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "g1", title: "Guard note", body: "diakritika ěšč", tags: [], createdAt: 1, updatedAt: 1 }],
  });
  const seedTasks = JSON.stringify({
    schemaVersion: 1,
    tasks: [{ id: "gt1", title: "Guard task", status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }],
  });

  await page.evaluate(
    ({ notes, tasks }) => {
      localStorage.setItem("iu.notes.store.v1", notes);
      localStorage.setItem("iu.tasks.mvp.v1", tasks);
    },
    { notes: seedNotes, tasks: seedTasks }
  );

  /** @type {{ cycle: number, exportOk: boolean, unchanged: boolean }[]} */
  const cycles = [];

  for (let i = 0; i < CYCLES; i += 1) {
    const result = await page.evaluate(async () => {
      const notesBefore = localStorage.getItem("iu.notes.store.v1");
      const tasksBefore = localStorage.getItem("iu.tasks.mvp.v1");
      let exportOk = false;
      try {
        const json = await window.iuUserDataBackupExportJson();
        exportOk = typeof json === "string" && json.includes("infouzel-backup");
      } catch {
        exportOk = false;
      }
      const unchanged =
        localStorage.getItem("iu.notes.store.v1") === notesBefore &&
        localStorage.getItem("iu.tasks.mvp.v1") === tasksBefore;
      return { exportOk, unchanged };
    });
    cycles.push({ cycle: i + 1, ...result });
  }

  await page.evaluate(() => {
    if (typeof window.iuInfoCenterOpenSection === "function") window.iuInfoCenterOpenSection("data-management");
  });
  await page.waitForTimeout(500);

  const ui = await page.evaluate(() => {
    const panel = document.getElementById("iuInfoCenterDetailDataManagement");
    const exportBtn = document.getElementById("iuDataMgmtExportBtn");
    const importBtn = document.getElementById("iuDataMgmtImportBtn");
    return {
      panelVisible: !!(panel && !panel.hidden),
      exportBtn: !!exportBtn,
      importBtn: !!importBtn,
      title: document.getElementById("iuTopbarInfoOverlayTitle")?.textContent || "",
    };
  });

  await browser.close();
  server.close();

  const exportFails = cycles.filter((c) => !c.exportOk || !c.unchanged);
  return {
    pass: exportFails.length === 0 && ui.panelVisible && ui.exportBtn && ui.importBtn,
    cycles,
    ui,
    fails: [
      ...exportFails.map((c) => `cycle_${c.cycle}`),
      ...(ui.panelVisible ? [] : ["panel_visible"]),
      ...(ui.exportBtn ? [] : ["export_btn_dom"]),
      ...(ui.importBtn ? [] : ["import_btn_dom"]),
    ],
  };
}

async function main() {
  const staticResult = staticGate();
  const unitResult = await runUnitTests();
  const pwResult = await runPlaywright();

  const pass = staticResult.pass && unitResult.pass && pwResult.pass;
  const report = {
    pass,
    static: staticResult,
    unit: unitResult,
    playwright: pwResult,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
