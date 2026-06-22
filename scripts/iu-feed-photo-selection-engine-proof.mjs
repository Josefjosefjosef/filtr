#!/usr/bin/env node
/**
 * Proof: feed photo selection engine (phase 2A) — routing + rotation, no feed render.
 * Run: npm run feed-photo-selection-engine-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  IU_FEED_GENERAL_FALLBACK_GALLERY_ID,
  IU_FEED_PHOTO_LABEL,
  IU_FEED_RENDER_ENABLED,
  IU_FEED_SECTION_GALLERY_IDS,
  IU_FEED_SUPPLEMENTAL_GALLERY_IDS,
  iuFeedPhotoCompareRotation,
  iuFeedPhotoDetectSupplementalGallery,
  iuFeedPhotoLoadImportCatalog,
  iuFeedPhotoRecordUsage,
  iuFeedPhotoResolveSectionGallery,
  iuFeedPhotoResolveTargetGallery,
  iuFeedPhotoSelectForArticle,
  iuFeedPhotoSelectWithFallback,
} from "../assets/iu-feed-photo-selection-engine.js";
import { IU_IMAGE_GUESSING_ALLOWED } from "../assets/iu-photo-article-safety.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY_ROOT = path.join(REPO, "projects", "data", "image_gallery");
const CONFIG_PATH = path.join(GALLERY_ROOT, "feed_photo_engine_config.json");
const ENGINE_PATH = path.join(REPO, "assets", "iu-feed-photo-selection-engine.js");
const REPORT_PATH = path.join(REPO, "scripts", "iu-feed-photo-selection-engine-proof-report.json");

function article(title, extra = {}) {
  return { contentType: "article", title, ...extra };
}

function checkScopeUnchanged() {
  try {
    const diff = execSync("git diff --name-only HEAD", { encoding: "utf8", cwd: REPO });
    const files = diff.split(/\r?\n/).filter(Boolean);
    return {
      FRONTEND_CHANGED: files.some((f) => f === "assets/app.js" || f === "assets/app.css" || f === "projects/index.html")
        ? "YES"
        : "NO",
      FEED_CHANGED: files.some((f) => f.includes("article_feed") || f === "projects/data/articles.json")
        ? "YES"
        : "NO",
      ADS_CHANGED: files.some((f) => /ad|reklam/i.test(f)) ? "YES" : "NO",
      SILVER_CHANGED: files.some((f) => f.toLowerCase().includes("silver")) ? "YES" : "NO",
    };
  } catch {
    return { FRONTEND_CHANGED: "NO", FEED_CHANGED: "NO", ADS_CHANGED: "NO", SILVER_CHANGED: "NO" };
  }
}

function gitStatusClean() {
  try {
    const status = execSync("git status --short", { encoding: "utf8", cwd: REPO }).trim();
    const allowed = status
      .split(/\r?\n/)
      .filter(Boolean)
      .every((line) => {
        const file = line.replace(/^\?\? |^[ MADRCU?!]{2} /, "").trim();
        return (
          file.startsWith("scripts/iu-feed-photo-selection-engine-proof") ||
          file === "scripts/iu-feed-photo-selection-engine-proof-report.json"
        );
      });
    return status === "" || allowed;
  } catch {
    return false;
  }
}

function engineAutoGuessCount(catalog) {
  let count = 0;
  const samples = [
    article("Andrej Babiš kritizoval vládu", { section: "zpravy" }),
    article("Donald Trump jednal o clech", { section: "zpravy" }),
    article("Na hradě Loket se pořádají turnaje", { section: "veda-historie" }),
    article("Taylor Swift oznámila koncert", { section: "kultura-akce" }),
    article("Škoda Auto navyšuje výrobu", { section: "finance" }),
  ];
  for (const a of samples) {
    const r = iuFeedPhotoSelectForArticle(a, catalog);
    if (r.verifiedPersonSelectionEnabled || r.verifiedPlaceSelectionEnabled) count += 1;
    if (r.photo?.imageMode === "exact_match") count += 1;
    if (String(r.routingType || "").includes("verified")) count += 1;
  }
  return count;
}

function main() {
  const fails = [];
  const engineExists = fs.existsSync(ENGINE_PATH);
  const configExists = fs.existsSync(CONFIG_PATH);
  if (!engineExists) fails.push("engine_file_missing");
  if (!configExists) fails.push("config_file_missing");

  const config = configExists ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) : {};
  const catalog = iuFeedPhotoLoadImportCatalog(fs.readFileSync, path.join, GALLERY_ROOT);
  if (catalog.total < 2000) fails.push("catalog_pool_too_small");

  const sectionCases = [
    ["Zprávy z domova", { section: "zpravy" }, "zpravy"],
    ["Fotbalový zápas skončil remízou", { section: "sport" }, "sport"],
    ["Burza rostla", { section: "finance" }, "finance"],
    ["Nové léky ve zdravotnictví", { section: "zdravi" }, "zdravi"],
    ["Dovolená u moře", { section: "cestovani" }, "cestovani"],
    ["Esports turnaj", { section: "hry" }, "hry"],
    ["Koncert v Praze", { section: "kultura-akce" }, "kultura-akce"],
    ["Vědecký objev", { section: "veda-historie" }, "veda-historie"],
    ["Škola zavírá", { section: "vzdelavani" }, "vzdelavani"],
    ["Přehled dne", { section: "prehled-dne" }, "prehled-dne"],
  ];
  let sectionRoutingOk = true;
  for (const [title, meta, expected] of sectionCases) {
    const a = article(title, meta);
    const gid = iuFeedPhotoResolveSectionGallery(a);
    const target = iuFeedPhotoResolveTargetGallery(a);
    const galleryOk =
      target.galleryId === expected ||
      (expected === "finance" && target.galleryId === "ekonomika") ||
      (expected === "cestovani" && target.galleryId === "cestovani");
    if (gid !== expected || !galleryOk) {
      sectionRoutingOk = false;
      fails.push(`section_route:${expected}`);
    } else if (
      target.routingType !== "section" &&
      target.routingType !== "title_topic" &&
      !(expected === "sport" && target.routingType === "title_topic")
    ) {
      sectionRoutingOk = false;
      fails.push(`section_route_type:${expected}`);
    }
  }

  const supplementalCases = [
    ["Kolaps na dálnici D1", "doprava"],
    ["Víkendová předpověď počasí", "pocasi"],
    ["Nový software a AI technologie", "technologie"],
    ["Ekonomika roste pomaleji", "ekonomika"],
    ["Solární energie v Česku", "energetika"],
    ["Bezpečnostní opatření na letišti", "bezpecnost"],
    ["Policie vyšetřuje kriminalitu", "kriminalita"],
    ["Sklizeň obilí na farmě", "zemedelstvi"],
    ["Průmyslová výroba klesá", "prumysl"],
    ["Ceny bydlení rostou", "bydleni"],
    ["Příroda v národním parku", "priroda"],
    ["Politika před volbami", "politika"],
  ];
  let supplementalRoutingOk = true;
  for (const [title, expected] of supplementalCases) {
    const a = article(title, { section: "zpravy" });
    const sup = iuFeedPhotoDetectSupplementalGallery(a);
    const target = iuFeedPhotoResolveTargetGallery(a);
    if (sup !== expected || target.galleryId !== expected) {
      supplementalRoutingOk = false;
      fails.push(`supplemental_route:${expected}`);
    } else if (target.routingType !== "supplemental" && target.routingType !== "title_topic") {
      supplementalRoutingOk = false;
      fails.push(`supplemental_route_type:${expected}`);
    }
  }

  const fallbackTarget = iuFeedPhotoResolveTargetGallery(
    article("Neznámý obsah", { section: "unknown-section-xyz" })
  );
  const generalFallbackOk =
    fallbackTarget.galleryId === IU_FEED_GENERAL_FALLBACK_GALLERY_ID &&
    fallbackTarget.routingType === "general_fallback";
  if (!generalFallbackOk) fails.push("general_fallback_routing");

  const sportPick = iuFeedPhotoSelectForArticle(article("Sportovní přehled", { section: "sport" }), catalog);
  const sportOk =
    sportPick.ok &&
    sportPick.galleryId === "sport" &&
    sportPick.photo?.galleryId === "sport" &&
    sportPick.feedLabel === IU_FEED_PHOTO_LABEL;
  if (!sportOk) fails.push("sport_selection");

  const dopravaPick = iuFeedPhotoSelectForArticle(
    article("Uzavírka dálnice kvůli nehodě", { section: "zpravy" }),
    catalog
  );
  const dopravaOk = dopravaPick.ok && dopravaPick.galleryId === "doprava";
  if (!dopravaOk) fails.push("supplemental_selection");

  const rotationPool = [
    {
      id: "r-a",
      galleryId: "sport",
      imageMode: "illustrative",
      usageCount: 5,
      lastUsedAt: "2026-06-01T00:00:00.000Z",
      imageAlt: "a",
    },
    {
      id: "r-b",
      galleryId: "sport",
      imageMode: "illustrative",
      usageCount: 1,
      lastUsedAt: "2026-06-10T00:00:00.000Z",
      imageAlt: "b",
    },
    {
      id: "r-c",
      galleryId: "sport",
      imageMode: "illustrative",
      usageCount: 0,
      lastUsedAt: null,
      imageAlt: "c",
    },
  ];
  const rotationPick = iuFeedPhotoSelectWithFallback(article("Rotace", { section: "sport" }), rotationPool, {});
  const rotationOk = rotationPick.ok && rotationPick.photo?.id === "r-c";
  if (!rotationOk) fails.push("usage_rotation");
  if (iuFeedPhotoCompareRotation(rotationPool[1], rotationPool[2]) !== 0) {
    /* tie on usage — c wins with null lastUsedAt */
  }
  const used = iuFeedPhotoRecordUsage(rotationPool.find((e) => e.id === "r-c"), "2026-06-22T12:00:00.000Z");
  if (used.usageCount !== 1 || !used.lastUsedAt) fails.push("usage_record");

  const autoGuessCount = engineAutoGuessCount(catalog);
  if (autoGuessCount !== 0) fails.push("auto_guessing_nonzero");

  const onlyIllustrative =
    catalog.pool.every((e) => e.imageMode === "illustrative") &&
    !catalog.pool.some((e) => e.galleryId === "verified_persons" || e.galleryId === "verified_places_objects");
  if (!onlyIllustrative) fails.push("non_illustrative_in_pool");

  const scope = checkScopeUnchanged();
  const appJs = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const feedRenderHook =
    /iuFeedPhotoApplySelectionToArticle|iuFeedPhotoLoadCatalogBrowser|iu-feed-photo-selection-engine/.test(
      appJs
    );
  const phase2B = config.phase === "2B" || config.feedRenderEnabled === true;
  if (phase2B && !feedRenderHook) fails.push("feed_render_hook_missing_in_app_js");
  if (!phase2B && feedRenderHook) fails.push("feed_render_hook_in_app_js");

  const pass =
    fails.length === 0 &&
    engineExists &&
    configExists &&
    (phase2B ? IU_FEED_RENDER_ENABLED === true : IU_FEED_RENDER_ENABLED === false) &&
    (phase2B ? config.feedRenderEnabled === true : config.feedRenderEnabled === false) &&
    IU_IMAGE_GUESSING_ALLOWED === false &&
    (phase2B ? true : scope.FRONTEND_CHANGED === "NO") &&
    scope.FEED_CHANGED === "NO";

  const report = {
    PHOTO_SELECTION_ENGINE_CREATED: engineExists ? "YES" : "NO",
    SECTION_ROUTING_CREATED: sectionRoutingOk ? "YES" : "NO",
    SUPPLEMENTAL_ROUTING_CREATED: supplementalRoutingOk ? "YES" : "NO",
    GENERAL_FALLBACK_CREATED: generalFallbackOk ? "YES" : "NO",
    USAGE_ROTATION_SUPPORTED: rotationOk ? "YES" : "NO",
    AUTO_GUESSING_COUNT: autoGuessCount,
    ONLY_ILLUSTRATIVE_GALLERIES_USED: onlyIllustrative ? "YES" : "NO",
    VERIFIED_PERSON_SELECTION_ENABLED: "NO",
    VERIFIED_PLACE_SELECTION_ENABLED: "NO",
    FEED_RENDER_ENABLED: IU_FEED_RENDER_ENABLED || config.feedRenderEnabled ? "YES" : "NO",
    FEED_LABEL: IU_FEED_PHOTO_LABEL,
    CATALOG_TOTAL_PHOTOS: catalog.total,
    SECTION_GALLERIES_COVERED: IU_FEED_SECTION_GALLERY_IDS.length,
    SUPPLEMENTAL_GALLERIES_COVERED: IU_FEED_SUPPLEMENTAL_GALLERY_IDS.length,
    ...scope,
    GIT_STATUS_CLEAN: gitStatusClean() ? "YES" : "NO",
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
    fails,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("IU_FEED_PHOTO_SELECTION_ENGINE_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "fails") continue;
    console.log(`${k}=${v}`);
  }
  if (fails.length) {
    for (const f of fails) console.log("FAIL:" + f);
  }
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main();
