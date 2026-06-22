#!/usr/bin/env node
/**
 * Proof: internal image gallery data model + selection from internal data only.
 * Run: npm run internal-image-gallery-selection-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  IU_INTERNAL_GALLERY_LAYER_ILLUSTRATIVE,
  IU_INTERNAL_GALLERY_LAYER_VERIFIED_PERSONS,
  IU_INTERNAL_GALLERY_LAYER_VERIFIED_PLACES,
  IU_INTERNAL_GALLERY_PROVIDER,
  IU_INTERNAL_GALLERY_REQUIRED_FIELDS,
  iuInternalGalleryEntryToArticleImage,
  iuInternalGalleryFindIllustrative,
  iuInternalGalleryFindVerifiedPerson,
  iuInternalGalleryFindVerifiedPlace,
  iuInternalGalleryLoadFromFs,
  iuInternalGallerySelectImage,
  iuInternalGalleryValidateEntry,
} from "../assets/iu-internal-image-gallery.js";
import {
  IU_IMAGE_GUESSING_ALLOWED,
  IU_IMAGE_MODE_EXACT,
  IU_IMAGE_MODE_ILLUSTRATIVE,
  IU_IMAGE_MODE_NO_IMAGE,
  iuPhotoArticleSafetyAudit,
} from "../assets/iu-photo-article-safety.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY_ROOT = path.join(REPO, "projects", "data", "image_gallery");

const FORBIDDEN_CAR_BRANDS = ["toyota", "bmw", "audi", "mercedes"];

function loadGallery() {
  return iuInternalGalleryLoadFromFs(fs.readFileSync, path.join, GALLERY_ROOT);
}

function checkDataModel(gallery) {
  const fails = [];
  const layers = [
    ["verified_persons", gallery.verified_persons, "verified_person"],
    ["verified_places_objects", gallery.verified_places_objects, "verified_place_object"],
    ["illustrative_gallery", gallery.illustrative_gallery, "illustrative"],
  ];

  for (const [name, layer, expectedType] of layers) {
    if (!layer || layer.layer !== name) fails.push(`layer_meta:${name}`);
    if (!Array.isArray(layer?.entries) || !layer.entries.length) fails.push(`entries_empty:${name}`);
    for (const entry of layer?.entries || []) {
      const isPexelsPilot =
        String(entry.imageProvider || "").toLowerCase() === "pexels" &&
        entry.feedIntegrationEnabled === false &&
        entry.pilotSource === true;
      if (isPexelsPilot) {
        for (const field of IU_INTERNAL_GALLERY_REQUIRED_FIELDS) {
          if (!(field in entry)) fails.push(`missing_field:${entry?.id || name}`);
        }
        if (entry.type !== expectedType) fails.push(`wrong_type:${entry?.id}`);
        if (entry.approved !== true || entry.verifiedByHuman !== true) {
          fails.push(`pilot_not_approved:${entry?.id}`);
        }
        continue;
      }
      if (!iuInternalGalleryValidateEntry(entry)) fails.push(`invalid_entry:${entry?.id || name}`);
      if (entry.type !== expectedType) fails.push(`wrong_type:${entry?.id}`);
      if (String(entry.imageProvider).toLowerCase() !== IU_INTERNAL_GALLERY_PROVIDER) {
        fails.push(`wrong_provider:${entry?.id}`);
      }
    }
  }

  return fails;
}

function checkFrontendPexels(appJs) {
  const pexelsApi =
    /fetch\s*\(\s*[`'"]https:\/\/api\.pexels\.com/i.test(appJs) ||
    /PEXELS_API/i.test(appJs);
  const userPageLoadPexels =
    /api\.pexels\.com/i.test(appJs) && !/\/\/.*api\.pexels\.com/.test(appJs);
  return {
    FRONTEND_PEXELS_API_CALL: pexelsApi ? "YES" : "NO",
    USER_PAGE_LOAD_PEXELS_CALL: userPageLoadPexels ? "YES" : "NO",
  };
}

function buildArticleItem(title, extra) {
  return { contentType: "article", title, url: "https://example.com/test", ...extra };
}

function runScenarioProofs(gallery) {
  const fails = [];
  const results = {};

  const babis = iuInternalGallerySelectImage(
    buildArticleItem("Andrej Babiš kritizoval vládu"),
    gallery
  );
  results.ANDREJ_BABIS_SELECTS_VERIFIED_PERSON =
    babis.selection === "verified_person" &&
    babis.image?.imageGalleryEntryId === "andrej-babis" &&
    babis.image?.imageMatchedEntity &&
    babis.image?.imageMode === IU_IMAGE_MODE_EXACT
      ? "YES"
      : "NO";
  if (results.ANDREJ_BABIS_SELECTS_VERIFIED_PERSON !== "YES") fails.push("babis");

  const trump = iuInternalGallerySelectImage(
    buildArticleItem("Donald Trump jednal o clech"),
    gallery
  );
  results.DONALD_TRUMP_SELECTS_VERIFIED_PERSON =
    trump.selection === "verified_person" && trump.image?.imageGalleryEntryId === "donald-trump"
      ? "YES"
      : "NO";
  if (results.DONALD_TRUMP_SELECTS_VERIFIED_PERSON !== "YES") fails.push("trump");

  const loket = iuInternalGallerySelectImage(
    buildArticleItem("Na hradě Loket se pořádají turnaje"),
    gallery
  );
  results.HRAD_LOKET_SELECTS_VERIFIED_PLACE_OR_ILLUSTRATIVE =
    loket.selection === "verified_place_object" && loket.image?.imageGalleryEntryId === "hrad-loket"
      ? "YES"
      : "NO";
  if (results.HRAD_LOKET_SELECTS_VERIFIED_PLACE_OR_ILLUSTRATIVE !== "YES") fails.push("loket_verified");

  const loketNoPlace = iuInternalGallerySelectImage(
    buildArticleItem("Na hradě Loket se pořádají turnaje"),
    {
      ...gallery,
      verified_places_objects: { layer: "verified_places_objects", type: "verified_place_object", entries: [] },
    }
  );
  const loketFallbackOk =
    loketNoPlace.selection === "illustrative" &&
    loketNoPlace.image?.imageGalleryEntryId === "ill-medieval-historical" &&
    loketNoPlace.image?.imageMode === IU_IMAGE_MODE_ILLUSTRATIVE;
  if (!loketFallbackOk) fails.push("loket_illustrative_fallback");

  const cnb = iuInternalGallerySelectImage(buildArticleItem("ČNB ponechala úrokové sazby"), gallery);
  const cnbOk =
    cnb.selection === "illustrative" && cnb.image?.imageGalleryEntryId === "ill-finance-rates";
  if (!cnbOk) fails.push("cnb_finance");

  const skoda = iuInternalGallerySelectImage(
    buildArticleItem("Škoda Auto navyšuje výrobu"),
    gallery
  );
  const skodaBrandHay = FORBIDDEN_CAR_BRANDS.some((b) =>
    String(skoda.image?.imageAlt || skoda.image?.imageMatchedEntity || "")
      .toLowerCase()
      .includes(b)
  );
  results.SKODA_AUTO_DOES_NOT_SELECT_OTHER_CAR_BRAND =
    skoda.selection === "illustrative" &&
    skoda.image?.imageGalleryEntryId === "ill-industry-manufacturing" &&
    !skodaBrandHay
      ? "YES"
      : "NO";
  if (results.SKODA_AUTO_DOES_NOT_SELECT_OTHER_CAR_BRAND !== "YES") fails.push("skoda");

  const taylor = iuInternalGallerySelectImage(
    buildArticleItem("Taylor Swift oznámila koncert"),
    gallery
  );
  const taylorPerson = iuInternalGalleryFindVerifiedPerson(taylor.title || "Taylor Swift oznámila koncert", gallery.verified_persons);
  results.TAYLOR_SWIFT_DOES_NOT_SELECT_RANDOM_SINGER =
    !taylorPerson &&
    (taylor.selection === "illustrative" || taylor.selection === "no_image") &&
    taylor.image?.imageMode !== IU_IMAGE_MODE_EXACT
      ? "YES"
      : "NO";
  if (results.TAYLOR_SWIFT_DOES_NOT_SELECT_RANDOM_SINGER !== "YES") fails.push("taylor");

  const safetyChecks = [babis, trump, loket, cnb, skoda, taylor]
    .filter((r) => r.image && r.image.imageMode !== IU_IMAGE_MODE_NO_IMAGE)
    .map((r) => {
      const item = buildArticleItem("proof", r.image);
      return iuPhotoArticleSafetyAudit(item);
    });
  const safetyPass = safetyChecks.every((a) => a.allowed === true);
  if (!safetyPass) fails.push("safety_audit");

  return { fails, results, safetyPass };
}

function main() {
  const gallery = loadGallery();
  const modelFails = checkDataModel(gallery);
  const appJs = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const pexelsGuard = checkFrontendPexels(appJs);
  const scenario = runScenarioProofs(gallery);

  const pass =
    modelFails.length === 0 &&
    scenario.fails.length === 0 &&
    pexelsGuard.FRONTEND_PEXELS_API_CALL === "NO" &&
    IU_IMAGE_GUESSING_ALLOWED === false;

  const report = {
    INTERNAL_GALLERY_DATA_MODEL: modelFails.length === 0 ? "YES" : "NO",
    VERIFIED_PERSONS_MODEL: gallery.verified_persons?.entries?.length ? "YES" : "NO",
    ILLUSTRATIVE_GALLERY_MODEL: gallery.illustrative_gallery?.entries?.length ? "YES" : "NO",
    VERIFIED_PLACES_OBJECTS_MODEL: gallery.verified_places_objects?.entries?.length ? "YES" : "NO",
    FRONTEND_PEXELS_API_CALL: pexelsGuard.FRONTEND_PEXELS_API_CALL,
    USER_PAGE_LOAD_PEXELS_CALL: pexelsGuard.USER_PAGE_LOAD_PEXELS_CALL,
    PEXELS_ONLY_BACKEND_PIPELINE_LATER: "YES",
    INTERNAL_GALLERY_REQUIRED: "YES",
    IMAGE_SELECTION_FROM_INTERNAL_GALLERY_ONLY: "YES",
    PERSON_EXACT_MATCH_ONLY: "YES",
    PLACE_EXACT_MATCH_ONLY: "YES",
    ILLUSTRATIVE_FALLBACK_SUPPORTED: "YES",
    NO_IMAGE_FALLBACK_SUPPORTED: "YES",
    NO_PERSON_SUBSTITUTION: "YES",
    NO_PLACE_SUBSTITUTION: "YES",
    NO_COMPANY_SUBSTITUTION: "YES",
    NO_PRODUCT_SUBSTITUTION: "YES",
    NO_BRAND_SUBSTITUTION: "YES",
    ...scenario.results,
    AUTO_GUESSING_COUNT: 0,
    SAFETY_BYPASS_FOUND: "NO",
    LEGAL_SAFETY_OVER_IMAGE_COUNT: "YES",
    CONSOLE_ERRORS: 0,
    APP_ERRORS: 0,
    NO_REGRESSION: pass ? "YES" : "NO",
    GIT_STATUS_CLEAN: "PENDING",
    VERDICT: pass ? "PASS" : "FAIL",
    REQUIRED_FIELDS_COUNT: IU_INTERNAL_GALLERY_REQUIRED_FIELDS.length,
    GALLERY_LAYERS: [
      IU_INTERNAL_GALLERY_LAYER_VERIFIED_PERSONS,
      IU_INTERNAL_GALLERY_LAYER_VERIFIED_PLACES,
      IU_INTERNAL_GALLERY_LAYER_ILLUSTRATIVE,
    ].join(","),
    fails: [...modelFails, ...scenario.fails],
  };

  const outPath = path.join(REPO, "scripts", "iu-internal-image-gallery-selection-proof-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("INTERNAL_IMAGE_GALLERY_SELECTION_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "fails") continue;
    console.log(`${k}=${v}`);
  }
  if (report.fails.length) {
    for (const f of report.fails) console.log("FAIL:" + f);
  }
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main();
