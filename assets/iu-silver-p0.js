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

  /** Human date for UI (day. month. year); internal storage may stay ISO. */
  function iuSilverFormatDateCs(iso) {
    if (!iso || typeof iso !== "string") return "";
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    return day + ". " + mo + ". " + y;
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
    if (/\bpoz[ií]t[rř][ií]\b/i.test(raw)) return true;
    if (iuSilverReWeekdayOnce().test(raw)) return true;
    if (/\b\d{1,2}\s*\.\s*\d{1,2}\s*\./.test(folded)) return true;
    if (/\b\d{1,2}\s*[.\/\-]\s*\d{1,2}\b/.test(raw)) return true;
    if (/\b\d{1,2}\s*\.\s*[a-záéíóúůýščřďťň]+/i.test(raw)) return true;
    if (/\budalost/.test(folded)) return true;
    if (/\bkontrola\b|\bnavstev/.test(folded)) return true;
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
    const r1 = /\b(?:v|ve)\s+(\d{1,2})\s*:\s*(\d{2})\b/i;
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
      const rOd = /\bod\s+(\d{1,2})\s*(?::(\d{2}))?\s*(?:hod(?:\.|in(?:y|a|u)?)?)?\b/i;
      const hitOd = w.match(rOd);
      if (hitOd) {
        const hh = Math.min(23, Math.max(0, Number(hitOd[1])));
        const mm = hitOd[2] != null && hitOd[2] !== "" ? Math.min(59, Math.max(0, Number(hitOd[2]))) : 0;
        time = pad(hh) + ":" + pad(mm);
        w = w.replace(rOd, " ");
      }
    }
    if (!time) {
      const r3 = /\b(?:v|ve)\s+(\d{1,2})\s*(?:hod(?:\.|in)?|hodin(?:y|a|u)?|hod\.)\b/i;
      const hit3 = w.match(r3);
      if (hit3) {
        const hh = Math.min(23, Math.max(0, Number(hit3[1])));
        time = pad(hh) + ":00";
        w = w.replace(r3, " ");
      }
    }
    if (!time) {
      const rBare = /\b(?:v|ve)\s+(\d{1,2})\b(?!\s*:)(?!\s*hod)/i;
      const hitB = w.match(rBare);
      if (hitB) {
        const hh = Math.min(23, Math.max(0, Number(hitB[1])));
        time = pad(hh) + ":00";
        w = w.replace(rBare, " ");
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

  function iuSilverValidDayMonth(day, mo) {
    return mo >= 1 && mo <= 12 && day >= 1 && day <= 31;
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

    const patterns = [
      /\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})\b/,
      /\b(\d{1,2})\.\s*(\d{1,2})\.(?!\s*\d)/,
      /\b(\d{1,2})\.\s*(\d{1,2})(?!\.\d)/,
      /\b(\d{1,2})\/\s*(\d{1,2})\b(?!\s*(?:hod|min|hodin|minut)\b)/i,
      /\b(\d{1,2})-\s*(\d{1,2})\b(?!\s*(?:hod|min|hodin|minut)\b)/i
    ];

    for (let pi = 0; pi < patterns.length; pi++) {
      const re = patterns[pi];
      const m = w.match(re);
      if (!m) continue;
      const day = Number(m[1]);
      const mo = Number(m[2]);
      if (!iuSilverValidDayMonth(day, mo)) continue;
      let y = now.getFullYear();
      let explicit = false;
      if (m[3] !== undefined && m[3] !== "") {
        y = Number(m[3]);
        if (String(m[3]).length === 2) y = 2000 + y;
        explicit = true;
      }
      const ds = resolveYMD(y, mo, day, now, !explicit);
      w = w.replace(re, " ");
      return { date: ds, work: w.replace(/\s+/g, " ").trim() };
    }
    return null;
  }

  function findRelativeDay(work, now, hasCertainTime, timeHHMM) {
    let w = work;
    const folded = foldCs(w);
    if (/\bpoz[ií]t[rř][ií]\b/i.test(w)) {
      w = w.replace(/\bpoz[ií]t[rř][ií]\b/i, " ");
      return { date: addDays(toDateOnly(now), 2), work: w.replace(/\s+/g, " ").trim() };
    }
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
    return iuSilverNormalizeWs(iuSilverStripCommandBoilerplateIterative(String(work || "")));
  }

  function iuSilverNormalizeWs(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .replace(/[\u00a0]+/g, " ")
      .trim();
  }

  /** Drop trailing sentence(s) that are pure calendar commands (after ". "). */
  function iuSilverDropInstructionSentences(s) {
    let t = String(s);
    const dmMask = [];
    let mi = 0;
    t = t.replace(/\b(\d{1,2}\.\s*\d{1,2}\.)\s*/g, function (full) {
      const ph = "\uE000DM" + mi + "\uE001";
      dmMask[mi] = full;
      mi++;
      return ph;
    });
    const parts = t
      .split(/\.\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        let x = p;
        for (let j = 0; j < dmMask.length; j++) {
          x = x.replace("\uE000DM" + j + "\uE001", dmMask[j] != null ? dmMask[j] : "");
        }
        return x.trim();
      });
    if (parts.length < 2) return s;
    const kept = [];
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i];
      const fc = foldCs(c);
      const isInstruction = /ulož|uloz|kalend|zapiš|zapis|přidej|pridej|mi\s+to|tak\s+mi|dej\s+to/.test(fc);
      const hasEventHint =
        /schuz|navstev|kontrol|zubar|pediatr|vyzvednout|\bmam\s+/.test(fc);
      if (isInstruction && !hasEventHint) continue;
      kept.push(c);
    }
    return kept.length ? kept.join(". ") : s;
  }

  /**
   * Content-first: pull event title from known phrases (not from leftover command glue).
   * Runs on work string after date/time tokens are removed from utterance elsewhere.
   */
  function iuSilverExtractEventCoreTitle(t0) {
    const raw = iuSilverNormalizeWs(t0);
    if (!raw || raw.length < 2) return null;

    let m = raw.match(/\bpřijde\s+(\S+?)\s+na\s+n[áa]vštěvu\b/i);
    if (m) {
      const w = m[1].replace(/[.,]+$/g, "");
      if (/^petr$/i.test(w)) return "Návštěva Petra";
      return "Návštěva " + w;
    }

    m = raw.match(/\b(?:přijdou\s+)?montovat\s+(\S+)/i);
    if (m) {
      const o = m[1].replace(/[.,]+$/g, "");
      if (/^vodoměr/i.test(o)) return "Montáž vodoměru";
      return "Montáž " + o.charAt(0).toLocaleUpperCase("cs-CZ") + o.slice(1);
    }

    m = raw.match(/\bzubař(?:e)?\s+na\s+(\S+)/i);
    if (m) {
      const place = m[1].replace(/[.,]+$/g, "");
      return "Zubař na " + place.charAt(0).toLocaleUpperCase("cs-CZ") + place.slice(1);
    }

    if (/\bmám\s+být\b/i.test(raw) && /\bu\s+zubaře\b/i.test(raw)) return "Zubař";
    if (/\bu\s+zubaře\b/i.test(raw) && !/návštěvu/i.test(raw)) return "Zubař";

    m = raw.match(/\boběd\s+u\s+rodičů/i);
    if (m) return "Oběd u rodičů";

    m = raw.match(/\bzoo\s+(\S+)/i);
    if (m) {
      const rest = m[1].replace(/[.,]+$/g, "");
      return "Zoo " + rest;
    }

    m = raw.match(/^\s*návštěva\s+(.+)$/i);
    if (m && m[1]) {
      const rest = m[1].trim().replace(/[.,]+$/g, "");
      if (rest.length) return "Návštěva " + rest;
    }

    m = raw.match(/^\s*mám\s+poradu\b/i);
    if (m) return "Porada";

    return null;
  }

  /** schůzku / návštěvu / kontrolu → nominative + rest (e.g. „s panem Novotným“). */
  function iuSilverNormalizeEventTypeTitle(s) {
    let t = iuSilverNormalizeWs(s);
    const pairs = [
      [/^\s*schůzek\b/i, "Schůzka"],
      [/^\s*schůzk(u|y|a|e|i)\b/i, "Schůzka"],
      [/^\s*návštěv(u|y|a|e|i)\b/i, "Návštěva"],
      [/^\s*kontrol(u|y|a|e|i)\b/i, "Kontrola"],
      [/^\s*porad(u|y|a|e|i)\b/i, "Porada"]
    ];
    for (let i = 0; i < pairs.length; i++) {
      const re = pairs[i][0];
      const base = pairs[i][1];
      const m = t.match(re);
      if (m) {
        const rest = t.slice(m[0].length).trim();
        return rest ? base + " " + rest : base;
      }
    }
    return t;
  }

  /** "mám zubaře" → "Zubař"; "mám vyzvednout …" → infinitive sentence title. */
  function iuSilverMamToEventTitle(s) {
    let t = iuSilverNormalizeWs(s);
    const m = t.match(/^\s*mám\s+(.+)$/i);
    if (!m) return t;
    let inner = m[1].trim();
    inner = inner.replace(/[.,;]+$/g, "").trim();
    if (/^zubaře$/i.test(inner)) return "Zubař";
    if (/^poradu$/i.test(inner)) return "Porada";
    if (/^pediatra$/i.test(inner)) return "Pediatr";
    if (/^vyzvednout\b/i.test(inner)) {
      return inner.charAt(0).toLocaleUpperCase("cs-CZ") + inner.slice(1);
    }
    return inner.charAt(0).toLocaleUpperCase("cs-CZ") + inner.slice(1);
  }

  function iuSilverStripGarbageOrphanTokens(s) {
    let t = iuSilverNormalizeWs(s);
    for (let i = 0; i < 12; i++) {
      const prev = t;
      t = t.replace(/\b(tak\s+mi\s+to|mi\s+to|tak\s+to|a\s+to)\b/gi, " ");
      t = t.replace(/\b(tento|tato|této|že)\b/gi, " ");
      t = t.replace(/\b(to|tak|mi)\b/gi, " ");
      t = t.replace(/\s+\.\s+/g, " ");
      t = t.replace(/^\s*\.\s*/g, "");
      t = t.replace(/\s*\.\s*$/g, "");
      t = iuSilverNormalizeWs(t);
      if (t === prev) break;
    }
    return t;
  }

  /** Iterative removal of calendar command phrases (any position in sentence). */
  function iuSilverStripCommandBoilerplateIterative(s) {
    let t = iuSilverNormalizeWs(s);
    const patterns = [
      /\btento\b/gi,
      /\btak\s+mi\s+to\s+ulož(?:te)?(?:\s+do\s+kalend[aá]ře?)?\b/gi,
      /\bul[oó]ž(?:te)?\s+mi\s+to\b/gi,
      /\bmi\s+to\s+ulož(?:te)?\b/gi,
      /\btak\s+to\s+ulož(?:te)?\b/gi,
      /\bdej\s+to\s+do\s+kalend[aá]ře?\b/gi,
      /\ba\s+ulož(?:te)?\s+to\b/gi,
      /\bul[oó]ž(?:te)?\s+to\b/gi,
      /\bul[oó]ž(?:te)?\s+mi\s+v\s+kalend[aá]ř[ei]\b/gi,
      /\bul[oó]ž(?:te)?\s+mi\s+do\s+kalend[aá]ře?\b/gi,
      /\bul[oó]ž(?:te)?\s+do\s+kalend[aá]ře?\b/gi,
      /\bul[oó]ž(?:te)?\s+v\s+kalend[aá]ř[ei]\b/gi,
      /\bzapi[šs](?:te)?\s+mi\s+do\s+kalend[aá]ře?\b/gi,
      /\bzapi[šs](?:te)?\s+do\s+kalend[aá]ře?\b/gi,
      /\bpřidej(?:te)?\s+mi\s+do\s+kalend[aá]ře?\b/gi,
      /\bpřidej(?:te)?\s+do\s+kalend[aá]ře?\b/gi,
      /\bdo\s+mého\s+kalend[aá]ře?\b/gi,
      /\bdo\s+kalend[aá]ře?\s+mi\s+dej\b/gi,
      /\bmi\s+ulož\b/gi,
      /\bulož\s+do\b/gi,
      /\bv\s+kalend[aá]ř[ei]\b/gi,
      /\bdo\s+kalend[aá]ře?\b/gi,
      /\bvytvo[řr](?:te)?\s+mi\s+ud[aá]lost\b/gi,
      /\bvytvo[řr](?:te)?\s+ud[aá]lost\b/gi,
      /\buloz(?:te)?\s+mi\s+do\s+kalend[aá]r[eě]\b/gi,
      /\bzapis(?:te)?\s+mi\b/gi,
      /\buloz(?:te)?\s+mi\b/gi,
      /\bdo\s+kalend[aá]r[eě]\b/gi,
      /\bnapl[áa]nuj(?:te)?\b/gi,
      /\bul[oó]ž(?:te)?\s+mi\b/gi,
      /\bzapi[šs](?:te)?\b/gi,
      /\bpřidej(?:te)?\b/gi,
      /\bul[oó]ž(?:te)?\b/gi,
      /\bkalend[aá]ř[ei]?\b/gi,
      /\bkalend[aá]r[eě]\b/gi,
      /\btak\s+to\b/gi,
      /\bmi\s+to\b/gi
    ];
    for (let iter = 0; iter < 22; iter++) {
      const prev = t;
      for (let i = 0; i < patterns.length; i++) {
        t = t.replace(patterns[i], " ");
      }
      t = iuSilverNormalizeWs(t);
      if (t === prev) break;
    }
    return t;
  }

  function iuSilverStripNumericDateFragments(t0) {
    let t = t0;
    const patterns = [
      /\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})\b/g,
      /\b(\d{1,2})\.\s*(\d{1,2})\.(?!\s*\d)/g,
      /\b(\d{1,2})\.\s*(\d{1,2})(?!\.\d)/g,
      /\b(\d{1,2})\/\s*(\d{1,2})\b(?!\s*(?:hod|min|hodin|minut)\b)/gi,
      /\b(\d{1,2})-\s*(\d{1,2})\b(?!\s*(?:hod|min|hodin|minut)\b)/gi
    ];
    for (let iter = 0; iter < 6; iter++) {
      const prev = t;
      for (let i = 0; i < patterns.length; i++) {
        t = t.replace(patterns[i], " ");
      }
      t = iuSilverNormalizeWs(t);
      if (t === prev) break;
    }
    return t;
  }

  function iuSilverStripDateTokensFromTitle(s) {
    let t = iuSilverNormalizeWs(s);
    t = t.replace(/\bpoz[ií]t[rř][ií]\b/gi, " ");
    t = t.replace(/\bz[ií]tra\b/gi, " ");
    t = t.replace(/\bdnes\b/gi, " ");
    t = t.replace(iuSilverReWeekdayAll(), " ");
    t = iuSilverStripNumericDateFragments(t);
    t = t.replace(/\b\d{1,2}\s*\.\s*[a-záéíóúůýščřďťňA-ZÁÉÍÓÚŮÝŠČŘĎŤŇ]+\b/gi, " ");
    return iuSilverNormalizeWs(t);
  }

  function iuSilverStripTimeTokensFromTitle(s) {
    let t = iuSilverNormalizeWs(s);
    t = t.replace(/\b(?:v|ve)\s+\d{1,2}\s*:\s*\d{2}\b/gi, " ");
    t = t.replace(/\b\d{1,2}\s*:\s*\d{2}\b/g, " ");
    t = t.replace(/\b(?:v|ve)\s+\d{1,2}\b/gi, " ");
    t = t.replace(/\bod\s+\d{1,2}\s*(?::\d{2})?\s*(?:hod(?:\.|in(?:y|a|u)?)?)?\b/gi, " ");
    t = t.replace(/\b(?:v|ve)\s+\d{1,2}\s*(?:hod(?:\.|in(?:y|a|u)?)?|hodin(?:y|a|u)?|hod\.)\b/gi, " ");
    t = t.replace(/\b\d{1,2}\s*hodin(?:y|a|u)?\b/gi, " ");
    t = t.replace(/\b\d{1,2}\s*hod\.?\b/gi, " ");
    return iuSilverNormalizeWs(t);
  }

  function iuSilverStripOrphanParticles(s) {
    let t = iuSilverNormalizeWs(s);
    for (let i = 0; i < 10; i++) {
      const prev = t;
      t = t.replace(/^(že|tento|tato|této|to|tak|mi|mám|je)\s+/gi, " ");
      t = t.replace(/\s+(to|tak|mi|že)(\s*)$/gi, " ");
      t = iuSilverNormalizeWs(t);
      if (t === prev) break;
    }
    t = t.replace(/^[.,;:\u2026–\-]+/g, "").trim();
    t = t.replace(/[.,;:\u2026–\-]+$/g, "").trim();
    return t;
  }

  function iuSilverPolishTitleNoun(t) {
    let x = t;
    if (/^zubaře$/i.test(x)) x = "Zubař";
    else if (/^pediatra$/i.test(x)) x = "Pediatr";
    else if (x.length) {
      x = x.charAt(0).toLocaleUpperCase("cs-CZ") + x.slice(1);
    }
    return x;
  }

  function iuSilverValidateFinalTitle(t) {
    const f = foldCs(t);
    if (!t || t.length < 2) return false;
    if (t.length < 3) return false;
    if (/^(že|tento|tato|mám|je|tak)\b/.test(f)) return false;
    if (/\s+(to|tak|mi|že)\s*$/.test(t)) return false;
    if (/\d{1,2}\s*[.\/\-]\s*\d{1,2}/.test(t)) return false;
    if (/\d{1,2}\s*\.\s*\d{1,2}\s*\./.test(t)) return false;
    if (/\.\s*\./.test(t)) return false;
    if (/^\s*s\s*$/i.test(t)) return false;
    if (/uloz|ulož|přidej|pridej|zapis|zapiš|kalend|napl[áa]nuj|vytvor|vytvoř/.test(f)) return false;
    if (/\bmám\b/.test(f)) return false;
    if (/\b(že|tento)\b/.test(f)) return false;
    if (/\bto\b|\btak\b|\bmi\b/.test(f)) return false;
    if (/\bsch[uů]zku\b/.test(f) && !/^schůzka u\b/i.test(t)) return false;
    if (iuSilverReWeekdayOnce().test(t)) return false;
    if (/\d{1,2}\s*:\s*\d{2}/.test(t)) return false;
    if (/\d{1,2}\s*hod/.test(f)) return false;
    if (/\bod\s*\d/.test(f)) return false;
    if (/\bv\s*\d{1,2}\b/.test(f)) return false;
    if (/\bve\s*\d{1,2}\b/.test(f)) return false;
    if (/\s\d{1,2}$/.test(t)) return false;
    if (/\bzitra\b|\bdnes\b|\bpozit/.test(f)) return false;
    if (/\b(ponděl|úter|střed|čtvrtek|pátek|sobota|neděl)/i.test(t)) return false;
    return true;
  }

  /** Deterministic multi-step title pipeline — not a copy of user command text. */
  function iuSilverTitlePipelineFull(work) {
    let t = iuSilverNormalizeWs(work);
    t = iuSilverDropInstructionSentences(t);
    t = iuSilverStripCommandBoilerplateIterative(t);
    t = iuSilverStripDateTokensFromTitle(t);
    t = iuSilverStripTimeTokensFromTitle(t);
    t = iuSilverStripCommandBoilerplateIterative(t);
    t = iuSilverStripGarbageOrphanTokens(t);
    const core = iuSilverExtractEventCoreTitle(t);
    if (core && String(core).trim().length >= 2) {
      t = iuSilverNormalizeWs(core);
      t = iuSilverStripGarbageOrphanTokens(t);
      t = iuSilverNormalizeWs(t);
      t = iuSilverPolishTitleNoun(t);
      t = iuSilverNormalizeWs(t);
      if (!iuSilverValidateFinalTitle(t)) return { text: "", ok: false };
      return { text: t.slice(0, 120), ok: true };
    }
    t = iuSilverStripGarbageOrphanTokens(t);
    t = iuSilverNormalizeEventTypeTitle(t);
    t = iuSilverMamToEventTitle(t);
    t = iuSilverStripGarbageOrphanTokens(t);
    t = iuSilverStripOrphanParticles(t);
    t = iuSilverNormalizeWs(t);
    if (/^u\s+\S+/i.test(t) && !/^schůzka\b/i.test(t)) {
      t = "Schůzka " + t.charAt(0).toLowerCase() + t.slice(1);
    }
    t = iuSilverPolishTitleNoun(t);
    t = iuSilverNormalizeWs(t);
    if (!iuSilverValidateFinalTitle(t)) return { text: "", ok: false };
    return { text: t.slice(0, 120), ok: true };
  }

  function iuSilverFinalizeTitle(work) {
    return iuSilverTitlePipelineFull(work);
  }

  function iuSilverSanitizeDraftTitle(draft) {
    const rawT = String(draft.title || "").trim();
    if (!rawT) {
      draft.title = "";
      draft.meta.title = "missing";
      return;
    }
    const fin = iuSilverTitlePipelineFull(rawT);
    if (fin.ok) {
      draft.title = fin.text;
      draft.meta.title = "certain";
    } else {
      draft.title = "";
      draft.meta.title = "missing";
    }
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

    const fin = iuSilverTitlePipelineFull(work);
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
      const hasRel = /\bz[ií]tra|dnes|poz[ií]t[rř][ií]\b/i.test(foldCs(line));
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
    iuSilverSanitizeDraftTitle(draft);

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

  function isDraftSaveable(d) {
    return (
      d.meta.date === "certain" &&
      d.meta.time === "certain" &&
      d.meta.title === "certain" &&
      String(d.title || "").trim().length > 0
    );
  }

  function processingStateFromDraft(d) {
    return isDraftSaveable(d) ? "READY_TO_SAVE" : "NEEDS_CLARIFICATION";
  }

  function formatDraftRow(label, val, muted, rowOpts) {
    rowOpts = rowOpts || {};
    const v = val == null || String(val).trim() === "";
    let cls = v ? "iuSilverDraftV iuSilverDraftV--muted" : "iuSilverDraftV";
    if (rowOpts.warnMissingDate && v) cls += " iuSilverDraftV--warningMissing";
    const disp = v ? "není zadáno" : String(val);
    return `<div class="iuSilverDraftK">${esc(label)}</div><div class="${cls}">${esc(disp)}</div>`;
  }

  function formatDuration(draft) {
    if (draft.durationMinutes == null) return "";
    const n = draft.durationMinutes;
    if (n === 60) return "1 hodina";
    return String(n) + " min";
  }

  function renderDraftCardViewGrid(d) {
    const missingTime = d.meta.time !== "certain";
    const missingDate = d.meta.date !== "certain";
    const dateDisp = d.meta.date === "certain" && d.date ? iuSilverFormatDateCs(String(d.date)) : "";
    const timeDisp = d.meta.time === "certain" && d.time ? d.time : "";
    const titleDisp = d.meta.title === "certain" ? d.title : "";
    const noteDisp = d.meta.note === "certain" ? d.note : "";
    const locDisp = d.meta.location === "certain" ? d.location : "";
    const durDisp = d.meta.duration === "certain" ? formatDuration(d) : "";
    return `<div class="iuSilverDraftGrid">
    ${formatDraftRow("Datum", dateDisp, missingDate, { warnMissingDate: true })}
    ${formatDraftRow("Čas", timeDisp, missingTime)}
    ${formatDraftRow("Název", titleDisp)}
    ${formatDraftRow("Poznámka", noteDisp)}
    ${formatDraftRow("Místo", locDisp)}
    ${formatDraftRow("Délka", durDisp)}
  </div>`;
  }

  function renderDraftCardEditGrid(d) {
    const dateVal = d.meta.date === "certain" && d.date ? String(d.date).slice(0, 10) : "";
    const timeVal = d.meta.time === "certain" && d.time ? String(d.time).slice(0, 5) : "";
    const titleVal = d.meta.title === "certain" ? String(d.title || "") : "";
    const noteVal = d.meta.note === "certain" ? String(d.note || "") : "";
    const locVal = d.meta.location === "certain" ? String(d.location || "") : "";
    const durVal = d.durationMinutes != null ? String(d.durationMinutes) : "";
    return `<div class="iuSilverDraftGrid iuSilverDraftGrid--edit">
    <div class="iuSilverDraftK">Datum</div><input type="date" class="iuSilverDraftInput" data-iu-silver-field="date" value="${esc(dateVal)}" />
    <div class="iuSilverDraftK">Čas</div><input type="time" step="60" class="iuSilverDraftInput" data-iu-silver-field="time" value="${esc(timeVal)}" />
    <div class="iuSilverDraftK">Název</div><input type="text" maxlength="160" class="iuSilverDraftInput" data-iu-silver-field="title" value="${esc(titleVal)}" autocomplete="off" />
    <div class="iuSilverDraftK">Poznámka</div><textarea class="iuSilverDraftInput iuSilverDraftInput--note" rows="2" maxlength="1000" data-iu-silver-field="note">${esc(noteVal)}</textarea>
    <div class="iuSilverDraftK">Místo</div><input type="text" maxlength="200" class="iuSilverDraftInput" data-iu-silver-field="location" value="${esc(locVal)}" autocomplete="off" />
    <div class="iuSilverDraftK">Délka</div><input type="number" min="1" max="1440" class="iuSilverDraftInput" data-iu-silver-field="duration" placeholder="minuty" value="${esc(durVal)}" />
  </div>`;
  }

  function renderDraftCard(turn, opts) {
    opts = opts || {};
    const editMode = !!opts.editMode;
    if (turn.confirmOnly) {
      return `<div class="iuSilverMsg iuSilverMsg--assistant" data-iu-silver-msg="assistant">
  <p class="iuSilverMsgLead">${esc(turn.assistantLead)}</p>
</div>`;
    }
    if (turn.processingState === "UNSUPPORTED") {
      return `<div class="iuSilverMsg iuSilverMsg--assistant" data-iu-silver-msg="assistant">
  <p class="iuSilverMsgLead">${esc(turn.assistantLead)}</p>
</div>`;
    }
    const d = turn.draft;
    const st = processingStateFromDraft(d);
    const showSave = isDraftSaveable(d);
    const showCard = true;

    let actions = "";
    if (showCard) {
      actions += `<button type="button" class="iuSilverDraftBtn iuSilverDraftBtn--primary" data-iu-silver-action="save" ${showSave ? "" : "disabled"}>Uložit</button>`;
      actions += `<button type="button" class="iuSilverDraftBtn" data-iu-silver-action="edit" aria-pressed="${editMode ? "true" : "false"}">Upravit</button>`;
    }

    const grid = editMode ? renderDraftCardEditGrid(d) : renderDraftCardViewGrid(d);

    const card = showCard
      ? `<div class="iuSilverDraftCard" data-iu-silver-draft-card="1" data-iu-silver-edit-mode="${editMode ? "1" : "0"}">
  <div class="iuSilverDraftCardTitle">Návrh události</div>
  ${grid}
  <div class="iuSilverDraftActions" data-iu-silver-actions="1">${actions}</div>
</div>`
      : "";

    let clar = "";
    if (st === "NEEDS_CLARIFICATION" && turn.clarificationText) {
      clar = `<p class="iuSilverMsgClarification iuSilverMsgClarification--warning" data-iu-silver-clarification="1">${esc(turn.clarificationText)}</p>`;
    }

    const leadClass = st === "NEEDS_CLARIFICATION" ? "iuSilverMsgLead iuSilverMsgLead--warning" : "iuSilverMsgLead";

    return `<div class="iuSilverMsg iuSilverMsg--assistant" data-iu-silver-msg="assistant">
  <p class="${leadClass}">${esc(turn.assistantLead)}</p>
  ${clar}
  ${card}
</div>`;
  }

  const chatState = {
    draft: createEmptyDraft(),
    lastDraftTurn: null,
    cardEditMode: false,
    saveBusy: false,
    trapOn: false,
    opened: false
  };

  function getLastDraftCardEl() {
    const host = document.getElementById("iuSilverChatMessages");
    if (!host) return null;
    const cards = host.querySelectorAll("[data-iu-silver-draft-card]");
    return cards.length ? cards[cards.length - 1] : null;
  }

  function patchDraftCardMessageCopy(cardEl) {
    const msg = cardEl.closest(".iuSilverMsg--assistant");
    if (!msg) return;
    const d = cloneDraft(chatState.draft);
    const ps = processingStateFromDraft(d);
    const ap = buildAssistantParts(d, ps);
    const lead = msg.querySelector(".iuSilverMsgLead");
    if (lead) {
      lead.textContent = ap.assistantLead;
      lead.classList.toggle("iuSilverMsgLead--warning", ps === "NEEDS_CLARIFICATION");
    }
    const clar = msg.querySelector("[data-iu-silver-clarification]");
    if (ps === "NEEDS_CLARIFICATION" && ap.clarification) {
      if (clar) {
        clar.textContent = ap.clarification;
        clar.classList.add("iuSilverMsgClarification--warning");
      } else {
        const p = document.createElement("p");
        p.className = "iuSilverMsgClarification iuSilverMsgClarification--warning";
        p.setAttribute("data-iu-silver-clarification", "1");
        p.textContent = ap.clarification;
        const leadEl = msg.querySelector(".iuSilverMsgLead");
        if (leadEl && leadEl.parentNode) {
          if (leadEl.nextSibling) leadEl.parentNode.insertBefore(p, leadEl.nextSibling);
          else leadEl.parentNode.appendChild(p);
        }
      }
    } else if (clar) clar.remove();
  }

  function syncDraftFromCardInputs(cardEl) {
    if (!cardEl) return;
    const d = cloneDraft(chatState.draft);
    const dateIn = cardEl.querySelector('[data-iu-silver-field="date"]');
    if (dateIn) {
      if (dateIn.value) {
        d.date = dateIn.value;
        d.meta.date = "certain";
      } else {
        d.date = "";
        d.meta.date = "missing";
      }
    }
    const timeIn = cardEl.querySelector('[data-iu-silver-field="time"]');
    if (timeIn) {
      if (timeIn.value) {
        d.time = timeIn.value;
        d.meta.time = "certain";
      } else {
        d.time = "";
        d.meta.time = "missing";
      }
    }
    const titleIn = cardEl.querySelector('[data-iu-silver-field="title"]');
    if (titleIn) {
      d.title = String(titleIn.value || "")
        .trim()
        .slice(0, 160);
      d.meta.title = d.title ? "certain" : "missing";
    }
    const noteIn = cardEl.querySelector('[data-iu-silver-field="note"]');
    if (noteIn) {
      d.note = String(noteIn.value || "")
        .trim()
        .slice(0, 1000);
      d.meta.note = d.note ? "certain" : "optional";
    }
    const locIn = cardEl.querySelector('[data-iu-silver-field="location"]');
    if (locIn) {
      d.location = String(locIn.value || "")
        .trim()
        .slice(0, 200);
      d.meta.location = d.location ? "certain" : "optional";
    }
    const durIn = cardEl.querySelector('[data-iu-silver-field="duration"]');
    if (durIn) {
      const raw = String(durIn.value || "").trim();
      if (raw === "") {
        d.durationMinutes = null;
        d.meta.duration = "optional";
      } else {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n > 0) {
          d.durationMinutes = n;
          d.meta.duration = "certain";
        } else {
          d.durationMinutes = null;
          d.meta.duration = "missing";
        }
      }
    }
    iuSilverSanitizeDraftTitle(d);
    chatState.draft = d;
    const ps = processingStateFromDraft(d);
    const ap = buildAssistantParts(d, ps);
    if (chatState.lastDraftTurn) {
      chatState.lastDraftTurn = {
        ...chatState.lastDraftTurn,
        draft: cloneDraft(d),
        assistantLead: ap.assistantLead,
        clarificationText: ap.clarification,
        processingState: ps
      };
    }
    patchDraftCardMessageCopy(cardEl);
  }

  function refreshLastDraftCard() {
    const cardEl = getLastDraftCardEl();
    if (!cardEl) return;
    if (cardEl.querySelector("[data-iu-silver-field]")) {
      syncDraftFromCardInputs(cardEl);
    }
    const msg = cardEl.closest(".iuSilverMsg--assistant");
    if (!msg) return;
    const turn = chatState.lastDraftTurn;
    if (!turn) return;
    const d = cloneDraft(chatState.draft);
    const ps = processingStateFromDraft(d);
    const ap = buildAssistantParts(d, ps);
    const turnOut = {
      ...turn,
      draft: d,
      processingState: ps,
      assistantLead: ap.assistantLead,
      clarificationText: ap.clarification
    };
    chatState.lastDraftTurn = turnOut;
    const wrap = document.createElement("div");
    wrap.innerHTML = renderDraftCard(turnOut, { editMode: chatState.cardEditMode }).trim();
    const newNode = wrap.firstElementChild;
    if (newNode) msg.replaceWith(newNode);
    scrollMessagesToEnd();
  }

  function onOverlayDraftInput(e) {
    const t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute("data-iu-silver-field")) return;
    const card = t.closest("[data-iu-silver-draft-card]");
    if (!card) return;
    syncDraftFromCardInputs(card);
    const saveBtn = card.querySelector('[data-iu-silver-action="save"]');
    if (saveBtn) saveBtn.disabled = !isDraftSaveable(chatState.draft);
  }

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
    if (turn.confirmOnly) {
      chatState.lastDraftTurn = null;
      chatState.cardEditMode = false;
    } else if (turn.processingState !== "UNSUPPORTED") {
      chatState.cardEditMode = false;
      chatState.lastDraftTurn = { ...turn, draft: cloneDraft(turn.draft) };
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = renderDraftCard(turn, { editMode: chatState.cardEditMode }).trim();
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
    chatState.saveBusy = false;
    openChatOverlay(input);
    const first = drainPendingFirstMessage();
    if (first) {
      appendUserMessage(first);
      const eng = window.iuSilverCalendarEngine;
      const turn = eng.processUserTurn(first, chatState.draft, { now: new Date() });
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
    const turn = eng.processUserTurn(text, chatState.draft, { now: new Date() });
    chatState.draft = turn.draft;
    appendAssistantTurn(turn);
  }

  async function handleSaveClick() {
    if (chatState.saveBusy) return;
    const cardEl = getLastDraftCardEl();
    if (cardEl && cardEl.querySelector("[data-iu-silver-field]")) {
      syncDraftFromCardInputs(cardEl);
    }
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
        const dateHuman = iuSilverFormatDateCs(String(ev.date || "")) || String(ev.date || "");
        appendAssistantTurn({
          confirmOnly: true,
          processingState: "READY_TO_SAVE",
          assistantLead: "Uloženo do kalendáře: " + dateHuman + " v " + ev.time + " — " + ev.title + ".",
          clarificationText: "",
          draft: createEmptyDraft()
        });
        chatState.draft = createEmptyDraft();
        requestAnimationFrame(function () {
          closeChatOverlay();
        });
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
      chatState.cardEditMode = !chatState.cardEditMode;
      refreshLastDraftCard();
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
    if (overlay) {
      overlay.addEventListener("click", onOverlayClick);
      overlay.addEventListener("input", onOverlayDraftInput, true);
      overlay.addEventListener("change", onOverlayDraftInput, true);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
