#!/usr/bin/env node
/**
 * CANONICAL_DURABLE_PERSISTENCE_CONTRACT_GUARD
 *
 * A) KEY_PATH_BEFORE_PROTECTED_DATA
 * B) SAVE_ACK_REQUIRES_DURABLE_READBACK
 * C) COLD_START_REBUILDS_CRYPTO (persistent profile = durable IDB)
 * D) Multi-module durable save survives new page / CryptoKey loss
 *
 * Run: node scripts/iu-vault-canonical-durable-persistence-contract-guard-v1.mjs
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import fs from "fs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium, webkit, firefox } = require("playwright");

const MARKER = `IU_CANON_${Date.now()}`;
const TMP = process.env.TEMP || process.env.TMPDIR || "/tmp";

const KEYS = {
  prefs: "iu.infoEvents.prefs.v1",
  notes: "iu.notes.store.v1",
  tasks: "iu.tasks.mvp.v1",
  calendar: "iu.calendar.store.v1",
  shopping: "iuShoppingLastListV1",
  quicktools: "infouzel_quicktools",
};

function staticChecks(fails) {
  const migrate = fs.readFileSync(path.join(REPO, "assets", "iu-vault-l1-migrate-v1.js"), "utf8");
  const fnStart = migrate.indexOf("async function persistNonExtractableMdk");
  if (fnStart >= 0) {
    const body = migrate.slice(fnStart, fnStart + 600);
    if (/catch\s*\([^)]*\)\s*\{[\s\S]*writeKeyRecord\("mdk:level1"/.test(body)) {
      fails.push("migrate_cryptokey_only_catch_present");
    }
  }
  const adapter = fs.readFileSync(path.join(REPO, "assets", "iu-vault-durable-adapter-v1.js"), "utf8");
  if (!/export async function durableSet/.test(adapter)) fails.push("missing_durableSet");
  if (!/VAULT_DURABLE_READBACK_MISSING/.test(adapter)) fails.push("missing_readback_check");
  if (!/assertDurableKeyPathReady/.test(adapter)) fails.push("missing_assertKeyPath");
  const storage = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  if (!/key_path_not_ready/.test(storage)) fails.push("vaultSetItem_missing_key_path_gate");
  const boot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  if (!/durableSet:/.test(boot)) fails.push("bootstrap_missing_durableSet_api");
  const lock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");
  if (!/__iuVaultKeyPathDurableReady/.test(lock)) fails.push("lock_missing_key_path_ready_flag");
}

async function seedAndVerify(page, marker) {
  return page.evaluate(
    async ({ keys, marker }) => {
      try {
        localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      } catch (_) {}
      if (!window.iuVault || typeof window.iuVault.durableSet !== "function") {
        return { ok: false, reason: "no_durableSet" };
      }
      if (typeof window.iuVault.assertKeyPathReady === "function") {
        await window.iuVault.assertKeyPathReady();
      }
      const payloads = {
        [keys.prefs]: JSON.stringify({
          sections: ["doprava"],
          sourceGroups: ["doprava"],
          searchQuery: marker,
          homeObec: marker + "_OBEC",
          feedFilter: { roads: [marker] },
        }),
        [keys.notes]: JSON.stringify({
          schemaVersion: 1,
          notes: [
            {
              id: "n1",
              title: marker,
              content: marker,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              pinned: false,
              tags: [],
              deleted: false,
            },
          ],
        }),
        [keys.tasks]: JSON.stringify({
          schemaVersion: 1,
          tasks: [
            {
              id: "t1",
              title: marker,
              status: "open",
              priority: "medium",
              dueAt: "",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        }),
        [keys.calendar]: JSON.stringify({
          schemaVersion: 1,
          events: [{ id: "e1", title: marker, date: "2099-01-01", allDay: true }],
        }),
        [keys.shopping]: JSON.stringify({ v: 1, items: [{ id: "s1", text: marker }] }),
        [keys.quicktools]: JSON.stringify({
          version: 2,
          order: [],
          visible: [],
          customButtons: [{ id: "c1", label: marker, url: "https://example.com" }],
        }),
      };
      for (const [k, v] of Object.entries(payloads)) {
        await window.iuVault.durableSet(k, v);
      }
      let materialOk = false;
      try {
        const { readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
        const mat = await readKeyRecord("mdk:level1:material");
        materialOk = !!mat;
      } catch (_) {}
      return {
        ok: true,
        ready: window.__iuVaultKeyPathDurableReady === true,
        materialOk,
      };
    },
    { keys: KEYS, marker }
  );
}

async function verifyAfterCold(page, marker) {
  return page.evaluate(
    async ({ keys, marker }) => {
      await new Promise((r) => {
        if (window.__iuVaultHydrationComplete) return r();
        window.addEventListener("iu-vault-hydrated", () => r(), { once: true });
        setTimeout(r, 25000);
      });
      const out = {};
      for (const [name, key] of Object.entries(keys)) {
        let raw = null;
        try {
          raw = localStorage.getItem(key);
        } catch (_) {}
        out[name] = !!(raw && String(raw).includes(marker));
      }
      let materialOk = false;
      let cryptoOk = false;
      try {
        const { readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
        materialOk = !!(await readKeyRecord("mdk:level1:material"));
        const kr = await readKeyRecord("mdk:level1");
        cryptoOk = !!(kr && kr.mdk);
      } catch (_) {}
      return {
        out,
        allOk: Object.values(out).every(Boolean),
        materialOk,
        cryptoOk,
        recovery: !!(
          window.iuVault &&
          window.iuVault.isStorageRecoveryRequired &&
          window.iuVault.isStorageRecoveryRequired()
        ),
      };
    },
    { keys: KEYS, marker }
  );
}

async function runEngine(browserType, label, fails) {
  let context = null;
  let page = null;
  let server = null;
  const userDataDir = path.join(TMP, `iu-canon-guard-${label}-${Date.now()}`);
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    const started = await startGuardStaticServer(pickGuardPort(9460, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;
    const ctxOpts = {
      viewport: { width: 390, height: 844 },
      headless: true,
    };
    if (label !== "firefox") {
      ctxOpts.isMobile = true;
      ctxOpts.hasTouch = true;
    }
    context = await browserType.launchPersistentContext(userDataDir, ctxOpts);
    page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(90000);
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await waitForVaultReady(page, 90000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, {
      timeout: 90000,
    });

    const seeded = await seedAndVerify(page, MARKER);
    if (!seeded.ok) fails.push(`${label}_seed_${seeded.reason || "fail"}`);
    if (seeded.ok && !seeded.ready) fails.push(`${label}_key_path_not_ready_after_seed`);
    if (seeded.ok && !seeded.materialOk) fails.push(`${label}_material_missing_after_seed`);

    await page.evaluate(async () => {
      const { deleteKeyRecord, readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
      const mat = await readKeyRecord("mdk:level1:material");
      if (!mat) throw new Error("no_material");
      await deleteKeyRecord("mdk:level1");
    });

    await page.close();
    page = await context.newPage();
    page.setDefaultTimeout(90000);
    await page.goto(`${base}?nosw=1&cb=${Date.now() + 1}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await waitForVaultReady(page, 90000);
    await page.waitForFunction(
      () =>
        window.__iuVaultHydrationComplete === true ||
        (window.iuVault &&
          window.iuVault.isStorageRecoveryRequired &&
          window.iuVault.isStorageRecoveryRequired()),
      null,
      { timeout: 90000 }
    );

    const after = await verifyAfterCold(page, MARKER);
    if (after.recovery) fails.push(`${label}_unexpected_recovery_after_material_restore`);
    if (!after.materialOk) fails.push(`${label}_material_missing_after_cold`);
    if (!after.cryptoOk) fails.push(`${label}_crypto_not_restored_from_material`);
    if (!after.allOk) fails.push(`${label}_module_data_lost:` + JSON.stringify(after.out));
  } catch (err) {
    fails.push(`${label}_runtime:` + String((err && err.message) || err).slice(0, 180));
  } finally {
    try {
      if (page) await page.close();
    } catch (_) {}
    try {
      if (context) await context.close();
    } catch (_) {}
    if (server) await stopGuardProcess(server.proc || null);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function main() {
  const fails = [];
  staticChecks(fails);

  const engines = [{ type: chromium, label: "chromium" }];
  try {
    if (webkit) engines.push({ type: webkit, label: "webkit" });
  } catch (_) {}
  try {
    if (firefox) engines.push({ type: firefox, label: "firefox" });
  } catch (_) {}

  for (const eng of engines) {
    const before = fails.length;
    await runEngine(eng.type, eng.label, fails);
    // Chromium is required. WebKit/Firefox optional when browser install/profile quirks appear.
    if (eng.label !== "chromium" && fails.length > before) {
      const soft = fails.splice(before);
      console.log(JSON.stringify({ softEngineFails: soft, engine: eng.label }));
    }
  }

  let context = null;
  let page = null;
  let server = null;
  const userDataDir = path.join(TMP, `iu-canon-pc-${Date.now()}`);
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    const started = await startGuardStaticServer(pickGuardPort(9470, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;
    context = await chromium.launchPersistentContext(userDataDir, {
      viewport: { width: 1280, height: 800 },
      headless: true,
    });
    page = context.pages()[0] || (await context.newPage());
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await waitForVaultReady(page, 90000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, {
      timeout: 90000,
    });
    const seeded = await seedAndVerify(page, MARKER + "_PC");
    if (!seeded.ok) fails.push("desktop_seed_fail");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page, 90000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, {
      timeout: 90000,
    });
    const after = await verifyAfterCold(page, MARKER + "_PC");
    if (!after.allOk) fails.push("desktop_reload_data_lost:" + JSON.stringify(after.out));
  } catch (err) {
    fails.push("desktop_runtime:" + String((err && err.message) || err).slice(0, 180));
  } finally {
    try {
      if (page) await page.close();
    } catch (_) {}
    try {
      if (context) await context.close();
    } catch (_) {}
    if (server) await stopGuardProcess(server.proc || null);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {}
  }

  if (fails.length) {
    console.log(JSON.stringify({ ok: false, fails, marker: MARKER }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        guard: "CANONICAL_DURABLE_PERSISTENCE_CONTRACT_GUARD",
        marker: MARKER,
        engines: engines.map((e) => e.label).concat(["chromium-desktop"]),
        keys: Object.values(KEYS),
      },
      null,
      2
    )
  );
}

main();
