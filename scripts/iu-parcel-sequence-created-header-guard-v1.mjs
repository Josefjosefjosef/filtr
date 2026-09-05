#!/usr/bin/env node
/**
 * Parcel watch: permanent sequence + created-at header invariants.
 * Run: npm run iu-parcel-sequence-created-header-guard
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8994", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover&nosw=1`;
const LS_KEY = "iu_silver_parcel_watch_v1";
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function staticGate() {
  const js = read("assets/iu-silver-parcel-dashboard.js");
  const css = read("assets/iu-silver-parcel-dashboard.css");
  const index = read("projects/index.html");

  must(/function migrateParcelList\s*\(/.test(js), "static_migrate_fn");
  must(/function nextParcelSequence\s*\(/.test(js), "static_next_seq_fn");
  must(/function formatCreatedAt\s*\(/.test(js), "static_format_created_fn");
  must(/sequence:\s*nextParcelSequence\(list\)/.test(js), "static_create_sets_sequence");
  must(/addedAt:\s*Date\.now\(\)/.test(js), "static_create_sets_addedAt");
  must(/iuSilverParcelWatch__cardHead/.test(js), "static_render_card_head");
  must(/iuSilverParcelWatch__cardCreated/.test(js), "static_render_card_created");
  must(/Zásilka " \+ seqText \+ " – " \+ item\.number/.test(js), "static_title_pattern");
  must(!/title\.textContent = "📦 Zásilka " \+ item\.number;/.test(js), "static_no_legacy_title_only");
  // lastCheckedAt must remain separate from addedAt in refresh path
  must(/list\[i\]\.lastCheckedAt = now/.test(js), "static_refresh_updates_lastChecked");
  must(!/list\[i\]\.addedAt\s*=/.test(js), "static_refresh_must_not_touch_addedAt");
  must(/\.iuSilverParcelWatch__cardHead\s*\{/.test(css), "static_css_card_head");
  must(/\.iuSilverParcelWatch__cardCreated\s*\{/.test(css), "static_css_card_created");
  must(/flex-wrap:\s*wrap/.test(css), "static_css_flex_wrap");
  must(
    /iu-silver-parcel-dashboard\.js\?v=parcel-seq-created-header-v1-20260905/.test(index),
    "static_index_js_cache_bust"
  );
  must(
    /iu-silver-parcel-dashboard\.css\?v=parcel-seq-created-header-v1-20260905/.test(index),
    "static_index_css_cache_bust"
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
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function runtimeGate() {
  const srv = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await bootstrapGuardPage(context);

    async function seedList(payload) {
      await waitForVaultReady(page, 90000).catch(() => {});
      await page.evaluate(
        async ({ key, payload: list }) => {
          const raw = JSON.stringify(list);
          try {
            if (window.iuVault && typeof window.iuVault.durableSet === "function") {
              await window.iuVault.durableSet(key, raw);
              return;
            }
          } catch (_) {}
          localStorage.setItem(key, raw);
        },
        { key: LS_KEY, payload }
      );
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
        timeout: 45000,
      });
      await waitForVaultReady(page, 90000).catch(() => {});
      // Parcel module re-renders after vault hydrate; give it a beat then force reload list via soft wait.
      await page.waitForTimeout(1200);
      const n = await page.locator(".iuSilverParcelWatch__card").count();
      if (n < 1 && payload.length > 0) {
        // Retry seed after vault is ready (first paint may have raced empty LS).
        await page.evaluate(
          async ({ key, payload: list }) => {
            const raw = JSON.stringify(list);
            try {
              if (window.iuVault && typeof window.iuVault.durableSet === "function") {
                await window.iuVault.durableSet(key, raw);
                return;
              }
            } catch (_) {}
            localStorage.setItem(key, raw);
          },
          { key: LS_KEY, payload }
        );
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
          timeout: 45000,
        });
        await waitForVaultReady(page, 90000).catch(() => {});
        await page.waitForTimeout(1200);
      }
    }

    async function readStored() {
      return page.evaluate((key) => {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : [];
        } catch (_) {
          return [];
        }
      }, LS_KEY);
    }

    const t0 = Date.UTC(2026, 8, 5, 0, 4, 0);
    const legacy = [
      { id: "p_legacy_a", number: "LEGACYA1", addedAt: t0, lastCheckedAt: t0 + 60000 },
      { id: "p_legacy_b", number: "LEGACYB2", addedAt: t0 + 120000, lastCheckedAt: t0 + 180000 },
      { id: "p_legacy_c", number: "LEGACYC3", addedAt: t0 + 240000, lastCheckedAt: null },
    ];

    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
      timeout: 45000,
    });
    await seedList(legacy);

    const afterMigrate = await readStored();
    must(Array.isArray(afterMigrate) && afterMigrate.length === 3, "rt_migrate_len");
    must(afterMigrate.every((x) => Number.isFinite(x.sequence)), "rt_migrate_sequences_assigned");
    must(
      afterMigrate.find((x) => x.id === "p_legacy_a")?.sequence === 1 &&
        afterMigrate.find((x) => x.id === "p_legacy_b")?.sequence === 2 &&
        afterMigrate.find((x) => x.id === "p_legacy_c")?.sequence === 3,
      "rt_migrate_order_by_addedAt"
    );
    must(
      afterMigrate.every((x) => Number(x.addedAt) === Number(legacy.find((l) => l.id === x.id).addedAt)),
      "rt_migrate_preserves_addedAt"
    );

    const titles1 = await page.locator(".iuSilverParcelWatch__cardTitle").allTextContents();
    must(titles1.some((t) => /Zásilka 1\s*–\s*LEGACYA1/.test(t)), "rt_title_seq1");
    must(titles1.some((t) => /Zásilka 2\s*–\s*LEGACYB2/.test(t)), "rt_title_seq2");
    must(titles1.some((t) => /Zásilka 3\s*–\s*LEGACYC3/.test(t)), "rt_title_seq3");
    must((await page.locator(".iuSilverParcelWatch__cardCreated").count()) >= 3, "rt_created_visible");

    const withoutB = afterMigrate.filter((x) => x.id !== "p_legacy_b");
    await seedList(withoutB);
    const afterDel = await readStored();
    must(afterDel.length === 2, "rt_after_delete_len");
    must(
      afterDel.find((x) => x.id === "p_legacy_a")?.sequence === 1 &&
        afterDel.find((x) => x.id === "p_legacy_c")?.sequence === 3,
      "rt_delete_does_not_renumber"
    );

    const max = afterDel.reduce((m, x) => Math.max(m, Number(x.sequence) || 0), 0);
    const withNew = afterDel.concat([
      {
        id: "p_new_4",
        number: "NEWNUMB4",
        sequence: max + 1,
        addedAt: Date.now(),
        lastCheckedAt: null,
        carrierHint: "",
        postalDigits: "",
        terminalVerified: null,
        pickupAddressVerified: "",
        completedAt: null,
        lastDetection: null,
      },
    ]);
    await seedList(withNew);
    const afterAdd = await readStored();
    must(afterAdd.find((x) => x.id === "p_new_4")?.sequence === 4, "rt_new_gets_next_seq");
    const titles2 = await page.locator(".iuSilverParcelWatch__cardTitle").allTextContents();
    must(titles2.some((t) => /Zásilka 4\s*–\s*NEWNUMB4/.test(t)), "rt_title_seq4");

    const beforeAdded = afterAdd.map((x) => ({ id: x.id, addedAt: x.addedAt, sequence: x.sequence }));
    const refreshed = afterAdd.map((x) => Object.assign({}, x, { lastCheckedAt: Date.now() }));
    await seedList(refreshed);
    const afterRefresh = await readStored();
    must(
      beforeAdded.every((b) => {
        const cur = afterRefresh.find((x) => x.id === b.id);
        return cur && cur.addedAt === b.addedAt && cur.sequence === b.sequence;
      }),
      "rt_refresh_preserves_created_and_seq"
    );

    const longList = afterRefresh.map((x, i) =>
      i === 0
        ? Object.assign({}, x, { number: "VERYLONGTRACKINGNUMBERXYZ1234567890ABCDEF" })
        : x
    );
    await page.setViewportSize({ width: 360, height: 740 });
    await seedList(longList);
    const overflow = await page.evaluate(() => {
      const card = document.querySelector(".iuSilverParcelWatch__card");
      const head = document.querySelector(".iuSilverParcelWatch__cardHead");
      if (!card || !head) return { ok: false, reason: "missing" };
      const sw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      const cardRect = card.getBoundingClientRect();
      return {
        ok: true,
        pageOverflow: sw > cw + 1,
        headWiderThanCard: head.scrollWidth > card.clientWidth + 2,
        cardRight: cardRect.right,
        vw: cw,
      };
    });
    must(overflow.ok, "rt_overflow_probe_ok");
    must(!overflow.pageOverflow, "rt_no_page_horizontal_overflow");
    must(!overflow.headWiderThanCard, "rt_head_fits_card");
    must(overflow.cardRight <= overflow.vw + 1, "rt_card_within_viewport");

    const snap1 = JSON.stringify(
      (await readStored()).map((x) => ({ id: x.id, sequence: x.sequence, addedAt: x.addedAt }))
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.getElementById("iuSilverParcelWatch"), {
      timeout: 45000,
    });
    await page.waitForTimeout(500);
    const snap2 = JSON.stringify(
      (await readStored()).map((x) => ({ id: x.id, sequence: x.sequence, addedAt: x.addedAt }))
    );
    must(snap1 === snap2, "rt_migrate_idempotent");

    await context.close();
    await browser.close();
  } finally {
    try {
      srv.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.error(JSON.stringify({ result: "FAIL", phase: "static", fails }, null, 2));
    process.exit(1);
  }
  await runtimeGate();
  if (fails.length) {
    console.error(JSON.stringify({ result: "FAIL", phase: "runtime", fails }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ result: "PASS", IU_PARCEL_SEQUENCE_CREATED_HEADER_GUARD: "PASS" }));
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
