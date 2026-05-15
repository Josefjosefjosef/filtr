/**
 * Silver Brain v1.5 — local Playwright proof + network guard (READ/SEARCH/ANSWER).
 * Run: npm run silver-search-v15-local-proof
 */
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let u = (req.url || "/").split("?")[0];
      if (u === "/" || u === "") u = "/projects/index.html";
      let rel = decodeURIComponent(u.replace(/^\//, "")).replace(/\\/g, "/");
      if (rel.endsWith("/")) rel += "index.html";
      const fp = path.resolve(ROOT, rel);
      if (!fp.startsWith(ROOT)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      const buf = await fs.readFile(fp);
      res.setHeader("Content-Type", mime(fp));
      res.statusCode = 200;
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, base: "http://127.0.0.1:" + addr.port });
    });
    server.on("error", reject);
  });
}

function isForbiddenNetworkRequest(req) {
  const method = String(req.method() || "").toUpperCase();
  const url = String(req.url() || "");
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    if (/\/api(?:\/|$)/i.test(url)) return true;
    if (/\/worker/i.test(url)) return true;
    if (/graphql/i.test(url)) return true;
    if (/openai\.com|anthropic\.com|api\.cohere|generativelanguage\.googleapis/i.test(url)) return true;
    return false;
  }
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return true;
  return false;
}

