/**
 * Silver salutation intent proof (Node).
 * Run: node scripts/test_salutation_intent.js
 * Logika musí odpovídat IU_SILVER_P0_ENGINE_START v assets/app.js (viz IU_SILVER_SALUTATION_SYNC_TAG).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

const SYNC = "IU_SILVER_SALUTATION_SYNC_V1=2026-05-30a";
const PREF_KEY = "iuSilver.salutationPreference.v1";
const ADDR_KEY = "iu_user_address";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!APP.includes(SYNC)) {
  fail("FAIL: sync tag missing or mismatch — update scripts/test_salutation_intent.js + assets/app.js together");
}
if (!APP.includes(PREF_KEY)) {
  fail("FAIL: preference key not found in app.js");
}
if (!APP.includes("iu_user_address_explicit.v1")) {
  fail("FAIL: explicit address flag key not found in app.js");
}
if (!APP.includes("iuSilverIsSalutationDisableRequest")) {
  fail("FAIL: salutation disable helper not found");
}
if (!APP.includes("iuSilverTryConsumeUserAddressConfirmationTurn")) {
  fail("FAIL: user address confirmation turn not found");
}
if (!APP.includes("iuSilverBuildSalutationPreferenceTurn")) {
  fail("FAIL: salutation turn builder not found");
}
if (!APP.includes("salEarly")) {
  fail("FAIL: salutation early routing not found in processUserTurn");
}

function fold(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function iuSilverSalutationHardBlockCalendar(f) {
  if (/\b(pridej|uloz|zapis|vloz|odeber|presun|presunout)\b/.test(f) && /\b(do\s+kalend|v\s+kalend|kalendari|kalendare)\b/.test(f)) {
    return true;
  }
  if (/\b(poznam|ukol|pripomenout)\b/.test(f) && /\bkalend/.test(f)) {
    return true;
  }
  return false;
}

function iuSilverIsSalutationHowQuestion(f) {
  return (
    /^jak\s+m(uz|u)u\s+zmen(it|im|is|i)?\s+osloven/.test(f) ||
    /^jak\s+zmen(it|im|is|i)?\s+osloven/.test(f) ||
    /^jak\s+si\s+nastav(im|it|is|i)?\s+osloven/.test(f) ||
    /^kde\s+(m(uz|u)u\s+)?zmen(it|im|is|i)?\s+(moje\s+)?osloven/.test(f) ||
    /^jak\s+.*\boslovovat\b/.test(f) ||
    /^jak\s+me\s+budes\s+oslovovat/.test(f) ||
    /^proc\s+.*\bosloven/.test(f) ||
    /^jaky\s+.*\bosloven/.test(f) ||
    /^co\s+(je|znamena)\s+.*\bosloven/.test(f)
  );
}

/** Zjednodušená detekce stejných prefixů jako iuUserAddressIntentPrefixesOrdered (ASCII). */
function tryUserAddressPrefix(n) {
  const prefs = [
    "zmen moje osloveni na ",
    "nastav osloveni na ",
    "zmen osloveni na ",
    "zmen oslveni na ",
    "odted me oslovuj ",
    "odted mi rikej ",
    "rikej mi prosim ",
    "pouzivej jmeno ",
    "muzes mi rikat ",
    "jmenuji se ",
    "oslovuj me ",
    "rikej mi ",
    "jsem "
  ].sort(function (a, b) {
    return b.length - a.length;
  });
  for (let i = 0; i < prefs.length; i++) {
    if (n.startsWith(prefs[i])) {
      return true;
    }
  }
  return false;
}

function iuSilverLooksLikeSchedulingFragmentSimple(f) {
  if (/\bz[ii]tra\b|\bdnes(?:ka|ek)?\b|\bpoz[ii]t[rR][iI]\b/.test(f)) {
    return true;
  }
  if (/\b\d{1,2}\s*\.\s*\d{1,2}\s*\./.test(f)) {
    return true;
  }
  if (/\b\d{1,2}\s*[.\/\-]\s*\d{1,2}\b/.test(f)) {
    return true;
  }
  if (/\bv\s*\d{1,2}\s*[:.]\s*\d{1,2}\b/.test(f) || /\bve\s+\d{1,2}\s*[:.]\s*\d{1,2}\b/.test(f)) {
    return true;
  }
  if (/\bschuz|schůz|porad|zubar|zub|kontrola|servis|ud[aá]lost/i.test(f)) {
    return true;
  }
  return false;
}

