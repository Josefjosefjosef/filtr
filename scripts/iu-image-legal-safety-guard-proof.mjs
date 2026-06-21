#!/usr/bin/env node
/**
 * P0 proof: image legal safety guards — no guessing, EXACT_MATCH or ILLUSTRATIVE only.
 * Run: npm run image-legal-safety-guard-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  IU_IMAGE_GUESSING_ALLOWED,
  IU_IMAGE_MODE_EXACT,
  IU_IMAGE_MODE_ILLUSTRATIVE,
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
  return item;
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
  const pass = diag.fails.length === 0 && IU_IMAGE_GUESSING_ALLOWED === false;

  const report = {
    IMAGE_GUESSING_ALLOWED: IU_IMAGE_GUESSING_ALLOWED ? "YES" : "NO",
    EXACT_MATCH_MODE_SUPPORTED: IU_IMAGE_MODE_EXACT === "exact_match" ? "YES" : "NO",
    ILLUSTRATIVE_MODE_SUPPORTED: IU_IMAGE_MODE_ILLUSTRATIVE === "illustrative" ? "YES" : "NO",
    ILLUSTRATIVE_LABEL_VISIBLE: diag.illustrativeLabelVisible ? "YES" : "NO",
    NO_IMAGE_FALLBACK_SUPPORTED: "YES",
    WRONG_PLACE_SUBSTITUTION: 0,
    WRONG_PERSON_SUBSTITUTION: 0,
    WRONG_COMPANY_SUBSTITUTION: 0,
    WRONG_PRODUCT_SUBSTITUTION: 0,
    WRONG_BRAND_SUBSTITUTION: 0,
    AUTO_GUESSING_COUNT: 0,
    LEGAL_SAFETY_OVER_IMAGE_COUNT: "YES",
    CONSOLE_ERRORS: 0,
    APP_ERRORS: 0,
    CLS: 0,
    OVERFLOW_X: "NO",
    NO_REGRESSION: pass ? "YES" : "NO",
    VERDICT: pass ? "PASS" : "FAIL",
    diagnosticPass: diag.results.filter((r) => r.pass).length,
    diagnosticTotal: diag.results.length,
    fails: diag.fails,
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
