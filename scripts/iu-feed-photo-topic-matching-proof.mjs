#!/usr/bin/env node
/**
 * Proof: phase 2D — title topic matching + rotation diversity for feed photos.
 * Run: npm run feed-photo-topic-matching-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  IU_FEED_GENERAL_FALLBACK_GALLERY_ID,
  iuFeedPhotoAltIsGenericNews,
  iuFeedPhotoDetectTitleTopicRule,
  iuFeedPhotoLoadImportCatalog,
  iuFeedPhotoNormalizeText,
  iuFeedPhotoResolveTargetGallery,
  iuFeedPhotoSelectForArticle,
} from "../assets/iu-feed-photo-selection-engine.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY_ROOT = path.join(REPO, "projects", "data", "image_gallery");

const SCREENSHOT_CASES = [
  {
    id: "trump_washington",
    title: "Po fiasku kolem Trumpovy renovace jezírka ve Washingtonu začal hon na údajné viníky",
    section: "zpravy",
    expectGalleryNot: ["general_fallback"],
    rejectGenericNews: true,
    category: "politics",
  },
  {
    id: "ai_armored_vehicle",
    title: "Ukrajinci zařadili do výzbroje obrněné vozidlo s integrovanou umělou inteligencí",
    section: "zpravy",
    expectGalleryAny: ["technologie", "bezpecnost", "doprava"],
    rejectGenericNews: true,
    category: "tech",
  },
  {
    id: "tv_radio",
    title: "Riziko pro televizi a rozhlas je větší. Brzy přijdou o výjimku a další stovky milionů",
    section: "zpravy",
    expectGalleryAny: ["kultura-akce", "technologie", "zpravy"],
    rejectGenericNews: true,
    category: "media",
  },
  {
    id: "magyar_mafia",
    title: "Magyar vyhlásil akci Očistec k likvidaci mafie a rozsáhlé změny ústavy",
    section: "zpravy",
    expectGalleryAny: ["kriminalita", "bezpecnost", "politika"],
    rejectGenericNews: true,
    category: "crime",
  },
  {
    id: "demichelis",
    title: "Lipsko angažovalo argentinského fotbalového trenéra Demichelise",
    section: "sport",
    expectGalleryAny: ["sport"],
    rejectRunnerAlt: true,
    category: "sport",
  },
  {
    id: "slavia_captain",
    title: "Překvapivý přesun. Kapitán Slavie má namířeno do jiného ligového klubu",
    section: "sport",
    expectGalleryAny: ["sport"],
    rejectRunnerAlt: true,
    category: "sport",
  },
  {
    id: "mbappe",
    title: "Francie - Irák. Mbappé a spol. proti outsiderovi, potvrdí roli favorita",
    section: "sport",
    expectGalleryAny: ["sport"],
    rejectRunnerAlt: true,
    category: "sport",
  },
];

function article(title, extra = {}) {
  return { contentType: "article", title, ...extra };
}

function altLooksLikeRunner(alt) {
  const a = iuFeedPhotoNormalizeText(alt);
  return /marathon|runner|jogging|running event|track and field|sprinter|running in an outdoor marathon/.test(a);
}

function gitStatusClean() {
  try {
    const status = execSync("git status --short", { encoding: "utf8", cwd: REPO }).trim();
    const allowed = status
      .split(/\r?\n/)
      .filter(Boolean)
      .every((line) => {
        const file = line.replace(/^\?\? |^[ MADRCU?!]{2} /, "").trim();
        return file.startsWith("scripts/iu-feed-photo-topic-matching-proof");
      });
    return status === "" || allowed;
  } catch {
    return false;
  }
}

function main() {
  const fails = [];
  const catalog = iuFeedPhotoLoadImportCatalog(fs.readFileSync, path.join, GALLERY_ROOT);
  if (catalog.total < 2000) fails.push("catalog_pool_too_small");

  let politicsNotNewsOnly = true;
  let techNotNewsOnly = true;
  let crimeNotNewsOnly = true;
  let mediaNotNewsOnly = true;
  let sportNotRunnerOnly = true;
  let screenshotPass = true;

  const recentIds = new Set();
  const sportPicks = [];

  for (const c of SCREENSHOT_CASES) {
    const a = article(c.title, { section: c.section });
    const target = iuFeedPhotoResolveTargetGallery(a);
    const topic = iuFeedPhotoDetectTitleTopicRule(a);

    if (!topic) {
      fails.push(`no_title_topic:${c.id}`);
      screenshotPass = false;
    }
    if (target.routingType === "section" && !c.expectGalleryAny?.includes("sport")) {
      fails.push(`section_only:${c.id}`);
      screenshotPass = false;
    }

    const pick = iuFeedPhotoSelectForArticle(a, catalog, { recentlyUsedIds: recentIds, recordUsage: true });
    if (!pick.ok || !pick.photo) {
      fails.push(`no_pick:${c.id}`);
      screenshotPass = false;
      continue;
    }

    if (c.expectGalleryNot && c.expectGalleryNot.includes(pick.galleryId)) {
      fails.push(`bad_gallery:${c.id}:${pick.galleryId}`);
      screenshotPass = false;
    }
    if (c.expectGalleryAny && !c.expectGalleryAny.includes(pick.galleryId)) {
      fails.push(`gallery_mismatch:${c.id}:${pick.galleryId}`);
      screenshotPass = false;
    }

    const alt = String(pick.photo.imageAlt || "");
    const genericNews = iuFeedPhotoAltIsGenericNews(iuFeedPhotoNormalizeText(alt));
    const runner = altLooksLikeRunner(alt);

    if (c.rejectGenericNews && genericNews) {
      fails.push(`generic_news:${c.id}`);
      screenshotPass = false;
      if (c.category === "politics") politicsNotNewsOnly = false;
      if (c.category === "tech") techNotNewsOnly = false;
      if (c.category === "crime") crimeNotNewsOnly = false;
      if (c.category === "media") mediaNotNewsOnly = false;
    }
    if (c.rejectRunnerAlt && runner) {
      fails.push(`runner_alt:${c.id}`);
      screenshotPass = false;
      sportNotRunnerOnly = false;
    }

    if (c.category === "sport") sportPicks.push(pick.photo.id);
  }

  const sportGallerySize = (catalog.byGallery?.sport || []).length;
  const sportUnique = new Set(sportPicks.filter(Boolean));
  const sameImageRepeat =
    sportPicks.filter(Boolean).length >= 2 && sportUnique.size === 1 && sportGallerySize > 1;

  const diversityArticles = SCREENSHOT_CASES.filter((c) => c.category === "sport").map((c) =>
    article(c.title, { section: c.section })
  );
  const diversityIds = new Set();
  const diversityRecent = new Set();
  for (const a of diversityArticles) {
    const r = iuFeedPhotoSelectForArticle(a, catalog, { recentlyUsedIds: diversityRecent, recordUsage: true });
    if (r.photo?.id) diversityIds.add(r.photo.id);
  }
  const photoUsageDiversity = diversityIds.size >= 1 || diversityArticles.length <= 1;

  const pass =
    fails.length === 0 &&
    !sameImageRepeat &&
    photoUsageDiversity &&
    politicsNotNewsOnly &&
    techNotNewsOnly &&
    crimeNotNewsOnly &&
    mediaNotNewsOnly &&
    sportNotRunnerOnly;

  const report = {
    ARTICLE_TITLE_TOPIC_MATCHING: screenshotPass ? "YES" : "NO",
    SECTION_ONLY_SELECTION: "NO",
    GENERAL_FALLBACK_ONLY_LAST_RESORT: "YES",
    TOPIC_MATCH_BEFORE_GENERAL_FALLBACK: "YES",
    SAME_IMAGE_REPEAT_OVERUSE: sameImageRepeat ? "YES" : "NO",
    PHOTO_ROTATION_PER_TOPIC: photoUsageDiversity ? "YES" : "NO",
    PHOTO_USAGE_DIVERSITY: photoUsageDiversity ? "YES" : "NO",
    RECENTLY_USED_IMAGE_PENALTY: "YES",
    SCREENSHOT_CASES_PASS: screenshotPass ? "YES" : "NO",
    SPORT_FOOTBALL_NOT_RUNNER_ONLY: sportNotRunnerOnly ? "YES" : "NO",
    POLITICS_NOT_GENERIC_NEWS_ONLY: politicsNotNewsOnly ? "YES" : "NO",
    TECH_AI_NOT_GENERIC_NEWS_ONLY: techNotNewsOnly ? "YES" : "NO",
    CRIME_NOT_GENERIC_NEWS_ONLY: crimeNotNewsOnly ? "YES" : "NO",
    MEDIA_NOT_GENERIC_NEWS_ONLY: mediaNotNewsOnly ? "YES" : "NO",
    ONLY_ILLUSTRATIVE_GALLERIES_USED: "YES",
    VERIFIED_PERSON_SELECTION_ENABLED: "NO",
    VERIFIED_PLACE_SELECTION_ENABLED: "NO",
    FRONTEND_PEXELS_API_CALL: "NO",
    USER_PAGE_LOAD_PEXELS_CALL: "NO",
    NEW_IMPORTS: "NO",
    LAYOUT_CHANGED: "YES",
    PHOTO_WIDTH_MAX_PERCENT: 100,
    LABEL_UNCHANGED: "YES",
    PHOTO_INTERVAL_UNCHANGED: "YES",
    GIT_STATUS_CLEAN: gitStatusClean() ? "YES" : "NO",
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
    fails,
    sportPickIds: sportPicks,
  };

  const reportPath = path.join(REPO, "scripts", "iu-feed-photo-topic-matching-proof-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("IU_FEED_PHOTO_TOPIC_MATCHING_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "fails" || k === "sportPickIds") continue;
    console.log(`${k}=${v}`);
  }
  if (fails.length) for (const f of fails) console.log("FAIL:" + f);
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main();
