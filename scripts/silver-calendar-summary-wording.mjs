/**
 * Deterministic wording tests — must mirror assets/app.js getTodayCalendarSummaryState + line1 helpers.
 * Run: node scripts/silver-calendar-summary-wording.mjs
 */
function iuCalSumPad2(n) {
  return String(n).padStart(2, "0");
}
function iuDateOnlyLocal(d) {
  const x = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  return x.getFullYear() + "-" + iuCalSumPad2(x.getMonth() + 1) + "-" + iuCalSumPad2(x.getDate());
}
function iuValidYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function iuValidHm(s) {
  if (typeof s !== "string") return false;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return false;
  return true;
}
function iuNormalizeHm(s) {
  if (!iuValidHm(s)) return "";
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  return iuCalSumPad2(Number(m[1])) + ":" + m[2];
}
function iuEventStartMs(dateStr, timeStr) {
  if (!iuValidYmd(dateStr) || !iuValidHm(timeStr)) return NaN;
  const hm = iuNormalizeHm(timeStr);
  const d = new Date(dateStr + "T" + hm + ":00");
  const t = d.getTime();
  return isNaN(t) ? NaN : t;
}
function iuTomorrowMidnightLocalMs(now) {
  const x = now instanceof Date && !isNaN(now.getTime()) ? new Date(now.getTime()) : new Date();
  x.setDate(x.getDate() + 1);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function line1CalendarTodayPresent(count) {
  if (count === 0) return "Kalendář: Dnes nemáte uložený žádný záznam.";
  if (count === 1) return "Kalendář: Dnes máte uložený 1 záznam.";
  if (count >= 2 && count <= 4) return "Kalendář: Dnes máte uložené " + count + " záznamy.";
  return "Kalendář: Dnes máte uložených " + count + " záznamů.";
}
function line1CalendarTodayPast(count) {
  if (count === 1) return "Kalendář: Dnes jste měli uložený 1 záznam.";
  if (count >= 2 && count <= 4) return "Kalendář: Dnes jste měli uložené " + count + " záznamy.";
  return "Kalendář: Dnes jste měli uložených " + count + " záznamů.";
}
function getTodayCalendarSummaryState(now, items) {
  const out = {
    totalTodayCount: 0,
    nextUpcomingItem: null,
    primaryText: "",
    secondaryText: "",
    hideSecondaryLine: false,
    nextRefreshDelayMs: null,
    nextRefreshAt: null,
    sourceDatasetValid: false,
    sourceOfTruthSplit: false
  };
  const n = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const nMs = n.getTime();
  const todayStr = iuDateOnlyLocal(n);
  if (!Array.isArray(items)) {
    out.secondaryText = "Chvíli strpení.";
    out.primaryText = "Kalendář: Údaje se načítají…";
    return out;
  }
  out.sourceDatasetValid = true;
  const todayItems = [];
  for (let i = 0; i < items.length; i++) {
    const e = items[i];
    if (!e || typeof e !== "object") continue;
    if (!iuValidYmd(e.date)) continue;
    if (e.date !== todayStr) continue;
    todayItems.push(e);
  }
  out.totalTodayCount = todayItems.length;
  const timedToday = [];
  for (let j = 0; j < todayItems.length; j++) {
    const e = todayItems[j];
    if (!iuValidHm(e.time)) continue;
    const ms = iuEventStartMs(e.date, e.time);
    if (!isFinite(ms)) continue;
    timedToday.push({ e: e, ms: ms });
  }
  timedToday.sort(function (a, b) {
    return a.ms - b.ms;
  });
  let hasPast = false;
  for (let h = 0; h < timedToday.length; h++) {
    if (timedToday[h].ms < nMs) hasPast = true;
  }
  let best = null;
  let bestMs = Infinity;
  for (let j = 0; j < timedToday.length; j++) {
    const row = timedToday[j];
    if (row.ms >= nMs && row.ms < bestMs) {
      bestMs = row.ms;
      best = row.e;
    }
  }
  out.nextUpcomingItem = best;
  const allTimedPast = timedToday.length > 0 && timedToday.every(function (x) {
    return x.ms < nMs;
  });
  if (out.totalTodayCount === 0) {
    out.primaryText = line1CalendarTodayPresent(0);
    out.secondaryText = "";
    out.hideSecondaryLine = true;
  } else if (best) {
    out.primaryText = line1CalendarTodayPresent(out.totalTodayCount);
    const hm = iuNormalizeHm(best.time);
    if (!hasPast) {
      if (out.totalTodayCount === 1) {
        out.secondaryText = "Další záznam v " + hm + " hod.";
      } else {
        out.secondaryText = "První dnešní záznam v " + hm + " hod.";
      }
    } else {
      out.secondaryText = "Další záznam v " + hm + " hod.";
    }
  } else if (allTimedPast) {
    out.primaryText = line1CalendarTodayPast(out.totalTodayCount);
    out.secondaryText = "Dnešní záznamy už proběhly.";
  } else {
    out.primaryText = line1CalendarTodayPresent(out.totalTodayCount);
    out.secondaryText = "";
    out.hideSecondaryLine = true;
  }
  const midnightMs = iuTomorrowMidnightLocalMs(n);
  let minDelay = Infinity;
  for (let k = 0; k < todayItems.length; k++) {
    const e = todayItems[k];
    if (!iuValidHm(e.time)) continue;
    const ms = iuEventStartMs(e.date, e.time);
    if (!isFinite(ms)) continue;
    if (ms >= nMs) {
      const d = ms - nMs + 1;
      if (d < minDelay) minDelay = d;
    }
  }
  const toMidnight = Math.max(0, midnightMs - nMs);
  if (toMidnight < minDelay) minDelay = toMidnight;
  if (!isFinite(minDelay) || minDelay === Infinity) {
    out.nextRefreshDelayMs = null;
    out.nextRefreshAt = null;
  } else {
    const cap = 24 * 60 * 60 * 1000;
    out.nextRefreshDelayMs = Math.min(Math.max(1, minDelay), cap);
    out.nextRefreshAt = new Date(nMs + out.nextRefreshDelayMs);
  }
  return out;
}

const DAY = "2026-03-26";
const ev4 = [
  { date: DAY, time: "09:00", title: "a" },
  { date: DAY, time: "10:00", title: "b" },
  { date: DAY, time: "11:00", title: "c" },
  { date: DAY, time: "13:22", title: "d" }
];

const cases = [
  {
    id: "no_events_today",
    now: new Date(DAY + "T12:00:00"),
    items: [],
    expect: {
      primaryText: "Kalendář: Dnes nemáte uložený žádný záznam.",
      secondaryText: "",
      hideSecondaryLine: true
    }
  },
  {
    id: "first_upcoming_only",
    now: new Date(DAY + "T08:00:00"),
    items: ev4,
    expect: {
      primaryText: "Kalendář: Dnes máte uložené 4 záznamy.",
      secondaryText: "První dnešní záznam v 09:00 hod.",
      hideSecondaryLine: false
    }
  },
  {
    id: "one_passed_next_upcoming",
    now: new Date(DAY + "T09:30:00"),
    items: ev4,
    expect: {
      primaryText: "Kalendář: Dnes máte uložené 4 záznamy.",
      secondaryText: "Další záznam v 10:00 hod.",
      hideSecondaryLine: false
    }
  },
  {
    id: "all_finished",
    now: new Date(DAY + "T14:00:00"),
    items: ev4,
    expect: {
      primaryText: "Kalendář: Dnes jste měli uložené 4 záznamy.",
      secondaryText: "Dnešní záznamy už proběhly.",
      hideSecondaryLine: false
    }
  },
  {
    id: "one_event_upcoming",
    now: new Date(DAY + "T08:00:00"),
    items: [{ date: DAY, time: "09:00", title: "x" }],
    expect: {
      primaryText: "Kalendář: Dnes máte uložený 1 záznam.",
      secondaryText: "Další záznam v 09:00 hod.",
      hideSecondaryLine: false
    }
  },
  {
    id: "one_event_finished",
    now: new Date(DAY + "T10:00:00"),
    items: [{ date: DAY, time: "09:00", title: "x" }],
    expect: {
      primaryText: "Kalendář: Dnes jste měli uložený 1 záznam.",
      secondaryText: "Dnešní záznamy už proběhly.",
      hideSecondaryLine: false
    }
  },
  {
    id: "grammar_5_plus",
    now: new Date(DAY + "T08:00:00"),
    items: [
      { date: DAY, time: "09:00", title: "a" },
      { date: DAY, time: "10:00", title: "b" },
      { date: DAY, time: "11:00", title: "c" },
      { date: DAY, time: "12:00", title: "d" },
      { date: DAY, time: "13:00", title: "e" }
    ],
    expect: {
      primaryText: "Kalendář: Dnes máte uložených 5 záznamů.",
      secondaryText: "První dnešní záznam v 09:00 hod.",
      hideSecondaryLine: false
    }
  }
];

let fail = 0;
for (const c of cases) {
  const st = getTodayCalendarSummaryState(c.now, c.items);
  const ok =
    st.primaryText === c.expect.primaryText &&
    st.secondaryText === c.expect.secondaryText &&
    st.hideSecondaryLine === c.expect.hideSecondaryLine;
  if (!ok) fail++;
  console.log(
    JSON.stringify({
      id: c.id,
      pass: ok,
      actual: { primaryText: st.primaryText, secondaryText: st.secondaryText, hideSecondaryLine: st.hideSecondaryLine },
      expected: c.expect
    })
  );
}
console.log(JSON.stringify({ summary: { total: cases.length, pass: cases.length - fail, fail, exitCode: fail ? 1 : 0 } }));
process.exit(fail ? 1 : 0);
