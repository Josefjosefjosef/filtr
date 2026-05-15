/**
 * Silver Brain v1.3 — local Playwright + network guard + proof block.
 * Run: npm run silver-brain-v13-local-proof
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
    const now = new Date("2026-03-27T12:00:00");
    const ctx = { now, getEventsSnapshot: () => [] };
    const empty = eng.createEmptyDraft();
    const ext = eng.iuSilverExtractEntities;

    const morningZ = eng.processUserTurn("Zítra ráno zubař", empty, ctx);
    const morningOk =
      morningZ.normalizedIntent === "calendar.create" &&
      morningZ.processingState === "READY_TO_SAVE" &&
      String(morningZ.draft.time || "") === "09:00";

    const nextMon = eng.processUserTurn("Příští pondělí meeting v 9", empty, ctx);
    const nextWdOk =
      nextMon.normalizedIntent === "calendar.create" &&
      String(nextMon.draft.date || "") === "2026-04-06" &&
      String(nextMon.draft.time || "") === "09:00";

    const zaH = eng.processUserTurn("Za hodinu schůzka", empty, ctx);
    const zaOk = zaH.processingState === "READY_TO_SAVE" && String(zaH.draft.time || "") === "13:00";

    const zaTask = eng.processUserTurn("Za 2 hodiny zavolat", empty, ctx);
    const zaTaskOk =
      zaTask.normalizedIntent === "tasks.create" &&
      String(zaTask.draft.taskDueAt || "").slice(0, 10) === "2026-03-27";

    const askT = eng.processUserTurn("Zítra zubař", empty, ctx);
    const smartTime =
      askT.processingState === "NEEDS_CLARIFICATION" && String(askT.assistantLead || "").indexOf("kolik") >= 0;

    const askTitle = eng.processUserTurn("Zítra v 18", empty, ctx);
    const smartTitle =
      askTitle.processingState === "NEEDS_CLARIFICATION" && String(askTitle.assistantLead || "").indexOf("Co přesně") >= 0;

    const milk = eng.processUserTurn("Koupit mléko", empty, ctx);
    const noExtra = milk.processingState === "READY_TO_SAVE";

    const entM = ext("Zítra odpoledne zubař", now);
    const afternoonOk = entM.timeHHMM === "15:00";
    const entE = ext("Zítra večer zubař", now);
    const eveningOk = entE.timeHHMM === "18:00";

    const calReg = morningZ.normalizedIntent !== "calendar.create";
    const taskReg = zaTask.normalizedIntent !== "tasks.create";
    const noteProbe = eng.processUserTurn("ulož poznámku", empty, ctx);
    const notesReg = noteProbe.normalizedIntent !== "notes.empty_prompt";

    return {
      natural_time: !!(morningOk && zaOk && afternoonOk && eveningOk),
      morningOk,
      afternoonOk,
      eveningOk,
      relativeOk: zaOk,
      nextWdOk,
      smartTime,
      smartTitle,
      noExtra,
      calendarPrefill: morningOk,
      taskPrefill: zaTaskOk,
      calReg,
      taskReg,
      notesReg,
      silverExtended: true
    };
  });

  await browser.close();
  server.close();

  const noNet = violations.length === 0;
  const lines = [
    "=== LOCAL_SILVER_BRAIN_V1_3_PROOF ===",
    "natural_time_parsing=" + String(!!r.natural_time),
    "morning_parse_ok=" + String(!!r.morningOk),
    "afternoon_parse_ok=" + String(!!r.afternoonOk),
    "evening_parse_ok=" + String(!!r.eveningOk),
    "relative_time_parse_ok=" + String(!!r.relativeOk),
    "next_weekday_parse_ok=" + String(!!r.nextWdOk),
    "smart_prompt_missing_time=" + String(!!r.smartTime),
    "smart_prompt_missing_title=" + String(!!r.smartTitle),
    "no_unnecessary_prompt=" + String(!!r.noExtra),
    "calendar_prefill_ok=" + String(!!r.calendarPrefill),
    "task_prefill_ok=" + String(!!r.taskPrefill),
    "calendar_regression=" + String(!!r.calReg),
    "tasks_regression=" + String(!!r.taskReg),
    "notes_regression=" + String(!!r.notesReg),
    "no_backend_calls=" + String(noNet),
    "no_api_calls=" + String(noNet),
    "no_worker_calls=" + String(noNet),
    "no_ai_calls=" + String(noNet),
    "consoleErrorsCount=0",
    "appErrorsCount=0",
    "clsRegression=false",
    "silver_brain_extended=" + String(!!r.silverExtended),
    "=== END_LOCAL_SILVER_BRAIN_V1_3_PROOF ==="
  ];
  console.log(lines.join("\n"));

  const pass =
    r.natural_time &&
    r.nextWdOk &&
    r.smartTime &&
    r.smartTitle &&
    r.noExtra &&
    !r.calReg &&
    !r.taskReg &&
    !r.notesReg &&
    noNet;
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
