/**
 * ČNB devizové kurzy — parser + kalendář pracovních dnů / svátků + vyhodnocení aktuálnosti.
 * Sdíleno mezi build snapshot (Node) a informačním panelem (prohlížeč).
 */
export const CNB_DAILY_RATES_URL =
  "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";

/** Tolerance po ~14:30 — nový kurz se očekává nejdříve po 16:00 lokálního času. */
export const CNB_PUBLISH_GRACE_HOUR = 16;

const CZ_MONTHS = {
  leden: 1,
  unor: 2,
  únor: 2,
  brezen: 3,
  březen: 3,
  duben: 4,
  kveten: 5,
  květen: 5,
  cerven: 6,
  červen: 6,
  cervenec: 7,
  červenec: 7,
  srpen: 8,
  zari: 9,
  září: 9,
  rijen: 10,
  říjen: 10,
  listopad: 11,
  prosinec: 12,
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function dateKey(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function atLocalNoon(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return atLocalNoon(d);
}

function czechFixedHolidayKeys(year) {
  return new Set([
    year * 10000 + 101,
    year * 10000 + 501,
    year * 10000 + 805,
    year * 10000 + 705,
    year * 10000 + 607,
    year * 10000 + 928,
    year * 10000 + 1028,
    year * 10000 + 1117,
    year * 10000 + 1224,
    year * 10000 + 1225,
    year * 10000 + 1226,
  ]);
}

function czechHolidayKeysForYear(year) {
  const keys = czechFixedHolidayKeys(year);
  const easter = easterSunday(year);
  keys.add(dateKey(addDays(easter, -2)));
  keys.add(dateKey(addDays(easter, 1)));
  return keys;
}

export function parseCzechDailyDate(period) {
  const m = String(period || "").trim().match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function isWeekendDate(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isCzechBankHoliday(date) {
  const d = atLocalNoon(date);
  const y = d.getFullYear();
  const keys = new Set([...czechHolidayKeysForYear(y - 1), ...czechHolidayKeysForYear(y), ...czechHolidayKeysForYear(y + 1)]);
  return keys.has(dateKey(d));
}

export function isCnbNonTradingDay(date) {
  return isWeekendDate(date) || isCzechBankHoliday(date);
}

export function previousCnbTradingDay(date) {
  let d = addDays(atLocalNoon(date), -1);
  while (isCnbNonTradingDay(d)) {
    d = addDays(d, -1);
  }
  return d;
}

export function getExpectedLatestCnbPublicationDate(now = new Date()) {
  const local = new Date(now.getTime());
  let cursor = atLocalNoon(local);

  if (isCnbNonTradingDay(cursor)) {
    return previousCnbTradingDay(cursor);
  }

  const afterPublishGrace =
    local.getHours() > CNB_PUBLISH_GRACE_HOUR ||
    (local.getHours() === CNB_PUBLISH_GRACE_HOUR && local.getMinutes() >= 0);

  if (!afterPublishGrace) {
    return previousCnbTradingDay(cursor);
  }

  return cursor;
}

export function isCnbPublicationBehindExpected(publicationDateStr, now = new Date()) {
  const publicationDate = parseCzechDailyDate(publicationDateStr);
  if (!publicationDate) return true;
  const expected = getExpectedLatestCnbPublicationDate(now);
  return dateKey(publicationDate) < dateKey(expected);
}

export function parseCnbRatesText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("cnb_empty");
  const headerDate = lines[0].split("#")[0].trim();
  const out = { date: headerDate, EUR: null, USD: null, listNumber: null };
  const listMatch = lines[0].match(/#\s*(\d+)/);
  if (listMatch) out.listNumber = parseInt(listMatch[1], 10);

  for (let i = 2; i < lines.length; i++) {
    const parts = lines[i].split("|");
    if (parts.length < 5) continue;
    const code = String(parts[3] || "").trim();
    const amountRaw = String(parts[2] || "1").trim().replace(",", ".");
    const rateRaw = String(parts[4] || "").trim().replace(",", ".");
    const amount = parseFloat(amountRaw);
    const rate = parseFloat(rateRaw);
    if (!Number.isFinite(rate) || !Number.isFinite(amount) || amount <= 0) continue;
    const perUnit = rate / amount;
    if (code === "EUR") out.EUR = perUnit;
    if (code === "USD") out.USD = perUnit;
  }

  if (!out.EUR || !out.USD) throw new Error("cnb_missing_codes");
  return out;
}

export function infoPanelPeriodSortKey(period) {
  const s = String(period || "").trim();
  const czWeek = s.match(/(\d{1,2})\.\s*t[yý]den\s*(\d{4})/i);
  if (czWeek) return parseInt(czWeek[2], 10) * 100 + parseInt(czWeek[1], 10);
  const czMonth = s.match(/^([a-záčďéěíňóřšťúůýž]+)\s+(\d{4})$/i);
  if (czMonth) {
    const m = CZ_MONTHS[normalizeText(czMonth[1])] || 0;
    if (m) return parseInt(czMonth[2], 10) * 100 + m;
  }
  const daily = parseCzechDailyDate(s);
  if (daily) return dateKey(daily);
  const y = s.match(/^(\d{4})$/);
  if (y) return parseInt(y[1], 10) * 100;
  return 0;
}
