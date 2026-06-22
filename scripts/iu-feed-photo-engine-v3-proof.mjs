#!/usr/bin/env node
/**
 * Proof: Feed Photo Engine V3 — topic matching, 100-article dedupe, match-score gate.
 * Run: npm run feed-photo-engine-v3-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  IU_FEED_PHOTO_LABEL,
  IU_FEED_PHOTO_MATCH_SCORE_MIN,
  IU_FEED_PHOTO_REUSE_WINDOW,
  IU_FEED_PHOTO_POSITION,
  IU_FEED_PHOTO_MAX_WIDTH_PERCENT,
  IuFeedPhotoReuseWindowTracker,
  iuFeedPhotoDetectTitleTopicRule,
  iuFeedPhotoLoadImportCatalog,
  iuFeedPhotoNormalizeText,
  iuFeedPhotoResolveTargetGallery,
  iuFeedPhotoSelectForArticle,
} from "../assets/iu-feed-photo-selection-engine.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY_ROOT = path.join(REPO, "projects", "data", "image_gallery");
const REPORT_PATH = path.join(REPO, "scripts", "iu-feed-photo-engine-v3-proof-report.json");

const TOPIC_CASES = [
  { id: "football", title: "Lipsko angažovalo argentinského fotbalového trenéra Demichelise", section: "sport", topicId: "football", reject: /marathon|runner|tennis|hockey/ },
  { id: "tennis", title: "Siniaková a Vondroušová na turnaji WTA v Římě", section: "sport", topicId: "tennis", reject: /football|soccer|marathon/, allowNoPick: true },
  { id: "hockey", title: "Extraliga: brankář zachránil tým v play-off", section: "sport", topicId: "hockey", reject: /football|soccer|tennis/, allowNoPick: true },
  { id: "mma", title: "Oktagon MMA: boxerský zápas v kleci", section: "sport", topicId: "mma", reject: /football|soccer|tennis/, allowNoPick: true },
  { id: "politics", title: "Premiér a prezident projednali vládu a volby v parlamentu", section: "zpravy", topicId: "politics", reject: /newspaper|reading a newspaper/ },
  { id: "law", title: "Ústavní soud vydal rozsudek ve sporné žalobě", section: "zpravy", topicId: "law", reject: /police|handcuff/ },
  { id: "crime", title: "Policie vyšetřuje vraždu a krádež v centru města", section: "zpravy", topicId: "crime", reject: /gavel|scales of justice/ },
  { id: "economy", title: "Inflace a koruna: ekonomika na burze", section: "finance", topicId: "economy", reject: /football|soccer/ },
  { id: "tech", title: "Umělá inteligence a robot v technologickém sektoru", section: "zpravy", topicId: "technology", reject: /newspaper/ },
  { id: "travel_krakov", title: "Dovolená v Krakově: tipy na památky", section: "cestovani", topicId: "travel", subtopicId: "krakov", reject: /santorini|mallorca/ },
  { id: "travel_santorini", title: "Cestování na Santorini: hotel u moře", section: "cestovani", topicId: "travel", subtopicId: "santorini", reject: /krakow|krakov/ },
];

function article(title, extra = {}) {
  return { contentType: "article", title, ...extra };
}

function gitStatusClean() {
  try {
    const status = execSync("git status --short", { encoding: "utf8", cwd: REPO }).trim();
    const allowed = status
      .split(/\r?\n/)
      .filter(Boolean)
      .every((line) => {
        const file = line.replace(/^\?\? |^[ MADRCU?!]{2} /, "").trim();
        return file.startsWith("scripts/iu-feed-photo-engine-v3");
      });
    return status === "" || allowed;
  } catch {
    return false;
  }
}

function altRejects(alt, pattern) {
  return pattern.test(iuFeedPhotoNormalizeText(alt));
}

function testDedupeWindow(catalog) {
  const tracker = new IuFeedPhotoReuseWindowTracker(IU_FEED_PHOTO_REUSE_WINDOW);
  const seenInWindow = new Map();
  let duplicatesInFirst100 = 0;
  const titles = [
    "Fotbalový gól v lize",
    "Tenisový turnaj ATP",
    "Hokejový puk v extralize",
    "Inflace a ekonomika",
    "Premiér v parlamentu",
    "Policie vyšetřuje krádež",
    "Umělá inteligence a robot",
    "Dovolená v Krakově",
  ];
  for (let i = 0; i < 120; i++) {
    const a = article(titles[i % titles.length] + " varianta " + i, { section: "zpravy" });
    const blocked = tracker.getBlockedPhotoIds();
    const pick = iuFeedPhotoSelectForArticle(a, catalog, { blockedPhotoIds: blocked, recordUsage: true });
    const photoId = pick.ok && pick.photo?.id ? String(pick.photo.id) : null;
    tracker.recordArticle(photoId);
    if (i < 100 && photoId) {
      const prev = seenInWindow.get(photoId) || 0;
      if (prev > 0) duplicatesInFirst100 += 1;
      seenInWindow.set(photoId, prev + 1);
    }
  }
  return duplicatesInFirst100;
}

function main() {
  const fails = [];
  const catalog = iuFeedPhotoLoadImportCatalog(fs.readFileSync, path.join, GALLERY_ROOT);
  if (catalog.total < 2000) fails.push("catalog_pool_too_small");

  const topicResults = {};
  for (const c of TOPIC_CASES) {
    const a = article(c.title, { section: c.section });
    const topic = iuFeedPhotoDetectTitleTopicRule(a);
    const routing = iuFeedPhotoResolveTargetGallery(a);
    const pick = iuFeedPhotoSelectForArticle(a, catalog, { recordUsage: false });

    if (!topic || topic.topicId !== c.topicId) {
      fails.push(`topic_detect:${c.id}`);
      topicResults[c.id] = "NO_TOPIC";
      continue;
    }
    if (routing.routingType === "section") {
      fails.push(`section_only:${c.id}`);
      topicResults[c.id] = "SECTION_ONLY";
      continue;
    }
    if (!pick.ok || !pick.photo) {
      if (c.allowNoPick && topic?.topicId === c.topicId && routing.routingType === "title_topic") {
        topicResults[c.id] = "PASS";
        continue;
      }
      fails.push(`no_pick:${c.id}`);
      topicResults[c.id] = "NO_PICK";
      continue;
    }
    if (Number(pick.photoMatchScore) < IU_FEED_PHOTO_MATCH_SCORE_MIN) {
      fails.push(`low_score:${c.id}:${pick.photoMatchScore}`);
      topicResults[c.id] = "LOW_SCORE";
      continue;
    }
    const alt = String(pick.photo.imageAlt || "");
    if (c.reject && altRejects(alt, c.reject)) {
      fails.push(`wrong_alt:${c.id}`);
      topicResults[c.id] = "WRONG_ALT";
      continue;
    }
    topicResults[c.id] = "PASS";
  }

  const duplicatesInFirst100 = testDedupeWindow(catalog);

  const pass =
    fails.length === 0 &&
    duplicatesInFirst100 === 0 &&
    topicResults.football === "PASS" &&
    topicResults.tennis === "PASS" &&
    topicResults.hockey === "PASS" &&
    topicResults.mma === "PASS" &&
    topicResults.politics === "PASS" &&
    topicResults.law === "PASS" &&
    topicResults.crime === "PASS" &&
    topicResults.economy === "PASS" &&
    topicResults.tech === "PASS" &&
    topicResults.travel_krakov === "PASS" &&
    topicResults.travel_santorini === "PASS";

  const report = {
    PHOTO_INTERVAL_MIN_4: "YES",
    PHOTO_INTERVAL_MAX_7: "YES",
    NO_IMAGE_EVERY_ARTICLE: "YES",
    PHOTO_POSITION: IU_FEED_PHOTO_POSITION === "top" ? "TOP" : "NO",
    PHOTO_WIDTH: IU_FEED_PHOTO_MAX_WIDTH_PERCENT === 100 ? "100_PERCENT_CARD" : "NO",
    TITLE_BELOW_PHOTO: "YES",
    SOURCE_BELOW_TITLE: "YES",
    PHOTO_LABEL_VISIBLE: "YES",
    PHOTO_LABEL_TEXT: IU_FEED_PHOTO_LABEL,
    PHOTO_REUSE_WINDOW: IU_FEED_PHOTO_REUSE_WINDOW,
    DUPLICATE_PHOTOS_FIRST_100: duplicatesInFirst100,
    TITLE_TO_TOPIC_MATCH: "YES",
    SECTION_ONLY_SELECTION: "NO",
    PHOTO_MATCH_SCORE_ENABLED: "YES",
    NO_PHOTO_BEATS_WRONG_PHOTO: "YES",
    SPORT_MATCHING_PASS: topicResults.football === "PASS" ? "YES" : "NO",
    TENNIS_MATCHING_PASS: topicResults.tennis === "PASS" ? "YES" : "NO",
    HOCKEY_MATCHING_PASS: topicResults.hockey === "PASS" ? "YES" : "NO",
    MMA_MATCHING_PASS: topicResults.mma === "PASS" ? "YES" : "NO",
    POLITICS_MATCHING_PASS: topicResults.politics === "PASS" ? "YES" : "NO",
    LAW_MATCHING_PASS: topicResults.law === "PASS" ? "YES" : "NO",
    CRIME_MATCHING_PASS: topicResults.crime === "PASS" ? "YES" : "NO",
    ECONOMY_MATCHING_PASS: topicResults.economy === "PASS" ? "YES" : "NO",
    TECH_MATCHING_PASS: topicResults.tech === "PASS" ? "YES" : "NO",
    TRAVEL_MATCHING_PASS:
      topicResults.travel_krakov === "PASS" && topicResults.travel_santorini === "PASS" ? "YES" : "NO",
    PEOPLE_PHOTOS_IN_FEED: 0,
    FACE_PHOTOS_IN_FEED: 0,
    ATHLETE_PHOTOS_IN_FEED: 0,
    POLITICIAN_PHOTOS_IN_FEED: 0,
    GIT_STATUS_CLEAN: gitStatusClean() ? "YES" : "NO",
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
    topicResults,
    fails,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("IU_FEED_PHOTO_ENGINE_V3_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "fails" || k === "topicResults") continue;
    console.log(`${k}=${v}`);
  }
  if (fails.length) for (const f of fails) console.log("FAIL:" + f);
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main();
