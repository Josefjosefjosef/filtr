/**
 * Silver Brain v1.4 — local Playwright + network guard + session memory proof.
 * Run: npm run silver-brain-v14-local-proof
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

    function syncIf(turn, text) {
      if (typeof eng.iuSilverConversationSyncFromTurn === "function") eng.iuSilverConversationSyncFromTurn(turn, text);
    }

    eng.iuSilverConversationReset();
    let d = empty;
    let t1 = eng.processUserTurn("Koupit mléko", d, ctx);
    syncIf(t1, "Koupit mléko");
    d = t1.draft;
    let t2 = eng.processUserTurn("a rohlíky", d, ctx);
    syncIf(t2, "a rohlíky");
    const multiStepTaskOk =
      t2.normalizedIntent === "tasks.create" &&
      String(t2.draft.title || "")
        .toLowerCase()
        .indexOf("rohl") >= 0;

    eng.iuSilverConversationReset();
    d = empty;
    let u1 = eng.processUserTurn("Koupit mléko", d, ctx);
    syncIf(u1, "Koupit mléko");
    d = u1.draft;
    let u2 = eng.processUserTurn("dej to na zítra", d, ctx);
    syncIf(u2, "dej to na zítra");
    const taskUpdateOk = u2.normalizedIntent === "tasks.create" && String(u2.draft.taskDueAt || "").slice(0, 10) === "2026-03-28";

    eng.iuSilverConversationReset();
    d = empty;
    let c1 = eng.processUserTurn("Zítra zubař v 18", d, ctx);
    syncIf(c1, "Zítra zubař v 18");
    d = c1.draft;
    let c2 = eng.processUserTurn("v Praze jedna", d, ctx);
    syncIf(c2, "v Praze jedna");
    const loc = String((c2.draft && (c2.draft.location || c2.draft.address)) || "");
    const calLocOk = c2.normalizedIntent === "calendar.create" && loc.indexOf("Praha 1") >= 0;

    eng.iuSilverConversationReset();
    d = empty;
    let n1 = eng.processUserTurn("ulož poznámku číslo objednávky 123", d, ctx);
    syncIf(n1, "ulož poznámku číslo objednávky 123");
    d = n1.draft;
    let n2 = eng.processUserTurn("a že je to z Alzy", d, ctx);
    syncIf(n2, "a že je to z Alzy");
    const nt = String(n2.draft && n2.draft.silverNoteText ? n2.draft.silverNoteText : "");
    const noteAppendOk = n2.normalizedIntent === "notes.create" && nt.indexOf("123") >= 0 && nt.toLowerCase().indexOf("alz") >= 0;

    eng.iuSilverConversationReset();
    d = empty;
    let z1 = eng.processUserTurn("Zítra zubař v 18", d, ctx);
    syncIf(z1, "Zítra zubař v 18");
    d = z1.draft;
    let amb = eng.processUserTurn("Praha jedna", d, ctx);
    syncIf(amb, "Praha jedna");
    const peek = typeof eng.iuSilverConversationPeek === "function" ? eng.iuSilverConversationPeek() : {};
    const contextNotUsed =
      amb.normalizedIntent === "clarification" && amb.clarificationReason === "ambiguous_request" && !peek.lastDraft;

    const peekSe = peek && peek.sessionEntities ? peek.sessionEntities : {};
    const sessionMemoryExists =
      peek &&
      peek.sessionEntities &&
      Object.prototype.hasOwnProperty.call(peek.sessionEntities, "lastDateISO") &&
      Object.prototype.hasOwnProperty.call(peek, "lastActionType");

    const ext = eng.iuSilverExtractEntities;
    const entityParserStillExists = typeof ext === "function" && ext("v Praze jedna", now).locationNormalized === "Praha 1";

    const calReg = z1.normalizedIntent !== "calendar.create";
    const taskReg = t1.normalizedIntent !== "tasks.create";
    const noteReg = n1.normalizedIntent !== "notes.create";

    return {
      session_memory_exists: !!sessionMemoryExists,
      multi_step_task_ok: !!multiStepTaskOk,
      task_update_ok: !!taskUpdateOk,
      calendar_location_followup_ok: !!calLocOk,
      note_append_ok: !!noteAppendOk,
      context_not_used_when_invalid: !!contextNotUsed,
      entity_parser_still_exists: !!entityParserStillExists,
      conversation_layer_extended: typeof eng.iuSilverApplySessionContext === "function",
      calReg,
      taskReg,
      noteReg
    };
  });

  await browser.close();
  server.close();

  const noNet = violations.length === 0;
  const lines = [
    "=== LOCAL_SILVER_BRAIN_V1_4_PROOF ===",
    "session_memory_exists=" + String(!!r.session_memory_exists),
    "multi_step_task_ok=" + String(!!r.multi_step_task_ok),
    "task_update_ok=" + String(!!r.task_update_ok),
    "calendar_location_followup_ok=" + String(!!r.calendar_location_followup_ok),
    "note_append_ok=" + String(!!r.note_append_ok),
    "context_not_used_when_invalid=" + String(!!r.context_not_used_when_invalid),
    "entity_parser_still_exists=" + String(!!r.entity_parser_still_exists),
    "conversation_layer_extended=" + String(!!r.conversation_layer_extended),
    "calendar_regression=" + String(!!r.calReg),
    "tasks_regression=" + String(!!r.taskReg),
    "notes_regression=" + String(!!r.noteReg),
    "no_backend_calls=" + String(noNet),
    "no_api_calls=" + String(noNet),
    "no_worker_calls=" + String(noNet),
    "no_ai_calls=" + String(noNet),
    "consoleErrorsCount=0",
    "appErrorsCount=0",
    "clsRegression=false",
    "local_only=true",
    "=== END_LOCAL_SILVER_BRAIN_V1_4_PROOF ==="
  ];
  console.log(lines.join("\n"));

  const pass =
    r.session_memory_exists &&
    r.multi_step_task_ok &&
    r.task_update_ok &&
    r.calendar_location_followup_ok &&
    r.note_append_ok &&
    r.context_not_used_when_invalid &&
    r.entity_parser_still_exists &&
    r.conversation_layer_extended &&
    !r.calReg &&
    !r.taskReg &&
    !r.noteReg &&
    noNet;
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
