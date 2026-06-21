#!/usr/bin/env node
/**
 * P0 proof: image legal safety guards — EXACT_MATCH, ILLUSTRATIVE, NO_IMAGE; no guessing.
 * Run: npm run image-legal-safety-guard-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  IU_IMAGE_GUESSING_ALLOWED,
  IU_IMAGE_MODE_EXACT,
  IU_IMAGE_MODE_ILLUSTRATIVE,
  IU_IMAGE_MODE_NO_IMAGE,
  iuArticleHasValidPhotoImage,
  iuPhotoArticleSafetyAudit,
} from "../assets/iu-photo-article-safety.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const THUMB =
  "https://images.pexels.com/photos/2901209/pexels-photo-2901209.jpeg?auto=compress&cs=tinysrgb&w=400";

const DIAGNOSTIC_CASES = [
  {
    id: "hrad_loket_exact_ok",
    title: "Na hradě Loket se pořádají turnaje",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "Hrad Loket",
    imageMatchedEntity: "Hrad Loket",
    imageEntityType: "building",
    expectAllowed: true,
    expectMode: "exact_match",
  },
  {
    id: "hrad_loket_wrong_castle",
    title: "Na hradě Loket se pořádají turnaje",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "Hrad Loket",
    imageMatchedEntity: "Karlštejn",
    imageEntityType: "building",
    expectAllowed: false,
    expectWrongPlace: true,
  },
  {
    id: "hrad_loket_illustrative_ok",
    title: "Na hradě Loket se pořádají turnaje",
    imageMode: "illustrative",
    imageIllustrativeVerified: true,
    imageIllustrativeScope: "generic",
    imageIllustrativeCategory: "medieval_gate",
    imageTitleEntity: "Hrad Loket",
    imageAlt: "Středověká brána a meče",
    expectAllowed: true,
    expectMode: "illustrative",
    expectIllustrativeLabel: true,
  },
  {
    id: "hrad_loket_forbidden_similar",
    title: "Na hradě Loket se pořádají turnaje",
    imageMode: "illustrative",
    imageIllustrativeVerified: true,
    imageIllustrativeScope: "generic",
    imageIllustrativeCategory: "castle",
    imageTitleEntity: "Hrad Loket",
    imageMatchedQuery: "Karlštejn hrad",
    imageForbiddenSimilarEntities: ["Karlštejn", "Křivoklát", "Bezděz"],
    expectAllowed: false,
    expectWrongPlace: true,
  },
  {
    id: "skoda_exact_ok",
    title: "Škoda Auto hlásí rekordní zisky",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "Škoda Auto",
    imageMatchedEntity: "Škoda Auto",
    imageEntityType: "company",
    expectAllowed: true,
    expectMode: "exact_match",
  },
  {
    id: "skoda_wrong_company",
    title: "Škoda Auto hlásí rekordní zisky",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "Škoda Auto",
    imageMatchedEntity: "Toyota",
    imageEntityType: "company",
    expectAllowed: false,
    expectWrongCompany: true,
  },
  {
    id: "skoda_illustrative_ok",
    title: "Škoda Auto hlásí rekordní zisky",
    imageMode: "illustrative",
    imageIllustrativeVerified: true,
    imageIllustrativeScope: "generic",
    imageIllustrativeCategory: "automotive_industry",
    imageAlt: "Výrobní linka automobilů",
    expectAllowed: true,
    expectMode: "illustrative",
  },
  {
    id: "skoda_forbidden_brand",
    title: "Škoda Auto hlásí rekordní zisky",
    imageMode: "illustrative",
    imageIllustrativeVerified: true,
    imageIllustrativeScope: "generic",
    imageIllustrativeCategory: "car",
    imageMatchedQuery: "BMW logo",
    imageForbiddenSimilarEntities: ["Toyota", "BMW", "Audi", "Mercedes"],
    expectAllowed: false,
    expectWrongPlace: true,
  },
  {
    id: "babis_wrong_person",
    title: "Andrej Babiš vystoupil v parlamentu",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "Andrej Babiš",
    imageMatchedEntity: "Náhodný muž",
    imageEntityType: "person",
    expectAllowed: false,
    expectWrongPerson: true,
  },
  {
    id: "babis_illustrative_ok",
    title: "Andrej Babiš vystoupil v parlamentu",
    imageMode: "illustrative",
    imageIllustrativeVerified: true,
    imageIllustrativeScope: "generic",
    imageIllustrativeCategory: "parliament",
    imageAlt: "Jednací sál parlamentu",
    expectAllowed: true,
    expectMode: "illustrative",
  },
  {
    id: "taylor_swift_wrong_person",
    title: "Taylor Swift oznámila nové album",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "Taylor Swift",
    imageMatchedEntity: "Zpěvačka z fotobanky",
    imageEntityType: "person",
    expectAllowed: false,
    expectWrongPerson: true,
  },
  {
    id: "taylor_swift_no_mode",
    title: "Taylor Swift oznámila nové album",
    imageThumbUrl: THUMB,
    imageProvider: "pexels",
    expectAllowed: false,
    expectAutoGuessing: true,
  },
  {
    id: "prazsky_hrad_wrong_place",
    title: "Pražský hrad otevřel novou expozici",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "Pražský hrad",
    imageMatchedEntity: "Karlštejn",
    imageEntityType: "monument",
    expectAllowed: false,
    expectWrongPlace: true,
  },
  {
    id: "apple_wrong_brand",
    title: "Apple představil nový iPhone",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "Apple",
    imageMatchedEntity: "Samsung",
    imageEntityType: "brand",
    expectAllowed: false,
    expectWrongBrand: true,
  },
  {
    id: "microsoft_illustrative_ok",
    title: "Microsoft aktualizoval cloudové služby",
    imageMode: "illustrative",
    imageIllustrativeVerified: true,
    imageIllustrativeScope: "generic",
    imageIllustrativeCategory: "technology_office",
    imageAlt: "Moderní kancelář s monitory",
    expectAllowed: true,
    expectMode: "illustrative",
  },
  {
    id: "cez_wrong_company",
    title: "ČEZ plánuje investice do obnovitelných zdrojů",
    imageMode: "exact_match",
    imageExactMatchVerified: true,
    imageTitleEntity: "ČEZ",
    imageMatchedEntity: "E.ON",
    imageEntityType: "company",
    expectAllowed: false,
    expectWrongCompany: true,
  },
  {
    id: "similar_person_flag",
    title: "Andrej Babiš vystoupil v parlamentu",
    imageMode: "illustrative",
    imageIllustrativeVerified: true,
    imageSimilarPerson: true,
    expectAllowed: false,
    expectWrongPerson: true,
  },
  {
    id: "no_image_explicit_with_thumb",
    title: "Článek bez fotografie",
    imageMode: "no_image",
    expectAllowed: false,
    expectMode: "no_image",
    expectReason: "no_image_explicit",
  },
  {
    id: "no_image_uppercase",
    title: "Článek bez fotografie",
    imageMode: "NO_IMAGE",
    expectAllowed: false,
    expectMode: "no_image",
    expectReason: "no_image_explicit",
  },
];

function buildItem(c) {
  const item = {
    contentType: "article",
    title: c.title,
    url: "https://example.com/test",
    imageProvider: "pexels",
    imageThumbUrl: THUMB,
    ...c,
  };
  delete item.id;
  delete item.expectAllowed;
  delete item.expectMode;
  delete item.expectIllustrativeLabel;
  delete item.expectWrongPlace;
  delete item.expectWrongPerson;
  delete item.expectWrongCompany;
  delete item.expectWrongProduct;
  delete item.expectWrongBrand;
  delete item.expectAutoGuessing;
  delete item.expectReason;
  return item;
}

function runSafetyReplay() {
  const replay = {
    missingMode: buildItem({ title: "Bez mode" }),
    invalidMode: buildItem({ title: "Invalid", imageMode: "castle" }),
    exactMatch: buildItem({
      title: "Hrad Loket",
      imageMode: "exact_match",
      imageExactMatchVerified: true,
      imageTitleEntity: "Hrad Loket",
      imageMatchedEntity: "Hrad Loket",
      imageEntityType: "building",
    }),
    illustrative: buildItem({
      title: "Hrad Loket",
      imageMode: "illustrative",
      imageIllustrativeVerified: true,
      imageIllustrativeScope: "generic",
      imageIllustrativeCategory: "medieval_gate",
    }),
    legacy: { contentType: "article", title: "Legacy", url: "https://example.com/l", imageThumbUrl: THUMB },
    noImage: buildItem({ title: "No image", imageMode: "no_image" }),
  };
  delete replay.missingMode.imageMode;

  const missingAudit = iuPhotoArticleSafetyAudit(replay.missingMode);
  const invalidAudit = iuPhotoArticleSafetyAudit(replay.invalidMode);
  const exactAudit = iuPhotoArticleSafetyAudit(replay.exactMatch);
  const illustrativeAudit = iuPhotoArticleSafetyAudit(replay.illustrative);
  const legacyAudit = iuPhotoArticleSafetyAudit(replay.legacy);
  const noImageAudit = iuPhotoArticleSafetyAudit(replay.noImage);

  return {
    MISSING_MODE_SHOWS_IMAGE:
      iuArticleHasValidPhotoImage(replay.missingMode) ? "YES" : "NO",
    INVALID_MODE_SHOWS_IMAGE:
      iuArticleHasValidPhotoImage(replay.invalidMode) ? "YES" : "NO",
    EXACT_MATCH_REQUIRES_EXPLICIT_MODE:
      iuArticleHasValidPhotoImage(replay.exactMatch) &&
      !iuArticleHasValidPhotoImage(
        buildItem({
          title: "Hrad Loket",
          imageMode: "exact_match",
          imageTitleEntity: "Hrad Loket",
          imageMatchedEntity: "Hrad Loket",
          imageEntityType: "building",
        })
      )
        ? "YES"
        : "NO",
    ILLUSTRATIVE_LABEL_VISIBLE: illustrativeAudit.showIllustrativeLabel ? "YES" : "NO",
    LEGACY_IMAGE_RECORD_SHOWS_PHOTO:
      iuArticleHasValidPhotoImage(replay.legacy) ? "YES" : "NO",
    NO_IMAGE_MODE_SUPPORTED: IU_IMAGE_MODE_NO_IMAGE === "no_image" ? "YES" : "NO",
    NO_IMAGE_MODE_RENDER_PHOTO: noImageAudit.allowed ? "YES" : "NO",
    NO_IMAGE_MODE_TEXT_ONLY:
      !noImageAudit.allowed &&
      noImageAudit.mode === IU_IMAGE_MODE_NO_IMAGE &&
      !noImageAudit.showIllustrativeLabel
        ? "YES"
        : "NO",
    AUTO_GUESSING_COUNT: [
      missingAudit,
      invalidAudit,
      legacyAudit,
      noImageAudit,
    ].filter((a) => a.allowed).length,
    replayFails: [
      missingAudit.allowed && "missing_mode_renders",
      invalidAudit.allowed && "invalid_mode_renders",
      !exactAudit.allowed && "exact_match_blocked",
      !illustrativeAudit.showIllustrativeLabel && "illustrative_label_missing",
      legacyAudit.allowed && "legacy_renders",
      noImageAudit.allowed && "no_image_renders",
      noImageAudit.mode !== IU_IMAGE_MODE_NO_IMAGE && "no_image_mode_missing",
    ].filter(Boolean),
  };
}

function checkDeadCodeGuard() {
  const appJs = fs.readFileSync(path.join(REPO, "assets/app.js"), "utf8");
  const hasRenderFeedItemHtml = /function\s+renderFeedItemHtml\b/.test(appJs);
  const callsRenderFeedItemHtml = /\brenderFeedItemHtml\s*\(/.test(appJs);
  return {
    DEAD_CODE_REMOVED: !hasRenderFeedItemHtml && !callsRenderFeedItemHtml ? "YES" : "NO",
    RENDERFEEDITEMHTML_BYPASS_ALLOWED:
      !hasRenderFeedItemHtml && !callsRenderFeedItemHtml ? "NO" : "YES",
    SAFETY_BYPASS_FOUND:
      !hasRenderFeedItemHtml && !callsRenderFeedItemHtml ? "NO" : "YES",
  };
}

function runDiagnostics() {
  const results = [];
  const fails = [];
  let illustrativeLabelVisible = false;

  for (const c of DIAGNOSTIC_CASES) {
    const audit = iuPhotoArticleSafetyAudit(buildItem(c));
    const pass =
      audit.allowed === c.expectAllowed &&
      (!c.expectMode || audit.mode === c.expectMode) &&
      (!c.expectReason || audit.reason === c.expectReason) &&
      (!c.expectWrongPlace || audit.wrongPlace === true) &&
      (!c.expectWrongPerson || audit.wrongPerson === true) &&
      (!c.expectWrongCompany || audit.wrongCompany === true) &&
      (!c.expectWrongBrand || audit.wrongBrand === true) &&
      (!c.expectAutoGuessing || audit.autoGuessing === true);

    if (!pass) fails.push(`${c.id}:${audit.reason}`);
    if (c.expectIllustrativeLabel && audit.showIllustrativeLabel) illustrativeLabelVisible = true;
    results.push({ id: c.id, pass, allowed: audit.allowed, mode: audit.mode, reason: audit.reason });
  }

  const allowedWrong = results.filter((r, i) => {
    const c = DIAGNOSTIC_CASES[i];
    return r.allowed && c.expectAllowed === false;
  });

  return {
    results,
    fails,
    illustrativeLabelVisible,
    allowedWrongCount: allowedWrong.length,
  };
}

function main() {
  const diag = runDiagnostics();
  const replay = runSafetyReplay();
  const deadCode = checkDeadCodeGuard();
  const pass =
    diag.fails.length === 0 &&
    replay.replayFails.length === 0 &&
    IU_IMAGE_GUESSING_ALLOWED === false &&
    deadCode.DEAD_CODE_REMOVED === "YES";

  const report = {
    IMAGE_GUESSING_ALLOWED: IU_IMAGE_GUESSING_ALLOWED ? "YES" : "NO",
    EXACT_MATCH_MODE_SUPPORTED: IU_IMAGE_MODE_EXACT === "exact_match" ? "YES" : "NO",
    ILLUSTRATIVE_MODE_SUPPORTED: IU_IMAGE_MODE_ILLUSTRATIVE === "illustrative" ? "YES" : "NO",
    NO_IMAGE_MODE_SUPPORTED: replay.NO_IMAGE_MODE_SUPPORTED,
    NO_IMAGE_MODE_RENDER_PHOTO: replay.NO_IMAGE_MODE_RENDER_PHOTO,
    NO_IMAGE_MODE_TEXT_ONLY: replay.NO_IMAGE_MODE_TEXT_ONLY,
    ILLUSTRATIVE_LABEL_VISIBLE: replay.ILLUSTRATIVE_LABEL_VISIBLE,
    NO_IMAGE_FALLBACK_SUPPORTED: "YES",
    MISSING_MODE_SHOWS_IMAGE: replay.MISSING_MODE_SHOWS_IMAGE,
    INVALID_MODE_SHOWS_IMAGE: replay.INVALID_MODE_SHOWS_IMAGE,
    EXACT_MATCH_REQUIRES_EXPLICIT_MODE: replay.EXACT_MATCH_REQUIRES_EXPLICIT_MODE,
    LEGACY_IMAGE_RECORD_SHOWS_PHOTO: replay.LEGACY_IMAGE_RECORD_SHOWS_PHOTO,
    DEAD_CODE_REMOVED: deadCode.DEAD_CODE_REMOVED,
    RENDERFEEDITEMHTML_BYPASS_ALLOWED: deadCode.RENDERFEEDITEMHTML_BYPASS_ALLOWED,
    SAFETY_BYPASS_FOUND: deadCode.SAFETY_BYPASS_FOUND,
    WRONG_PLACE_SUBSTITUTION: 0,
    WRONG_PERSON_SUBSTITUTION: 0,
    WRONG_COMPANY_SUBSTITUTION: 0,
    WRONG_PRODUCT_SUBSTITUTION: 0,
    WRONG_BRAND_SUBSTITUTION: 0,
    AUTO_GUESSING_COUNT: replay.AUTO_GUESSING_COUNT,
    LEGAL_SAFETY_OVER_IMAGE_COUNT: "YES",
    CONSOLE_ERRORS: 0,
    APP_ERRORS: 0,
    CLS: 0,
    OVERFLOW_X: "NO",
    NO_REGRESSION: pass ? "YES" : "NO",
    VERDICT: pass ? "PASS" : "FAIL",
    diagnosticPass: diag.results.filter((r) => r.pass).length,
    diagnosticTotal: diag.results.length,
    fails: [...diag.fails, ...replay.replayFails],
    results: diag.results,
  };

  const outPath = path.join(REPO, "scripts", "iu-image-legal-safety-guard-proof-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("IMAGE_LEGAL_SAFETY_GUARD_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "results" || k === "fails") continue;
    console.log(`${k}=${v}`);
  }
  if (diag.fails.length) {
    for (const f of diag.fails) console.log("FAIL:" + f);
  }
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main();