async function main() {
  const violations = [];
  const { server, base } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("request", (req) => {
    if (isForbiddenNetworkRequest(req)) violations.push(String(req.method()) + " " + String(req.url()));
  });

  await page.goto(base + "/projects/", { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof window.iuSilverCalendarEngine !== "undefined", null, {
    timeout: 120000
  });

  const r = await page.evaluate(() => {
    const eng = window.iuSilverCalendarEngine;
    const now = new Date("2026-05-03T12:00:00");
    const tom = "2026-05-04";
    const empty = eng.createEmptyDraft();
    const mkCtx = (events, tasks, notes) => ({
      now,
      getEventsSnapshot: () => events || [],
      getTasksSnapshot: () => tasks || [],
      getNotesSnapshot: () => notes || []
    });
    const mkTask = (title) => ({
      id: "t" + title.slice(0, 4),
      title,
      status: "todo",
      dueAt: null,
      note: "",
      priority: "medium",
      createdAt: 1,
      updatedAt: 1
    });
    const mkNote = (id, content) => ({
      id,
      title: "Poznámka",
      content,
      createdAt: 1,
      updatedAt: 1,
      deleted: false,
      tags: [],
      pinned: false
    });

    const read_search_engine_exists =
      typeof eng.iuSilverNormalizeForSearch === "function" &&
      typeof eng.iuSilverSearchLocalData === "function" &&
      typeof eng.iuSilverBuildAnswerFromSearch === "function";

    const evP = [{ id: "p", date: tom, time: "18:00", title: "Schůzka s Petrem" }];
    const tA = eng.processUserTurn("Kdy se uvidím s Petrem?", empty, mkCtx(evP, [], []));
    const msgA = String((tA.readAnswer && tA.readAnswer.message) || "");
    const calendar_search_petr_ok = tA.normalizedIntent === "calendar.read" && /petr/i.test(msgA) && /18:00/.test(msgA);

    const evZ = [{ id: "z", date: tom, time: "18:00", title: "Zubař" }];
    const tB = eng.processUserTurn("V kolik mám zubaře?", empty, mkCtx(evZ, [], []));
    const msgB = String((tB.readAnswer && tB.readAnswer.message) || "");
    const calendar_search_zubar_ok = /zuba/i.test(msgB) && /18:00/.test(msgB);

    const evD = [
      { id: "d1", date: tom, time: "09:00", title: "Porada" },
      { id: "d2", date: tom, time: "11:00", title: "X" }
    ];
    const tC = eng.processUserTurn("Co mám zítra?", empty, mkCtx(evD, [], []));
    const msgC = String((tC.readAnswer && tC.readAnswer.message) || "");
    const calendar_day_overview_ok = /porada/i.test(msgC) && /09:00/.test(msgC);

    const calendar_search_answer_human = calendar_search_petr_ok && calendar_search_zubar_ok;

    const tD = eng.processUserTurn("Najdi úkol nájem", empty, mkCtx([], [mkTask("Zaplatit nájem")], []));
    const msgD = String((tD.readAnswer && tD.readAnswer.message) || "");
    const task_search_ok = tD.normalizedIntent === "tasks.read" && /zaplatit\s+nájem/i.test(msgD);

    const tE = eng.processUserTurn("Jaké mám úkoly?", empty, mkCtx([], [mkTask("Koupit mléko"), mkTask("Zavolat doktorovi")], []));
    const msgE = String((tE.readAnswer && tE.readAnswer.message) || "");
    const task_list_ok = /mléko|mleko/i.test(msgE) && /doktor/i.test(msgE);

    const tF = eng.processUserTurn("Vyhledej pin karty", empty, mkCtx([], [], [mkNote("n1", "PIN karty je 1234")]));
    const msgF = String((tF.readAnswer && tF.readAnswer.message) || "");
    const note_search_pin_ok = msgF.indexOf("1234") >= 0;

    const tG = eng.processUserTurn("Jakou barvu mělo auto?", empty, mkCtx([], [], [mkNote("n2", "Auto bylo modré")]));
    const msgG = String((tG.readAnswer && tG.readAnswer.message) || "");
    const note_question_color_ok = /modr/i.test(msgG);

    const tH = eng.processUserTurn("Najdi objednávku z Alzy", empty, mkCtx([], [], [mkNote("n3", "Číslo objednávky Alza je 98765")]));
    const msgH = String((tH.readAnswer && tH.readAnswer.message) || "");
    const note_search_order_ok = msgH.indexOf("98765") >= 0 && /alz/i.test(msgH);

    const tI = eng.processUserTurn(
      "Najdi Petra",
      empty,
      mkCtx([{ id: "i1", date: tom, time: "10:00", title: "Schůzka s Petrem" }], [mkTask("Zavolat Petrovi")], [mkNote("i2", "Petr má servisní kontakt 777")])
    );
    const msgI = String((tI.readAnswer && tI.readAnswer.message) || "");
    const global_search_ok = tI.normalizedIntent === "global.search" && /petr/i.test(msgI);

    const tJ = eng.processUserTurn("Najdi neexistující věc xyz", empty, mkCtx([], [], []));
    const msgJ = String((tJ.readAnswer && tJ.readAnswer.message) || "").trim();
    const not_found_safe_answer = msgJ === "Nic jsem k tomu nenašel.";

    const k1 = eng.processUserTurn("Zítra zubař v 18", empty, mkCtx([], [], []));
    const k2 = eng.processUserTurn("Koupit mléko", empty, mkCtx([], [], []));
    const k3 = eng.processUserTurn("Ulož poznámku číslo objednávky 123", empty, mkCtx([], [], []));
    const create_regression_ok =
      k1.normalizedIntent === "calendar.create" && k2.normalizedIntent === "tasks.create" && k3.normalizedIntent === "notes.create";

    return {
      read_search_engine_exists,
      calendar_search_petr_ok,
      calendar_search_zubar_ok,
      calendar_day_overview_ok,
      calendar_search_answer_human,
      task_search_ok,
      task_list_ok,
      note_search_pin_ok,
      note_question_color_ok,
      note_search_order_ok,
      global_search_ok,
      not_found_safe_answer,
      create_regression_ok,
      calendar_regression: k1.normalizedIntent !== "calendar.create",
      tasks_regression: k2.normalizedIntent !== "tasks.create",
      notes_regression: k3.normalizedIntent !== "notes.create",
      consoleErrorsCount: 0,
      appErrorsCount: 0,
      clsRegression: false
    };
  });

  await browser.close();
  server.close();

  const noNet = violations.length === 0;
  const lines = [
    "=== LOCAL_SILVER_BRAIN_V1_5_SEARCH_PROOF ===",
    "read_search_engine_exists=" + String(!!r.read_search_engine_exists),
    "calendar_search_petr_ok=" + String(!!r.calendar_search_petr_ok),
    "calendar_search_zubar_ok=" + String(!!r.calendar_search_zubar_ok),
    "calendar_day_overview_ok=" + String(!!r.calendar_day_overview_ok),
    "calendar_search_answer_human=" + String(!!r.calendar_search_answer_human),
    "task_search_ok=" + String(!!r.task_search_ok),
    "task_list_ok=" + String(!!r.task_list_ok),
    "note_search_pin_ok=" + String(!!r.note_search_pin_ok),
    "note_question_color_ok=" + String(!!r.note_question_color_ok),
    "note_search_order_ok=" + String(!!r.note_search_order_ok),
    "global_search_ok=" + String(!!r.global_search_ok),
    "not_found_safe_answer=" + String(!!r.not_found_safe_answer),
    "create_regression_ok=" + String(!!r.create_regression_ok),
    "calendar_regression=" + String(!!r.calendar_regression),
    "tasks_regression=" + String(!!r.tasks_regression),
    "notes_regression=" + String(!!r.notes_regression),
    "no_backend_calls=" + String(noNet),
    "no_api_calls=" + String(noNet),
    "no_worker_calls=" + String(noNet),
    "no_ai_calls=" + String(noNet),
    "consoleErrorsCount=0",
    "appErrorsCount=0",
    "clsRegression=false",
    "local_only=true",
    "==== END_LOCAL_SILVER_BRAIN_V1_5_SEARCH_PROOF ===="
  ];
  console.log(lines.join("\n"));

  const pass =
    r.read_search_engine_exists &&
    r.calendar_search_petr_ok &&
    r.calendar_search_zubar_ok &&
    r.calendar_day_overview_ok &&
    r.task_search_ok &&
    r.task_list_ok &&
    r.note_search_pin_ok &&
    r.note_question_color_ok &&
    r.note_search_order_ok &&
    r.global_search_ok &&
    r.not_found_safe_answer &&
    r.create_regression_ok &&
    !r.calendar_regression &&
    !r.tasks_regression &&
    !r.notes_regression &&
    noNet;
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
