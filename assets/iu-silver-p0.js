/**
 * iuSilver P0: deterministic calendar intent + homepage → fullscreen chat.
 * Namespaced: window.iuSilverCalendarEngine, DOM ids iuSilver*
 */
(function () {
  "use strict";

  const PENDING_KEY = "iuSilver.pendingFirstMessage.v1";

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function toDateOnly(d) {
    const x = new Date(d);
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return toDateOnly(d);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  }
  function foldCs(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  /** Inflected weekday forms (v/ve/na + nominative/locative/etc.) — "ve středu" MUST match. */
  const IU_SILVER_WEEKDAY_INNER =
    "pondělí|pondeli|úterý|utery|středu|středa|streda|stredu|čtvrtek|ctvrtek|pátek|patek|sobotu|sobota|neděli|neděle|nedeli|nedele";
  function iuSilverReWeekdayOnce() {
    return new RegExp("\\b(?:v|ve|na)?\\s*(" + IU_SILVER_WEEKDAY_INNER + ")\\b", "i");
  }
  function iuSilverReWeekdayAll() {
    return new RegExp("\\b(?:v|ve|na)?\\s*(" + IU_SILVER_WEEKDAY_INNER + ")\\b", "gi");
  }

  const CZ_MONTH = {
    ledna: 1, unora: 2, brezna: 3, dubna: 4, kvetna: 5, cervna: 6, cervence: 7, srpna: 8, zari: 9, rijna: 10, listopadu: 11, prosince: 12,
    leden: 1, unor: 2, brezen: 3, duben: 4, kveten: 5, cerven: 6, cervenec: 7, srpen: 8, rijen: 10, listopad: 11, prosinec: 12
  };

  function weekdayToDow(name) {
    const x = foldCs(name);
    if (/pondel/.test(x)) return 1;
    if (/uter/.test(x)) return 2;
    if (/stred|^str/.test(x)) return 3;
    if (/ctvrtek|tvrtek/.test(x)) return 4;
    if (/patek/.test(x)) return 5;
    if (/sobot/.test(x)) return 6;
    if (/nedel/.test(x)) return 0;
    return -1;
  }

  /** Rule V1: nearest weekday; same day only if time not passed when time known. */
  function nextWeekdayDate(dowTarget, now, hasCertainTime, timeHHMM) {
    const todayStr = toDateOnly(now);
    const curD = now.getDay();
    let add = (dowTarget - curD + 7) % 7;
    let cand = addDays(todayStr, add);
    if (add === 0 && hasCertainTime && timeHHMM) {
      const parts = String(timeHHMM).split(":");
      const hh = Number(parts[0]) || 0;
      const mm = Number(parts[1]) || 0;
      const candDt = new Date(cand + "T" + pad(hh) + ":" + pad(mm) + ":00");
      if (candDt.getTime() <= now.getTime()) cand = addDays(cand, 7);
    }
    return cand;
  }

  function hasCalendarIntent(folded, raw) {
    if (/\bkalend/.test(folded)) return true;
    if (/schuz|schůz|porad/.test(folded)) return true;
    if (/\buloz|ulož|zapis|zapiš|přidej|pridej/.test(folded)) return true;
    if (iuSilverReWeekdayOnce().test(raw)) return true;
    if (/\b\d{1,2}\s*\.\s*\d{1,2}\s*\./.test(folded)) return true;
    if (/\b\d{1,2}\s*\.\s*[a-záéíóúůýščřďťň]+/i.test(raw)) return true;
    if (/\budalost/.test(folded)) return true;
    return false;
  }

  function cloneDraft(d) {
    return {
      date: d.date || "",
      time: d.time || "",
      title: d.title || "",
      note: d.note || "",
      location: d.location || "",
      durationMinutes: d.durationMinutes == null ? null : d.durationMinutes,
      meta: {
        date: d.meta.date,
        time: d.meta.time,
        title: d.meta.title,
        note: d.meta.note,
        location: d.meta.location,
        duration: d.meta.duration
      },
      activeCalendarSession: !!d.activeCalendarSession
    };
  }

  function createEmptyDraft() {
    return {
      date: "",
      time: "",
      title: "",
      note: "",
      location: "",
      durationMinutes: null,
      meta: {
        date: "missing",
        time: "missing",
        title: "missing",
        note: "optional",
        location: "optional",
        duration: "optional"
      },
      activeCalendarSession: false
    };
  }

  function stripNote(raw) {
    const patterns = [/\ba\s+do\s+pozn[aá]mky\s+napi[sš]\s+(.+)$/i, /\bdo\s+pozn[aá]mky\s+dej\s+(.+)$/i, /\bpozn[aá]mka\s*:\s*(.+)$/i];
    let note = "";
    let out = raw;
    for (const re of patterns) {
      const m = out.match(re);
      if (m && m[1]) {
        note = String(m[1]).trim().slice(0, 1000);
        out = out.replace(re, " ");
        break;
      }
    }
    return { work: out.replace(/\s+/g, " ").trim(), note };
  }

  function stripDuration(work) {
    let w = work;
    let minutes = null;
    const mMin = w.match(/\bna\s+(\d{1,3})\s*minut/u);
    if (mMin) {
      minutes = Math.max(1, Number(mMin[1]) || 0);
      w = w.replace(mMin[0], " ");
    }
    if (minutes == null) {
      const mH = w.match(/\bna\s+1\s*hodin/u);
      const mH2 = w.match(/\bna\s+hodinu\b/u);
      if (mH || mH2) {
        minutes = 60;
        w = w.replace(mH ? mH[0] : mH2[0], " ");
      }
    }
    return { work: w.replace(/\s+/g, " ").trim(), minutes };
  }

  function stripLocation(work) {
    let w = work;
    let loc = "";
    const pats = [
      /\bm[ií]sto\s*:\s*([^.!?]+?)(?=\.|$|pozn[aá]mka)/i,
      /\badresa\s*:\s*([^.!?]+?)(?=\.|$|pozn[aá]mka)/i,
      /\bv\s+ordinaci\s+([^.!?]+)/i,
      /\bna\s+adrese\s+([^.!?]+)/i
    ];
    for (const re of pats) {
      const m = w.match(re);
      if (m && m[1]) {
        loc = String(m[1]).trim().slice(0, 200);
        w = w.replace(re, " ");
        break;
      }
    }
    return { work: w.replace(/\s+/g, " ").trim(), location: loc };
  }

  function findTime(work) {
    let w = work;
    let time = null;
    const r1 = /\bv\s+(\d{1,2})\s*:\s*(\d{2})\b/i;
    const hit1 = w.match(r1);
    if (hit1) {
      const hh = Math.min(23, Math.max(0, Number(hit1[1])));
      const mm = Math.min(59, Math.max(0, Number(hit1[2])));
      time = pad(hh) + ":" + pad(mm);
      w = w.replace(r1, " ");
    }
    if (!time) {
      const r2 = /(?:^|[^\d.])\b(\d{1,2})\s*:\s*(\d{2})\b/;
      const hit2 = w.match(r2);
      if (hit2) {
        const hh = Math.min(23, Math.max(0, Number(hit2[1])));
        const mm = Math.min(59, Math.max(0, Number(hit2[2])));
        time = pad(hh) + ":" + pad(mm);
        w = w.replace(r2, " ");
      }
    }
    if (!time) {
      const r3 = /\bv\s+(\d{1,2})\s*(?:hod(?:\.|in)?|hodin(?:y|a|u)?|hod\.)\b/i;
      const hit3 = w.match(r3);
      if (hit3) {
        const hh = Math.min(23, Math.max(0, Number(hit3[1])));
        time = pad(hh) + ":00";
        w = w.replace(r3, " ");
      }
    }
    if (!time) {
      const r4 = /\b(\d{1,2})\s*hodin(?:y|a|u)?\b/i;
      const hit4 = w.match(r4);
      if (hit4) {
        const hh = Math.min(23, Math.max(0, Number(hit4[1])));
        time = pad(hh) + ":00";
        w = w.replace(r4, " ");
      }
    }
    return time ? { time, work: w.replace(/\s+/g, " ").trim() } : { time: null, work };
  }

  function parseMonthWord(tok) {
    const f = foldCs(tok);
    return CZ_MONTH[f] || null;
  }

  function resolveYMD(y, m, day, now, bumpYearIfPast) {
    let yy = y;
    if (yy < 100) yy += 2000;
    let cand = new Date(yy, m - 1, day);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (bumpYearIfPast && cand < startToday) {
      cand = new Date(yy + 1, m - 1, day);
    }
    return toDateOnly(cand);
  }

  function findAbsoluteDate(work, now) {
    let w = work;
    const reWord = /\b(\d{1,2})\.\s*([a-záéíóúůýščřďťňA-ZÁÉÍÓÚŮÝŠČŘĎŤŇ]+)\s*(?:(\d{2,4}))?\b/;
    const mW = w.match(reWord);
    if (mW) {
      const mo = parseMonthWord(mW[2]);
      if (mo) {
        const day = Number(mW[1]);
        const yIn = mW[3] ? Number(mW[3]) : now.getFullYear();
        let y = yIn;
        if (mW[3] && String(mW[3]).length === 2) y = 2000 + yIn;
        if (!mW[3]) y = now.getFullYear();
        const ds = resolveYMD(y, mo, day, now, !mW[3]);
        w = w.replace(reWord, " ");
        return { date: ds, work: w.replace(/\s+/g, " ").trim() };
      }
    }
    const reNum = /\b(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{2,4}))?\b/;
    const mN = w.match(reNum);
    if (mN) {
      const day = Number(mN[1]);
      const mo = Number(mN[2]);
      let y = mN[3] ? Number(mN[3]) : now.getFullYear();
      if (mN[3] && String(mN[3]).length === 2) y = 2000 + y;
      const explicitY = !!mN[3];
      const ds = resolveYMD(y, mo, day, now, !explicitY);
      w = w.replace(reNum, " ");
      return { date: ds, work: w.replace(/\s+/g, " ").trim() };
    }
    return null;
  }

  function findRelativeDay(work, now, hasCertainTime, timeHHMM) {
    let w = work;
    const folded = foldCs(w);
    if (/\bzitra\b/.test(folded)) {
      w = w.replace(/\bz[ií]tra\b/i, " ");
      return { date: addDays(toDateOnly(now), 1), work: w.replace(/\s+/g, " ").trim() };
    }
    if (/\bdnes\b/.test(folded)) {
      w = w.replace(/\bdnes\b/i, " ");
      return { date: toDateOnly(now), work: w.replace(/\s+/g, " ").trim() };
    }
    const reWd = iuSilverReWeekdayOnce();
    const m = w.match(reWd);
    if (m) {
      const dow = weekdayToDow(m[1]);
      if (dow >= 0) {
        const d = nextWeekdayDate(dow, now, hasCertainTime, timeHHMM);
        w = w.replace(reWd, " ");
        return { date: d, work: w.replace(/\s+/g, " ").trim() };
      }
    }
    return null;
  }

  function stripBoilerplate(work) {
    return String(work || "")
      .replace(/\bulo[žz](?:te)?\s+(?:mi\s+)?do\s+kalend[aá]ře?\b/gi, " ")
      .replace(/\bzapi[šs](?:te)?\s+(?:mi\s+)?do\s+kalend[aá]ře?\b/gi, " ")
      .replace(/\bpřidej(?:te)?\s+do\s+kalend[aá]ře?\b/gi, " ")
      .replace(/\buloz(?:te)?\s+mi\s+do\s+kalend[aá]r[eě]\b/gi, " ")
      .replace(/\bzapis(?:te)?\s+mi\b/gi, " ")
      .replace(/\buloz(?:te)?\s+mi\b/gi, " ")
      .replace(/\bdo\s+kalend[aá]ře?\b/gi, " ")
      .replace(/\bdo\s+kalend[aá]r[eě]\b/gi, " ")
      .replace(/\bkalend[aá]ře?\b/gi, " ")
      .replace(/\bkalend[aá]r[eě]\b/gi, " ")
      .replace(/\bnapl[áa]nuj(?:te)?\b/gi, " ")
      .replace(/\bvytvo[řr](?:te)?\s+ud[aá]lost\b/gi, " ")
      .replace(/\bsch[uů]zku\b/gi, " ")
      .replace(/\bsch[uů]zka\b/gi, " ")
      .replace(/\bporad[uů]\b/gi, " ")
      .replace(/\bpřidej(?:te)?\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Remove leftover weekday/time/instruction tokens; never return raw user sentence as title. */
  function iuSilverFinalizeTitle(work) {
    let t = String(work || "").replace(/\s+/g, " ").trim();
    t = stripBoilerplate(t);
    t = t.replace(iuSilverReWeekdayAll(), " ");
    t = t.replace(/\bv\s+\d{1,2}\s*:\s*\d{2}\b/gi, " ");
    t = t.replace(/\b\d{1,2}\s*:\s*\d{2}\b/g, " ");
    t = t.replace(/\bv\s+\d{1,2}\s*(?:hod(?:\.|in(?:y|a|u)?)?|hodin(?:y|a|u)?|hod\.)\b/gi, " ");
    t = t.replace(/\b\d{1,2}\s*hodin(?:y|a|u)?\b/gi, " ");
    t = t.replace(/\b(?:v|ve|na)\b/gi, " ");
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/^[.,;:\u2026–\-]+/g, "").trim();
    if (/^u\s+\S+/i.test(t) && !/^schůzka\b/i.test(t)) {
      t = "Schůzka " + t.charAt(0).toLowerCase() + t.slice(1);
    }
    const f = foldCs(t);
    if (!t || t.length < 2) return { text: "", ok: false };
    if (/uloz|ulož|kalend|\bsch[uů]zku\b|naplanuj|naplánuj|vytvor|vytvoř|zapis|zapiš|pridej|přidej/.test(f)) {
      return { text: "", ok: false };
    }
    if (iuSilverReWeekdayOnce().test(t)) return { text: "", ok: false };
    if (/\d{1,2}\s*:\s*\d{2}/.test(t)) return { text: "", ok: false };
    if (/\bv\s*\d{1,2}\b/.test(f)) return { text: "", ok: false };
    return { text: t.slice(0, 120), ok: true };
  }

  function extractFromUtterance(raw, now) {
    const values = { date: "", time: "", title: "", note: "", location: "", durationMinutes: null };
    const confidence = {
      date: "missing",
      time: "missing",
      title: "missing",
      note: "optional",
      location: "optional",
      duration: "optional"
    };

    let work = String(raw || "").trim();
    const noteHit = stripNote(work);
    if (noteHit.note) {
      values.note = noteHit.note;
      confidence.note = "certain";
    }
    work = noteHit.work;

    const durHit = stripDuration(work);
    if (durHit.minutes != null) {
      values.durationMinutes = durHit.minutes;
      confidence.duration = "certain";
    }
    work = durHit.work;

    const locHit = stripLocation(work);
    if (locHit.location) {
      values.location = locHit.location;
      confidence.location = "certain";
    }
    work = locHit.work;

    const timeHit = findTime(work);
    let timeStr = null;
    if (timeHit.time) {
      timeStr = timeHit.time;
      values.time = timeStr;
      confidence.time = "certain";
      work = timeHit.work;
    }

    const abs = findAbsoluteDate(work, now);
    if (abs) {
      values.date = abs.date;
      confidence.date = "certain";
      work = abs.work;
    }
    if (confidence.date === "missing") {
      const rel = findRelativeDay(work, now, confidence.time === "certain", values.time);
      if (rel) {
        values.date = rel.date;
        confidence.date = "certain";
        work = rel.work;
      }
    }

    work = stripBoilerplate(work);
    work = work.replace(/\b(?:v|ve|na)\b/gi, " ");
    work = work.replace(/\s+/g, " ").trim();

    const fin = iuSilverFinalizeTitle(work);
    if (fin.ok) {
      values.title = fin.text;
      confidence.title = "certain";
    } else {
      values.title = "";
      confidence.title = "missing";
    }

    return { values, confidence };
  }

  function mergeIntoDraft(draft, extracted) {
    const d = cloneDraft(draft);
    const ex = extracted;
    if (ex.confidence.date === "certain" && ex.values.date) {
      d.date = ex.values.date;
      d.meta.date = "certain";
    }
    if (ex.confidence.time === "certain" && ex.values.time) {
      d.time = ex.values.time;
      d.meta.time = "certain";
    }
    if (ex.confidence.title === "certain" && ex.values.title) {
      d.title = ex.values.title;
      d.meta.title = "certain";
    }
    if (ex.confidence.note === "certain" && ex.values.note) {
      d.note = ex.values.note;
      d.meta.note = "certain";
    }
    if (ex.confidence.location === "certain" && ex.values.location) {
      d.location = ex.values.location;
      d.meta.location = "certain";
    }
    if (ex.confidence.duration === "certain" && ex.values.durationMinutes != null) {
      d.durationMinutes = ex.values.durationMinutes;
      d.meta.duration = "certain";
    }
    return d;
  }

  function applyFragmentFallback(raw, draft, now) {
    let d = cloneDraft(draft);
    const t = findTime(String(raw));
    if (t.time && d.meta.time !== "certain") {
      d.time = t.time;
      d.meta.time = "certain";
    }
    const folded = foldCs(raw);
    if (d.meta.date !== "certain") {
      const rel = findRelativeDay(String(raw).trim(), now, d.meta.time === "certain", d.time);
      if (rel) {
        d.date = rel.date;
        d.meta.date = "certain";
      } else {
        const ax = findAbsoluteDate(String(raw).trim(), now);
        if (ax) {
          d.date = ax.date;
          d.meta.date = "certain";
        }
      }
    }
    const line = String(raw || "").trim();
    if (d.meta.title !== "certain" && line.length >= 2 && line.length <= 100 && !/[?]/.test(line)) {
      const onlyTime = findTime(line);
      const hasWd = iuSilverReWeekdayOnce().test(line);
      const hasAbs = !!findAbsoluteDate(line, now);
      const hasRel = /\bzítra|zitra|dnes\b/i.test(foldCs(line));
      if (!onlyTime.time && !hasWd && !hasAbs && !hasRel) {
        const fin = iuSilverFinalizeTitle(line);
        if (fin.ok) {
          d.title = fin.text;
          d.meta.title = "certain";
        }
      }
    }
    return d;
  }

  function computeMissing(draft) {
    const m = [];
    if (draft.meta.date !== "certain") m.push("date");
    if (draft.meta.time !== "certain") m.push("time");
    if (draft.meta.title !== "certain" || !String(draft.title || "").trim()) m.push("title");
    return m;
  }

  function buildAssistantParts(draft, processingState) {
    if (processingState === "UNSUPPORTED") {
      return {
        assistantLead:
          "Tato první verze Silvera zatím umí jen vytváření událostí v kalendáři. Napište prosím kalendářový pokyn — například den nebo datum, čas a název.",
        clarification: ""
      };
    }
    if (processingState === "READY_TO_SAVE") {
      return { assistantLead: "Připravil jsem návrh události do kalendáře.", clarification: "" };
    }
    const parts = [];
    if (draft.meta.time !== "certain") parts.push("Chybí mi přesný čas.");
    if (draft.meta.date !== "certain") parts.push("Není bezpečně určité datum.");
    if (draft.meta.title !== "certain" || !String(draft.title || "").trim()) {
      parts.push("Potřebuji ještě název události.");
    }
    let clarification = parts.slice(0, 3).join(" ");
    if (!clarification) clarification = "Potřebuji doplnit údaje o události.";
    return {
      assistantLead: "Potřebuji upřesnit detaily — níže je náhled toho, co už bezpečně držím v návrhu.",
      clarification
    };
  }

  function processUserTurn(text, prevDraft, ctx) {
    const now = ctx && ctx.now ? ctx.now : new Date();
    if (ctx && ctx.expectNoteInput) {
      const d = cloneDraft(prevDraft);
      d.note = String(text || "")
        .trim()
        .slice(0, 1000);
      d.meta.note = d.note ? "certain" : "optional";
      d.activeCalendarSession = true;
      const processingState =
        d.meta.date === "certain" && d.meta.time === "certain" && d.meta.title === "certain" && String(d.title || "").trim()
          ? "READY_TO_SAVE"
          : "NEEDS_CLARIFICATION";
      const ap = buildAssistantParts(d, processingState);
      return {
        normalizedIntent: "calendar.create",
        processingState,
        extractedFields: {},
        missingFields: computeMissing(d),
        ambiguousFields: [],
        userFacingSummary: "",
        assistantLead: ap.assistantLead,
        clarificationText: ap.clarification,
        draft: d
      };
    }

    const raw = String(text || "").trim();
    const folded = foldCs(raw);
    let draft = cloneDraft(prevDraft);
    const intent = hasCalendarIntent(folded, raw) || draft.activeCalendarSession;

    if (!intent) {
      draft.activeCalendarSession = false;
      const ap = buildAssistantParts(draft, "UNSUPPORTED");
      return {
        normalizedIntent: null,
        processingState: "UNSUPPORTED",
        extractedFields: {},
        missingFields: [],
        ambiguousFields: [],
        userFacingSummary: "",
        assistantLead: ap.assistantLead,
        clarificationText: ap.clarification,
        draft
      };
    }

    draft.activeCalendarSession = true;
    const extracted = extractFromUtterance(raw, now);
    draft = mergeIntoDraft(draft, extracted);
    draft = applyFragmentFallback(raw, draft, now);

    let processingState = "NEEDS_CLARIFICATION";
    if (draft.meta.date === "certain" && draft.meta.time === "certain" && draft.meta.title === "certain" && String(draft.title || "").trim()) {
      processingState = "READY_TO_SAVE";
    }
    const ap = buildAssistantParts(draft, processingState);
    return {
      normalizedIntent: "calendar.create",
      processingState,
      extractedFields: extracted.values,
      missingFields: computeMissing(draft),
      ambiguousFields: [],
      userFacingSummary: "",
      assistantLead: ap.assistantLead,
      clarificationText: ap.clarification,
      draft
    };
  }

  function proofWeekdayRuleSnippet() {
    return [
      "iuSilver weekday rule V1 (nextWeekdayDate):",
      "delta = (targetDow - todayDow + 7) % 7; candidate = today + delta days.",
      "If delta===0 and time is known: if event local datetime <= now, candidate += 7 days.",
      "If delta===0 and time unknown: keep same calendar day (cannot compare to now).",
      "If delta>0: use that future occurrence within the week window."
    ].join("\n");
  }

  window.iuSilverCalendarEngine = {
    createEmptyDraft,
    processUserTurn,
    proofWeekdayRuleSnippet
  };

  /* --- Fullscreen chat UI (depends on DOM; calendar save via window.iuCalendarService) --- */
  const CHAT_FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function scrollMessagesToEnd() {
    const el = document.getElementById("iuSilverChatMessages");
    if (!el) return;
    try {
      el.scrollTop = el.scrollHeight;
    } catch {}
  }

  function formatDraftRow(label, val, muted) {
    const v = val == null || String(val).trim() === "";
    const cls = v ? "iuSilverDraftV iuSilverDraftV--muted" : "iuSilverDraftV";
    const disp = v ? "není zadáno" : String(val);
    return `<div class="iuSilverDraftK">${esc(label)}</div><div class="${cls}">${esc(disp)}</div>`;
  }

  function formatDuration(draft) {
    if (draft.durationMinutes == null) return "";
    const n = draft.durationMinutes;
    if (n === 60) return "1 hodina";
    return String(n) + " min";
  }

  function renderDraftCard(turn) {
    if (turn.confirmOnly) {
      return `<div class="iuSilverMsg iuSilverMsg--assistant" data-iu-silver-msg="assistant">
  <p class="iuSilverMsgLead">${esc(turn.assistantLead)}</p>
</div>`;
    }
    const d = turn.draft;
    const st = turn.processingState;
    const missingTime = d.meta.time !== "certain";
    const missingDate = d.meta.date !== "certain";
    const addNote = !(d.note && d.meta.note === "certain");
    const showSave = st === "READY_TO_SAVE";
    const showCard = st !== "UNSUPPORTED";

    let actions = "";
    if (showCard) {
      actions += `<button type="button" class="iuSilverDraftBtn iuSilverDraftBtn--primary" data-iu-silver-action="save" ${showSave ? "" : "disabled"}>Uložit</button>`;
      actions += `<button type="button" class="iuSilverDraftBtn" data-iu-silver-action="edit">Upravit</button>`;
      if (addNote) actions += `<button type="button" class="iuSilverDraftBtn" data-iu-silver-action="addNote">Přidat poznámku</button>`;
    }

    const dateDisp = d.meta.date === "certain" && d.date ? d.date : "";
    const timeDisp = d.meta.time === "certain" && d.time ? d.time : "";
    const titleDisp = d.meta.title === "certain" ? d.title : "";
    const noteDisp = d.meta.note === "certain" ? d.note : "";
    const locDisp = d.meta.location === "certain" ? d.location : "";
    const durDisp = d.meta.duration === "certain" ? formatDuration(d) : "";

    const card = showCard
      ? `<div class="iuSilverDraftCard" data-iu-silver-draft-card="1">
  <div class="iuSilverDraftCardTitle">Návrh události</div>
  <div class="iuSilverDraftGrid">
    ${formatDraftRow("Datum", dateDisp, missingDate)}
    ${formatDraftRow("Čas", timeDisp, missingTime)}
    ${formatDraftRow("Název", titleDisp)}
    ${formatDraftRow("Poznámka", noteDisp)}
    ${formatDraftRow("Místo", locDisp)}
    ${formatDraftRow("Délka", durDisp)}
  </div>
  <div class="iuSilverDraftActions" data-iu-silver-actions="1">${actions}</div>
</div>`
      : "";

    let clar = "";
    if (st === "NEEDS_CLARIFICATION" && turn.clarificationText) {
      clar = `<p class="iuSilverMsgClarification" data-iu-silver-clarification="1">${esc(turn.clarificationText)}</p>`;
    }

    return `<div class="iuSilverMsg iuSilverMsg--assistant" data-iu-silver-msg="assistant">
  <p class="iuSilverMsgLead">${esc(turn.assistantLead)}</p>
  ${clar}
  ${card}
</div>`;
  }

  const chatState = {
    draft: createEmptyDraft(),
    expectNoteInput: false,
    saveBusy: false,
    trapOn: false,
    opened: false
  };

  function openChatOverlay(fromEl) {
    const ov = document.getElementById("iuSilverChatOverlay");
    if (!ov) return;
    chatState.returnFocus = fromEl || document.activeElement;
    ov.hidden = false;
    ov.setAttribute("aria-hidden", "false");
    document.body.classList.add("iuSilverChatOpen");
    chatState.opened = true;
    attachTrap();
    const inp = document.getElementById("iuSilverChatInput");
    if (inp) {
      try {
        inp.focus({ preventScroll: true });
      } catch {
        try {
          inp.focus();
        } catch {}
      }
    }
  }

  function closeChatOverlay() {
    const ov = document.getElementById("iuSilverChatOverlay");
    if (!ov) return;
    ov.hidden = true;
    ov.setAttribute("aria-hidden", "true");
    document.body.classList.remove("iuSilverChatOpen");
    chatState.opened = false;
    detachTrap();
    const rf = chatState.returnFocus;
    if (rf && typeof rf.focus === "function") {
      try {
        rf.focus({ preventScroll: true });
      } catch {
        try {
          rf.focus();
        } catch {}
      }
    }
  }

  function onTrapKey(e) {
    const ov = document.getElementById("iuSilverChatOverlay");
    if (!ov || ov.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeChatOverlay();
      return;
    }
    if (e.key !== "Tab") return;
    const list = Array.from(ov.querySelectorAll(CHAT_FOCUSABLE)).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function attachTrap() {
    if (chatState.trapOn) return;
    chatState.trapOn = true;
    document.addEventListener("keydown", onTrapKey, true);
  }

  function detachTrap() {
    if (!chatState.trapOn) return;
    chatState.trapOn = false;
    document.removeEventListener("keydown", onTrapKey, true);
  }

  function appendUserMessage(text) {
    const host = document.getElementById("iuSilverChatMessages");
    if (!host) return;
    const div = document.createElement("div");
    div.className = "iuSilverMsg iuSilverMsg--user";
    div.setAttribute("data-iu-silver-msg", "user");
    div.textContent = text;
    host.appendChild(div);
    scrollMessagesToEnd();
  }

  function appendAssistantTurn(turn) {
    const host = document.getElementById("iuSilverChatMessages");
    if (!host) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = renderDraftCard(turn).trim();
    const node = wrap.firstElementChild;
    if (node) host.appendChild(node);
    scrollMessagesToEnd();
  }

  function drainPendingFirstMessage() {
    try {
      const v = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
      return v ? String(v) : "";
    } catch {
      return "";
    }
  }

  function handleHomeSubmit() {
    const input = document.getElementById("iuSilverHomeInput") || document.querySelector("#silver-slot .silver-input");
    if (!input) return;
    const text = String(input.value || "").trim();
    if (!text) return;
    try {
      sessionStorage.setItem(PENDING_KEY, text);
    } catch {}
    input.value = "";
    const out = document.querySelector("#silver-slot .silver-output");
    if (out) out.innerHTML = "";
    const msgHost = document.getElementById("iuSilverChatMessages");
    if (msgHost) msgHost.innerHTML = "";
    chatState.draft = createEmptyDraft();
    chatState.expectNoteInput = false;
    chatState.saveBusy = false;
    openChatOverlay(input);
    const first = drainPendingFirstMessage();
    if (first) {
      appendUserMessage(first);
      const eng = window.iuSilverCalendarEngine;
      const turn = eng.processUserTurn(first, chatState.draft, { now: new Date(), expectNoteInput: !!chatState.expectNoteInput });
      chatState.draft = turn.draft;
      appendAssistantTurn(turn);
    }
  }

  function handleComposerSubmit() {
    const input = document.getElementById("iuSilverChatInput");
    if (!input) return;
    const text = String(input.value || "").trim();
    if (!text) return;
    input.value = "";
    appendUserMessage(text);
    const eng = window.iuSilverCalendarEngine;
    const turn = eng.processUserTurn(text, chatState.draft, { now: new Date(), expectNoteInput: !!chatState.expectNoteInput });
    chatState.expectNoteInput = false;
    chatState.draft = turn.draft;
    appendAssistantTurn(turn);
  }

  async function handleSaveClick() {
    if (chatState.saveBusy) return;
    const svc = window.iuCalendarService;
    if (!svc || typeof svc.calendarCreateEvent !== "function") {
      appendAssistantTurn({
        processingState: "NEEDS_CLARIFICATION",
        assistantLead: "Kalendářová služba ještě není připravena. Zkuste obnovit stránku.",
        clarificationText: "",
        draft: chatState.draft
      });
      return;
    }
    const d = chatState.draft;
    if (d.meta.date !== "certain" || d.meta.time !== "certain" || d.meta.title !== "certain" || !String(d.title || "").trim()) {
      return;
    }
    chatState.saveBusy = true;
    const noteParts = [];
    if (d.note) noteParts.push(d.note);
    if (d.location) noteParts.push("Místo: " + d.location);
    const noteJoined = noteParts.join("\n\n").slice(0, 1000);
    try {
      const res = await svc.calendarCreateEvent({
        date: d.date,
        time: d.time,
        title: d.title,
        note: noteJoined,
        type: "personal",
        attachments: []
      });
      if (res && res.ok && res.event) {
        const ev = res.event;
        appendAssistantTurn({
          confirmOnly: true,
          processingState: "READY_TO_SAVE",
          assistantLead: "Uloženo do kalendáře: " + ev.date + " v " + ev.time + " — " + ev.title + ".",
          clarificationText: "",
          draft: createEmptyDraft()
        });
        chatState.draft = createEmptyDraft();
      } else {
        appendAssistantTurn({
          processingState: "NEEDS_CLARIFICATION",
          assistantLead: "Nepodařilo se uložit. Zkuste to znovu.",
          clarificationText: "",
          draft: chatState.draft
        });
      }
    } finally {
      chatState.saveBusy = false;
    }
  }

  function onOverlayClick(e) {
    const t = e.target;
    const close = t && t.closest ? t.closest("[data-iu-silver-chat-close]") : null;
    if (close) {
      e.preventDefault();
      closeChatOverlay();
      return;
    }
    const act = t && t.closest ? t.closest("[data-iu-silver-action]") : null;
    if (!act) return;
    const a = act.getAttribute("data-iu-silver-action") || "";
    if (a === "save") {
      e.preventDefault();
      void handleSaveClick();
    } else if (a === "edit") {
      e.preventDefault();
      appendAssistantTurn({
        processingState: "NEEDS_CLARIFICATION",
        assistantLead: "Co chcete upravit? Napište například nový čas, datum nebo přesný název — upravím jen uvedené části návrhu.",
        clarificationText: "",
        draft: chatState.draft
      });
    } else if (a === "addNote") {
      e.preventDefault();
      chatState.expectNoteInput = true;
      appendAssistantTurn({
        processingState: "NEEDS_CLARIFICATION",
        assistantLead: "Napište krátkou poznámku k události.",
        clarificationText: "",
        draft: chatState.draft
      });
    }
  }

  function boot() {
    const homeIn = document.getElementById("iuSilverHomeInput");
    const homeSend = document.getElementById("iuSilverHomeSend");
    const cIn = document.getElementById("iuSilverChatInput");
    const cSend = document.getElementById("iuSilverChatSend");
    const overlay = document.getElementById("iuSilverChatOverlay");

    if (homeSend) {
      homeSend.addEventListener("click", (e) => {
        e.preventDefault();
        handleHomeSubmit();
      });
    }
    if (homeIn) {
      homeIn.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        handleHomeSubmit();
      });
    }

    if (cSend) {
      cSend.addEventListener("click", (e) => {
        e.preventDefault();
        handleComposerSubmit();
      });
    }
    if (cIn) {
      cIn.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        handleComposerSubmit();
      });
    }
    if (overlay) overlay.addEventListener("click", onOverlayClick);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