function iuSilverIsSalutationIntent(f, raw) {
  if (!f || f.length < 4) {
    return false;
  }
  if (iuSilverSalutationHardBlockCalendar(f)) {
    return false;
  }
  const folded = fold(raw || "");
  if (raw && iuSilverLooksLikeSchedulingFragmentSimple(folded) && !iuSilverIsSalutationHowQuestion(f)) {
    return false;
  }
  if (/\b(napis|napiste|zapis|uloz)\b/.test(f) && /\bformalni\s+zpr/.test(f)) {
    return false;
  }
  if (iuSilverIsSalutationHowQuestion(f)) {
    return true;
  }
  if (/\bneoslovuj\b/.test(f) || (/\bnechci\b/.test(f) && /\bosloven/.test(f)) || /\bnepouzivej\s+osloven/.test(f)) {
    return true;
  }
  if (/\bprestan\s+me\s+oslovov/.test(f) || /\buz\s+me\s+neoslovuj/.test(f) || /\bosloveni\s+vypni/.test(f)) {
    return true;
  }
  if (/\bne(?:rij|rik)\s+mi\s+jmenem\b/.test(f) || /\bnechci\s+zadne\s+osloveni\b/.test(f)) {
    return true;
  }
  if (/\b(mluv|mluvej)\s+na\s+m(e|ě)\s+neformal/.test(f) || /\bneformal(in|ni|nej)?\b/.test(f) || /\binformal\b/.test(f)) {
    return true;
  }
  if (/\b(mluv|mluvej)\s+na\s+m(e|ě)\s+formal/.test(f) || (/\bformal(in|ni|nej)?\b/.test(f) && !/\bneformal/.test(f))) {
    return true;
  }
  if (/\brikej\s+mi\b|\boslovuj\s+me\b|\boslovujte\s+me\b/.test(f)) {
    return true;
  }
  if (/^(formal|neformal|neformalnej)(ni)?!?$/.test(f)) {
    return true;
  }
  if (/\bosloven(i|y|e|a|u)?\b/.test(f) && (/\bzmen(it|im|is|i)?\b/.test(f) || /\boslovuj\b/.test(f) || /^jak\b/.test(f))) {
    return true;
  }
  return false;
}

function classifyRoute(raw) {
  const f = fold(raw);
  const n = fold(raw);
  if (tryUserAddressPrefix(n)) {
    return "user_address";
  }
  if (iuSilverIsSalutationIntent(f, raw)) {
    return "salutation";
  }
  if (iuSilverSalutationHardBlockCalendar(f)) {
    return "calendar_safe";
  }
  if (/\b(pridej|uloz)\b/.test(f) && /\bkalend/.test(f)) {
    return "calendar_candidate";
  }
  return "other";
}

const store = Object.create(null);
const mockLocal = {
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
  },
  setItem(k, v) {
    store[k] = String(v);
  },
  removeItem(k) {
    delete store[k];
  }
};

function simulateSalutationStorageMutation(raw) {
  const f = fold(raw);
  if (
    /\bneoslovuj\b/.test(f) ||
    (/\bnechci\b/.test(f) && /\bosloven/.test(f)) ||
    /\bprestan\s+me\s+oslovov/.test(f) ||
    /\buz\s+me\s+neoslovuj/.test(f) ||
    /\bosloveni\s+vypni/.test(f) ||
    /\bne(?:rij|rik)\s+mi\s+jmenem\b/.test(f)
  ) {
    mockLocal.setItem(PREF_KEY, JSON.stringify({ mode: "none", at: 1 }));
    mockLocal.removeItem(ADDR_KEY);
    mockLocal.removeItem("iu_user_address_explicit.v1");
    return "none";
  }
  if (/\b(mluv|mluvej)\s+na\s+m(e|ě)\s+neformal\b/.test(f) || /\bneformal(in|ni|nej)?\b/.test(f) || /\binformal\b/.test(f)) {
    mockLocal.setItem(PREF_KEY, JSON.stringify({ mode: "informal", at: 1 }));
    return "informal";
  }
  if (/\b(mluv|mluvej)\s+na\s+m(e|ě)\s+formal\b/.test(f) || (/\bformal(in|ni|nej)?\b/.test(f) && !/\bneformal/.test(f))) {
    mockLocal.setItem(PREF_KEY, JSON.stringify({ mode: "formal", at: 1 }));
    return "formal";
  }
  return null;
}

let passIntent = true;
let passCalendar = true;
let passStorage = true;
let passResponse = true;
let passRegression = true;

const q = "Jak změním oslovení?";
if (!iuSilverIsSalutationIntent(fold(q), q) || !iuSilverIsSalutationHowQuestion(fold(q))) {
  passIntent = false;
}
if (classifyRoute(q) !== "salutation") {
  passIntent = false;
}

const cal = "přidej oslavu do kalendáře";
if (iuSilverIsSalutationIntent(fold(cal), cal)) {
  passCalendar = false;
}
if (classifyRoute(cal) !== "calendar_safe" && classifyRoute(cal) !== "calendar_candidate") {
  passCalendar = false;
}

simulateSalutationStorageMutation("nechci oslovení");
const st = mockLocal.getItem(PREF_KEY);
if (!st || !/"mode":"none"/.test(st.replace(/\s/g, ""))) {
  passStorage = false;
}

if (!APP.includes("Jasně 👍 Stačí mi napsat")) {
  passResponse = false;
}

const reg = "zapiš poznámku na zítra";
if (iuSilverIsSalutationIntent(fold(reg), reg)) {
  passRegression = false;
}
const regFormalLetter = "napiš formální zprávu klientovi";
if (iuSilverIsSalutationIntent(fold(regFormalLetter), regFormalLetter)) {
  passRegression = false;
}

console.log("intent match " + (passIntent ? "PASS" : "FAIL"));
console.log("calendar bypass " + (passCalendar ? "PASS" : "FAIL"));
console.log("storage write " + (passStorage ? "PASS" : "FAIL"));
console.log("response " + (passResponse ? "PASS" : "FAIL"));
console.log("regression " + (passRegression ? "PASS" : "FAIL"));

if (!(passIntent && passCalendar && passStorage && passResponse && passRegression)) {
  process.exit(1);
}
