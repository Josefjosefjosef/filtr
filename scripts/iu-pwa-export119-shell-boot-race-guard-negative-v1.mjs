#!/usr/bin/env node
/** Negative regression harness for export119 guard — each scenario must FAIL with a specific ID. */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  startServer,
  mobileInitScript,
  testMenuNavBoot,
  testHomeDeepFirstPaint,
  testMindMenuReturnBoot,
} from "./iu-pwa-export119-shell-boot-race-guard-v1.mjs";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const { chromium } = require("playwright");

/** Seven required regression classes (1:1 with acceptance spec). */
const scenarios = [
  {
    id: "1_nav_gate_never",
    label: "Navigační brána nikdy nevznikne",
    run: async (page, base, bucket) => {
      await testMenuNavBoot(page, base, bucket, { skipMenuPersist: true, sabotageNavGate: true });
    },
    expectId: "menu:nav_gate_or_boot",
  },
  {
    id: "2_boot_never",
    label: "Boot stav nikdy nevznikne",
    run: async (page, base, bucket) => {
      await page.addInitScript(mobileInitScript());
      await testMindMenuReturnBoot(page, base, bucket, { sabotageBootClass: true });
    },
    expectId: "mindmenu:return_boot_missing",
  },
  {
    id: "3_menu_hidden",
    label: "Menu zůstane skryté",
    run: async (page, base, bucket) => {
      await testMenuNavBoot(page, base, bucket, { hideNavPanel: true });
    },
    expectId: "menu:nav_shell_open",
  },
  {
    id: "4_wrong_content",
    label: "Nesprávný obsah",
    run: async (page, base, bucket) => {
      await testMenuNavBoot(page, base, bucket, { forceFeedVisibleDuringBoot: true });
    },
    expectId: "menu:feed_visible_during_nav_boot",
  },
  {
    id: "5_white_gap",
    label: "Bílá mezera",
    run: async (page, base, bucket) => {
      await page.addInitScript(mobileInitScript());
      await testHomeDeepFirstPaint(page, base, bucket, { forceWhiteGapDuringBoot: true });
    },
    expectId: "home:visible_white_gap_during_boot",
  },
  {
    id: "6_init_stuck",
    label: "Inicializace se zasekne",
    run: async (page, base, bucket) => {
      await testMenuNavBoot(page, base, bucket, { removeMobileGateWrap: true });
    },
    expectId: "menu:shell_wrap_timeout",
  },
  {
    id: "7_early_nav_exposed",
    label: "Navigace / feed odhalen předčasně",
    run: async (page, base, bucket) => {
      await testMenuNavBoot(page, base, bucket, { exposeFeedBeforeNav: true });
    },
    expectId: "menu:reload_early_feed_visible_before_nav",
  },
];

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/projects/?nosw=1`;
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const scenario of scenarios) {
      const bucket = [];
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await page.addInitScript(mobileInitScript());
      await Promise.race([
        scenario.run(page, base, bucket),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("scenario_timeout_" + scenario.id)), 120000)
        ),
      ]).catch((err) => {
        bucket.push("menu:scenario_timeout:" + scenario.id + ":" + (err && err.message ? err.message : "err"));
      });
      await page.close();
      const hit = bucket.includes(scenario.expectId);
      results.push({
        id: scenario.id,
        label: scenario.label,
        pass: bucket.length > 0 && hit,
        expectId: scenario.expectId,
        fails: bucket,
      });
    }
  } finally {
    await browser.close();
    server.close();
  }

  const allOk = results.every((r) => r.pass);
  console.log(
    JSON.stringify(
      {
        IU_PWA_EXPORT119_SHELL_BOOT_RACE_GUARD_NEGATIVE: allOk ? "OK" : "FAIL",
        scenarios: results,
      },
      null,
      2
    )
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
