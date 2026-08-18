#!/usr/bin/env node
/**
 * Datovka / Bakaláři / ZP — mobil+tablet: žádný autofocus po „+ Přidat další“, sjednocené tlačítko, bottom-nav pin.
 * Run: npm run iu-moje-sluzby-mobile-keyboard-add-btn-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(REPO, "assets", "app.js");
const FEED = path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js");
const UNIFIED = path.join(REPO, "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const INDEX = path.join(REPO, "projects", "index.html");
const CSS_BUST = "ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802-ds-full-height-v1-20260803-kb-hide-v2-20260803-kb-restore-v3-20260803-bottom-nav-unify-v1-20260804";
const JS_BUSTS = [
  "bottom-nav-unify-v1-20260804",
  "kb-restore-v3-20260803",
  "bottom-nav-keyboard-hide-v1-20260802",
  "ds-mobile-scroll-bottom-clearance-v1-20260707-desktop-left-rail-section-close-v1-20260707-svatek-pill-inline-layout-v1-20260707",
  "ds-mobile-scroll-bottom-clearance-v1-20260707-desktop-left-rail-section-close-v1-20260707",
  "legal-docs-hub-header-single-row-v1-20260707",
  "ds-mobile-scroll-bottom-clearance-v1-20260707",
  "moje-sluzby-mobile-keyboard-add-btn-v1-20260706",
  "weather-artifact-utf8-eager-boot-v1-20260706",
  "legal-docs-preview-pc-v1-20260706",
  "tasks-desktop-two-panel-v1-20260706",
  "state-holiday-label-v1-20260706",
];

function chunkAfter(fnName, app) {
  const parts = app.split("function " + fnName);
  return parts[1] ? parts[1].split(/\n  function /)[0] : "";
}

function staticGate() {
  const app = [
    fs.readFileSync(APP, "utf8"),
    fs.existsSync(FEED) ? fs.readFileSync(FEED, "utf8") : "",
  ].join("\n");
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");

  const dsAddChunk = chunkAfter("iuDsBindPanel()", app);
  const bakalariChunk = chunkAfter("renderBakalariModal(container)", app);
  const pojistovnaChunk = chunkAfter("renderPojistovnaModal(container)", app);

  const checks = [
    {
      id: "bottom_nav_keyboard_hide_init",
      pass: /function iuMobileBottomNavKeyboardHideInit\(\)/.test(app),
    },
    {
      id: "bottom_nav_keyboard_hide_scheduled",
      pass: /iuMobileBottomNavKeyboardHideInit\(\)/.test(app),
    },
    {
      id: "bottom_nav_pin_alias",
      pass: /function iuMojeSluzbyFormBottomNavKeyboardPinInit\(\)/.test(app),
    },
    {
      id: "ds_add_no_input_focus",
      pass: (() => {
        const addHandler = dsAddChunk.split('addBtn.addEventListener("click"')[1] || "";
        return !/\.focus\(/.test(addHandler.split("});")[0] || "");
      })(),
    },
    {
      id: "bakalari_add_no_input_focus",
      pass: (() => {
        const h = bakalariChunk.split('addAnotherBtn.addEventListener("click"')[1] || "";
        return !/\.focus\(/.test((h.split("});")[0] || ""));
      })(),
    },
    {
      id: "pojistovna_add_no_input_focus",
      pass: (() => {
        const h = pojistovnaChunk.split('addAnotherBtn.addEventListener("click"')[1] || "";
        return !/\.focus\(/.test((h.split("});")[0] || ""));
      })(),
    },
    {
      id: "bakalari_add_label_plus",
      pass: /data-bakalari-add>\+ Přidat další</.test(app),
    },
    {
      id: "pojistovna_add_label_plus",
      pass: /data-iu-health-add>\+ Přidat další</.test(app),
    },
    {
      id: "part10_unified_add_btn",
      pass: /Part 10: Bakaláři \/ ZP|Part 10: Datovka \/ Bakaláři \/ ZP/.test(unified),
    },
    {
      id: "part10_full_width_add",
      pass: /#iuQuickFeed \.bakalari-add-another[\s\S]*width: 100% !important/.test(unified),
    },
    {
      id: "part10_svh_max_height",
      pass: /100svh - var\(--iu-tool-overlay-panel-bottom\)/.test(unified),
    },
    {
      id: "index_css_cache_bust",
      pass: new RegExp(`iu-overlay-mobile-tablet-unified-v1\\.css\\?v=${CSS_BUST}`).test(index),
    },
    {
      id: "index_app_cache_bust",
      pass: /app\.js\?v=/.test(index) && JS_BUSTS.some((bust) => index.includes(bust)),
    },
  ];

  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

function main() {
  const result = staticGate();
  if (!result.pass) {
    console.log("IU_MOJE_SLUZBY_MOBILE_KEYBOARD_ADD_BTN_GUARD_FAIL");
    result.fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_MOJE_SLUZBY_MOBILE_KEYBOARD_ADD_BTN_GUARD_PASS");
}

main();
