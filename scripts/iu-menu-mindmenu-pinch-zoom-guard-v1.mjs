#!/usr/bin/env node
/**
 * Menu / MindMenu mobile gate: native pinch-to-zoom must match the main page.
 *
 * Root cause: full-bleed .iu-mobileGatePanel used touch-action:pan-y alone →
 * WebKit/Blink excluded pinch-zoom while home (no pan-y shell) allowed it.
 * Fix: touch-action: pan-y pinch-zoom (vertical scroll kept; native pinch restored).
 *
 * Must NOT reintroduce maximum-scale=1 / user-scalable=no on the viewport.
 * Must NOT invent a custom JS zoom / gesture preventDefault for pinch.
 *
 * Run: npm run iu-menu-mindmenu-pinch-zoom-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_CSS = fs.readFileSync(path.join(REPO, "assets", "app.css"), "utf8");
const INDEX = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
const FEED = fs.readFileSync(
  path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"),
  "utf8"
);

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

const gateRule = APP_CSS.match(
  /body\.iu-mobileGateOverlayOpen\s+#iuMobileGateContent\s+\.iu-mobileGatePanel:not\(\[hidden\]\)\s*\{([\s\S]*?)\}/
);
ok("GATE_PANEL_RULE_PRESENT", !!gateRule, "missing selector");
if (gateRule) {
  const body = gateRule[1];
  const ta = ((body.match(/touch-action:\s*([^;]+)/i) || [])[1] || "").trim();
  ok(
    "GATE_TOUCH_ACTION_PAN_Y_PINCH",
    /^pan-y\s+pinch-zoom\s*!important$/i.test(ta),
    ta || "none"
  );
  ok(
    "GATE_NO_TOUCH_NONE",
    !/touch-action:\s*none/i.test(body),
    "touch-action:none on gate panel"
  );
  ok(
    "GATE_ROOT_CAUSE_COMMENT",
    /Root cause: touch-action:pan-y alone/i.test(APP_CSS),
    "comment missing"
  );
}

const vp = INDEX.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i);
ok("VIEWPORT_META_PRESENT", !!vp);
if (vp) {
  const content = vp[1];
  ok(
    "VIEWPORT_NO_MAX_SCALE_1",
    !/maximum-scale\s*=\s*1/i.test(content),
    content
  );
  ok(
    "VIEWPORT_NO_USER_SCALABLE_NO",
    !/user-scalable\s*=\s*no/i.test(content),
    content
  );
}

ok(
  "GATE_OPEN_CLASS_TOGGLE",
  /iu-mobileGateOverlayOpen/.test(FEED),
  "feed pipeline must still toggle gate open class"
);

ok(
  "NO_CUSTOM_PINCH_GESTURE_LOCK",
  !/gesturestart[\s\S]{0,80}preventDefault/.test(FEED) &&
    !/addEventListener\(\s*["']gesturestart["']/.test(FEED),
  "custom gesture lock"
);

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-menu-mindmenu-pinch-zoom-guard-v1",
      pass,
      failCount: fails.length,
      fails,
      results,
    },
    null,
    2
  )
);
if (!pass) {
  console.log("IU_MENU_MINDMENU_PINCH_ZOOM_FAIL");
  process.exit(1);
}
console.log("IU_MENU_MINDMENU_PINCH_ZOOM_PASS");
