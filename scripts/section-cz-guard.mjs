/**
 * Hard guard: CZ vertikály hry/kultura/veda/vzdelavani musí být routované v app.js
 * a VIEW_MAP nesmí padat do čistého media bez mapování.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");
const appCss = fs.readFileSync(path.join(root, "assets", "app.css"), "utf8");
const idx = fs.readFileSync(path.join(root, "projects", "index.html"), "utf8");

let failed = false;
function must(cond, msg) {
  if (!cond) {
    console.error("[section-cz-guard] FAIL:", msg);
    failed = true;
  }
}

must(/hry:\s*['"]media['"]/.test(appJs), "VIEW_MAP missing hry -> media");
must(/kultura:\s*['"]media['"]/.test(appJs), "VIEW_MAP missing kultura -> media");
must(/veda:\s*['"]media['"]/.test(appJs), "VIEW_MAP missing veda -> media");
must(/vzdelavani:\s*['"]media['"]/.test(appJs), "VIEW_MAP missing vzdelavani -> media");

must(
  /['"]hry['"],\s*['"]kultura['"],\s*['"]veda['"],\s*['"]vzdelavani['"]/.test(appJs),
  "normalizeSection allowed set must list four CZ keys",
);

must(/if \(k === 'culture'\) return 'kultura'/.test(appJs), "legacy culture URL must map to kultura");

must(idx.includes('data-accent="kultura"'), "index.html left rail kultura data-accent");
must(idx.includes('data-section="kultura"'), "index.html hex kultura data-section");

must(
  /case\s+["']hry["']:\s*\{/.test(appJs) && /case\s+["']kultura["']:\s*\{/.test(appJs),
  "iuArticleMatchesMediaTopicKey must include hry and kultura cases",
);

must(/function iuArticleReleaseEligible/.test(appJs), "iuArticleReleaseEligible must exist");

/* #feed chrome: data-iu-fc=1 pro media + 4 CZ vertikály (krátký atribut kvůli CSS size budgetu). */
must(
  /body\[data-iu-fc="1"\]\s*#feed/.test(appCss),
  "app.css must use body[data-iu-fc=\"1\"] #feed for shared article list chrome",
);
must(
  /:not\(\[data-iu-fc="1"\]\)/.test(appCss),
  "app.css #feed hide rule must use :not([data-iu-fc=\"1\"])",
);
must(
  /setAttribute\("data-iu-fc"/.test(idx),
  "index.html boot must set data-iu-fc on html/body",
);
must(
  /setAttribute\("data-iu-fc"/.test(appJs),
  "app.js applySectionFromURL must sync data-iu-fc on html/body",
);

must(
  fs.existsSync(path.join(root, "assets", "images", "hry-default.jpg")),
  "assets/images/hry-default.jpg must exist",
);
must(
  fs.existsSync(path.join(root, "assets", "images", "kultura-default.jpg")),
  "assets/images/kultura-default.jpg must exist",
);
must(
  fs.existsSync(path.join(root, "assets", "images", "culture-default.jpg")),
  "assets/images/culture-default.jpg must exist",
);
must(
  fs.existsSync(path.join(root, "assets", "images", "veda-default.jpg")),
  "assets/images/veda-default.jpg must exist",
);
must(
  fs.existsSync(path.join(root, "assets", "images", "vzdelavani-default.jpg")),
  "assets/images/vzdelavani-default.jpg must exist",
);

const registryPath = path.join(root, "projects", "data", "source_registry.json");
const registryRaw = fs.readFileSync(registryPath, "utf8");
must(/"topic":\s*"hry"/.test(registryRaw), "source_registry.json must include hry topic");
must(/"topic":\s*"kultura"/.test(registryRaw), "source_registry.json must include kultura topic");
must(/"topic":\s*"veda"/.test(registryRaw), "source_registry.json must include veda topic");
must(/"topic":\s*"vzdelavani"/.test(registryRaw), "source_registry.json must include vzdelavani topic");
try {
  const reg = JSON.parse(registryRaw);
  const feedArr = Array.isArray(reg.entries) ? reg.entries : [];
  const n = (t) =>
    feedArr.filter((x) => x && !x.blocked && x.active !== false && String(x.topic || "") === t).length;
  must(n("hry") >= 3, "source_registry.json must list at least 3 active feeds for topic hry");
  must(n("kultura") >= 3, "source_registry.json must list at least 3 active feeds for topic kultura");
  must(n("veda") >= 3, "source_registry.json must list at least 3 active feeds for topic veda");
  must(n("vzdelavani") >= 3, "source_registry.json must list at least 3 active feeds for topic vzdelavani");
} catch (e) {
  must(false, "source_registry.json must be valid JSON: " + String(e && e.message));
}

const scan = appJs + idx + registryRaw;
must(!/\.jpg\.jpeg/i.test(scan), "must not reference .jpg.jpeg");

if (failed) {
  process.exit(1);
}
console.log("[section-cz-guard] OK");
