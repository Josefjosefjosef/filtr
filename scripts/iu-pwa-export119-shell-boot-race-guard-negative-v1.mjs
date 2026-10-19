#!/usr/bin/env node
/** Negative regression harness for export119 menu nav boot guard (must FAIL). */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  startServer,
  mobileInitScript,
  testMenuNavBoot,
} from "./iu-pwa-export119-shell-boot-race-guard-v1.mjs";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const { chromium } = require("playwright");

const scenarios = [
  {
    id: "no_menu_persist",
    options: { skipMenuPersist: true },
    expectAny: ["menu:nav_gate_or_boot", "menu:shell_early_nav_or_boot"],
  },
  {
    id: "menu_persist_wrong_gate",
    options: { menuPersistGate: "home" },
    expectAny: ["menu:nav_gate_or_boot", "menu:shell_early_nav_or_boot"],
  },
  {
    id: "remove_mobile_gate_wrap",
    options: { removeMobileGateWrap: true },
    expectAny: ["menu:shell_wrap_timeout", "menu:nav_gate_or_boot"],
  },
  {
    id: "hide_nav_panel",
    options: { hideNavPanel: true },
    expectAny: ["menu:nav_shell_open", "menu:nav_panel_first_visible_no_home_flash"],
  },
];

function hitExpectation(fails, expectAny) {
  return expectAny.some((id) => fails.includes(id));
}

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
        testMenuNavBoot(page, base, bucket, scenario.options),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("scenario_timeout_" + scenario.id)), 45000)
        ),
      ]).catch((err) => {
        bucket.push("menu:scenario_timeout:" + scenario.id);
      });
      await page.close();
      const failedAsExpected = bucket.length > 0 && hitExpectation(bucket, scenario.expectAny);
      results.push({
        id: scenario.id,
        pass: failedAsExpected,
        fails: bucket,
        expectAny: scenario.expectAny,
      });
    }
  } finally {
    await browser.close();
    server.close();
  }

  const allOk = results.every((r) => r.pass);
  console.log(
    JSON.stringify({
      IU_PWA_EXPORT119_SHELL_BOOT_RACE_GUARD_NEGATIVE: allOk ? "OK" : "FAIL",
      scenarios: results,
    })
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
