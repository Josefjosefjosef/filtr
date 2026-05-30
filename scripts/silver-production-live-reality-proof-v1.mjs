/**
 * Live production proof for Silver production reality query families.
 * Usage: node scripts/silver-production-live-reality-proof-v1.mjs
 */
import { chromium } from "playwright";

const URL = process.env.SILVER_PROD_URL || "https://infouzel.cz/projects/";

const TASK = [
  "Jaké mám úkoly",
  "Co mám v úkolech",
  "Vypiš moje úkoly",
  "Co mám splnit",
  "Co mám rozdělané"
];
const CAL = ["Kdy mám zubaře", "Kdy mám pediatra", "Kdy mám právníka", "Kdy mám schůzku"];
const NOTES = [
  "Co mám o autě",
  "Co jsem si poznamenal o autě",
  "Mám něco o autě",
  "Co víš o autě"
];
const DIA = ["Kdy má Tomáš narozeniny", "Jakou má stůl šířku", "Heslo k wifi"];

function asciiLeak(msg) {
  const m = String(msg || "");
  if (/\b(tomas|stul|kveten)\b/i.test(m) && !/\b(Tomáš|stůl|květen)\b/.test(m)) return true;
  return false;
}

async function runFamily(page, inputs, expectIntent) {
  let pass = 0;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    await page.evaluate(() => {
      const h = document.getElementById("iuSilverChatMessages");
      if (h) h.innerHTML = "";
    });
    const out = await page.evaluate((text) => {
      const eng = window.iuSilverCalendarEngine;
      const turn = eng.processUserTurn(text, eng.createEmptyDraft(), {
        now: new Date(),
        getEventsSnapshot: () => window.iuCalendarService.calendarGetEventsSnapshot(),
        getTasksSnapshot: () =>
          window.iuTasksService && window.iuTasksService.tasksGetSnapshot
            ? window.iuTasksService.tasksGetSnapshot()
            : [],
        getNotesSnapshot: () =>
          window.iuNotesService && window.iuNotesService.notesGetSnapshot
            ? window.iuNotesService.notesGetSnapshot()
            : []
      });
      const msg = String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
      return { intent: String(turn.normalizedIntent || ""), msg: msg };
    }, input);
    const ok =
      out.intent === expectIntent && !/Nic jsem k tomu nena[sš]el/i.test(out.msg) && !asciiLeak(out.msg);
    if (ok) pass++;
  }
  return pass === inputs.length;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => window.iuSilverCalendarEngine && window.iuCalendarService, null, { timeout: 60000 });

  const hasFix = await page.evaluate(() => {
    const src = Array.from(document.scripts)
      .map((s) => s.src)
      .find((u) => u && u.includes("app.js"));
    return { hasFn: typeof window.iuSilverProductionRealityTaskQueryFamilyFolded === "function", appJs: src || "" };
  });

  const taskPass = await runFamily(page, TASK, "tasks.read");
  const calPass = await runFamily(page, CAL, "calendar.read");
  const notesPass = await runFamily(page, NOTES, "notes.read");
  let diaPass = true;
  for (let i = 0; i < DIA.length; i++) {
    await page.evaluate(() => {
      const h = document.getElementById("iuSilverChatMessages");
      if (h) h.innerHTML = "";
    });
    const out = await page.evaluate((text) => {
      const eng = window.iuSilverCalendarEngine;
      const turn = eng.processUserTurn(text, eng.createEmptyDraft(), {
        now: new Date(),
        getEventsSnapshot: () => window.iuCalendarService.calendarGetEventsSnapshot(),
        getTasksSnapshot: () =>
          window.iuTasksService && window.iuTasksService.tasksGetSnapshot
            ? window.iuTasksService.tasksGetSnapshot()
            : [],
        getNotesSnapshot: () =>
          window.iuNotesService && window.iuNotesService.notesGetSnapshot
            ? window.iuNotesService.notesGetSnapshot()
            : []
      });
      const msg = String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
      return { intent: String(turn.normalizedIntent || ""), msg: msg };
    }, DIA[i]);
    if (out.intent !== "notes.read" || /Nic jsem k tomu nena[sš]el/i.test(out.msg) || asciiLeak(out.msg)) {
      diaPass = false;
    }
    if (DIA[i].indexOf("Tomáš") >= 0 && !/Tomáš|květen/i.test(out.msg)) diaPass = false;
    if (DIA[i].indexOf("stůl") >= 0 && !/stůl/i.test(out.msg)) diaPass = false;
  }

  console.log("=== SILVER_PRODUCTION_LIVE_REALITY_PROOF_V1 ===");
  console.log("production_url=" + URL);
  console.log("production_app_js=" + (hasFix.appJs || ""));
  console.log("PRODUCTION_FIX_DEPLOYED=" + (hasFix.hasFn ? "YES" : "NO"));
  console.log("PRODUCTION_TASK_QUERY_PASS=" + (taskPass ? "YES" : "NO"));
  console.log("PRODUCTION_CALENDAR_QUERY_PASS=" + (calPass ? "YES" : "NO"));
  console.log("PRODUCTION_NOTES_QUERY_PASS=" + (notesPass ? "YES" : "NO"));
  console.log("PRODUCTION_DIAKRITICS_PASS=" + (diaPass ? "YES" : "NO"));
  console.log("PRODUCTION_ORIGINAL_TEXT_PASS=" + (diaPass ? "YES" : "NO"));
  console.log("=== END_SILVER_PRODUCTION_LIVE_REALITY_PROOF_V1 ===");

  await browser.close();
  const all = taskPass && calPass && notesPass && diaPass && hasFix.hasFn;
  process.exit(all ? 0 : 1);
}

main().catch(function (err) {
  console.error(String(err && err.message ? err.message : err));
  process.exit(2);
});
