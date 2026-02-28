/**
 * Update data/weather.json and data/namedays.json
 * - Weather: Open-Meteo (no API key), fixed location: Praha
 * - Nameday: offline dataset from scripts/data/namedays-cz.json (no external requests)
 *
 * Runs in GitHub Actions.
 */

const fs = require("fs");
const path = require("path");

const UA = "infoUzelBot/1.0 (+https://infouzel.cz/projects/bot/)";
const FROM = "admin@infouzel.cz";
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const robotsCache = new Map(); // host -> { ts, allow: string[], disallow: string[] }

function getOrigin(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin;
  } catch {
    return "";
  }
}

function parseRobotsTxt(txt) {
  const allow = [];
  const disallow = [];
  let inRelevant = false;
  const lines = txt.split(/\r?\n/);
  for (const line of lines) {
    const s = line.replace(/#.*/, "").trim().toLowerCase();
    if (s.startsWith("user-agent:")) {
      const val = line.slice(line.indexOf(":") + 1).trim();
      inRelevant = val === "*" || val.toLowerCase().startsWith("infouzelbot");
      continue;
    }
    if (!inRelevant) continue;
    if (s.startsWith("disallow:")) {
      const val = line.slice(line.indexOf(":") + 1).trim();
      if (val) disallow.push(val);
      continue;
    }
    if (s.startsWith("allow:")) {
      const val = line.slice(line.indexOf(":") + 1).trim();
      if (val) allow.push(val);
    }
  }
  return { allow, disallow };
}

function pathAllowed(pathStr, rules) {
  let maxAllow = -1;
  let maxDisallow = -1;
  for (const p of rules.allow) {
    if (pathStr === p || pathStr.startsWith(p.replace(/\/$/, "") + "/") || pathStr.startsWith(p)) {
      const len = p.length;
      if (len > maxAllow) maxAllow = len;
    }
  }
  for (const p of rules.disallow) {
    if (pathStr === p || pathStr.startsWith(p.replace(/\/$/, "") + "/") || pathStr.startsWith(p)) {
      const len = p.length;
      if (len > maxDisallow) maxDisallow = len;
    }
  }
  if (maxAllow > maxDisallow) return true;
  if (maxDisallow >= 0) return false;
  return true;
}

async function getRobotsRules(origin) {
  if (!origin) return { allow: ["/"], disallow: [] };
  let host = "";
  try {
    const u = new URL(origin);
    host = u.hostname.toLowerCase().replace(/^www\./, "");
    const cached = robotsCache.get(host);
    const now = Date.now();
    if (cached && (now - cached.ts) < ROBOTS_TTL_MS) return cached.rules;
  } catch {
    return { allow: ["/"], disallow: [] };
  }
  const ru = origin.replace(/\/$/, "") + "/robots.txt";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(ru, {
      headers: { "User-Agent": UA, "From": FROM },
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      robotsCache.set(host, { ts: Date.now(), rules: { allow: ["/"], disallow: [] } });
      return { allow: ["/"], disallow: [] };
    }
    const body = await res.text();
    const rules = parseRobotsTxt(body);
    robotsCache.set(host, { ts: Date.now(), rules });
    return rules;
  } catch {
    robotsCache.set(host, { ts: Date.now(), rules: { allow: ["/"], disallow: [] } });
    return { allow: ["/"], disallow: [] };
  }
}

async function canFetch(urlStr) {
  try {
    const u = new URL(urlStr);
    const origin = u.origin;
    const pathStr = u.pathname || "/";
    const rules = await getRobotsRules(origin);
    return pathAllowed(pathStr, rules);
  } catch {
    return true;
  }
}

async function fetchJson(url) {
  if (!(await canFetch(url))) return null;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "From": FROM },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

// --- Time helpers (Europe/Prague) ---
function pragueToday() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const mm = parts.find(p => p.type === "month")?.value;
  const dd = parts.find(p => p.type === "day")?.value;
  const yyyy = parts.find(p => p.type === "year")?.value;
  if (!mm || !dd || !yyyy) throw new Error("Cannot resolve Prague date parts");
  return { mm, dd, yyyy, key: `${mm}-${dd}` };
}

// --- Weather mapping (Open-Meteo weather codes) ---
function weatherCodeToCz(code) {
  const c = Number(code);
  if ([0].includes(c)) return "jasno";
  if ([1].includes(c)) return "skoro jasno";
  if ([2].includes(c)) return "polojasno";
  if ([3].includes(c)) return "oblačno";
  if ([45, 48].includes(c)) return "mlha";
  if ([51, 53, 55].includes(c)) return "mrholení";
  if ([56, 57].includes(c)) return "mrznoucí mrholení";
  if ([61, 63, 65].includes(c)) return "déšť";
  if ([66, 67].includes(c)) return "mrznoucí déšť";
  if ([71, 73, 75].includes(c)) return "sněžení";
  if ([77].includes(c)) return "sněhové krupky";
  if ([80, 81, 82].includes(c)) return "přeháňky";
  if ([85, 86].includes(c)) return "sněhové přeháňky";
  if ([95].includes(c)) return "bouřky";
  if ([96, 99].includes(c)) return "silné bouřky";
  return "oblačno";
}

function ensureDataDir() {
  const dir = path.join("projects", "data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function updateWeather() {
  // Praha
  const latitude = 50.0755;
  const longitude = 14.4378;

  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${latitude}&longitude=${longitude}` +
    "&current=temperature_2m,weather_code" +
    "&hourly=temperature_2m,weather_code" +
    "&daily=temperature_2m_max,temperature_2m_min" +
    "&timezone=Europe%2FPrague";

  const data = await fetchJson(url);
  if (data === null) {
    console.log("Weather skipped (robots disallow)");
    return;
  }

  // Current weather
  const temp = data?.current?.temperature_2m;
  const code = data?.current?.weather_code;

  if (temp === undefined || temp === null) {
    throw new Error("Open-Meteo: missing current.temperature_2m");
  }

  const currentDesc = weatherCodeToCz(code);

  // Daily forecast (today)
  const dailyMax = data?.daily?.temperature_2m_max?.[0];
  const dailyMin = data?.daily?.temperature_2m_min?.[0];

  // Hourly forecast - vezmeme nejbližších 12 hodin od teď
  const hourlyTimes = data?.hourly?.time || [];
  const hourlyTemps = data?.hourly?.temperature_2m || [];
  const hourlyCodes = data?.hourly?.weather_code || [];

  const now = new Date();
  const hours = [];

  // Projít všechny hodiny a vybrat budoucí
  for (let i = 0; i < hourlyTimes.length; i++) {
    const timeStr = hourlyTimes[i];
    if (!timeStr) continue;

    const timeDate = new Date(timeStr);
    // Přeskočit minulé hodiny
    if (timeDate < now) continue;

    const temp = hourlyTemps[i];
    const code = hourlyCodes[i];
    const desc = weatherCodeToCz(code);

    hours.push({
      time: timeStr,
      temp: temp !== undefined && temp !== null ? Math.round(Number(temp) * 10) / 10 : null,
      desc: desc || "—"
    });

    // Máme dostatek hodin (min. 12 pro Denní panel)
    if (hours.length >= 12) break;
  }

  const weather = {
    place: "Praha",
    current: {
      temp: Math.round(Number(temp) * 10) / 10,
      desc: currentDesc || "—"
    },
    today: {
      max: dailyMax !== undefined && dailyMax !== null ? Math.round(Number(dailyMax) * 10) / 10 : null,
      min: dailyMin !== undefined && dailyMin !== null ? Math.round(Number(dailyMin) * 10) / 10 : null
    },
    hours: hours
  };

  ensureDataDir();

  // ✅ FIX: Output to projects/data/ for the primary site
  const outputDir = process.env.OUTPUT_DIR || "projects/data";
  const outPath = path.join(outputDir, "weather.json");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(weather, null, 2) + "\n", "utf8");
  console.log("✅ Updated", outPath, {
    place: weather.place,
    current: weather.current,
    today: weather.today,
    hoursCount: weather.hours.length
  });
}

async function updateNamedays() {
  try {
    // Načtení offline datasetu
    const datasetPath = path.join(__dirname, "data", "namedays-cz.json");
    
    if (!fs.existsSync(datasetPath)) {
      throw new Error(`Dataset file not found: ${datasetPath}`);
    }

    const datasetContent = fs.readFileSync(datasetPath, "utf8");
    const namedays = JSON.parse(datasetContent);

    // Validace: musí být objekt s alespoň 300 položkami
    if (typeof namedays !== "object" || namedays === null || Array.isArray(namedays)) {
      throw new Error("Dataset must be an object");
    }

    const keyCount = Object.keys(namedays).length;
    if (keyCount < 300) {
      throw new Error(`Dataset has only ${keyCount} entries, expected >=300`);
    }

    ensureDataDir();

    // ✅ FIX: Output to projects/data/ for the primary site
    const outputDir = process.env.OUTPUT_DIR || "projects/data";
    const outPath = path.join(outputDir, "namedays.json");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(namedays, null, 2) + "\n", "utf8");
    console.log(`✅ Updated ${outPath} with ${keyCount} entries (offline dataset)`);
    return true;
  } catch (e) {
    console.error("[namedays] Failed to update from offline dataset:", e.message);
    throw e; // Propagujeme chybu dál
  }
}

async function main() {
  const mode = (process.argv[2] || "all").toLowerCase(); // "weather" | "namedays" | "all"

  if (mode === "weather") {
    await updateWeather();
    return;
  }
  if (mode === "namedays") {
    await updateNamedays();
    return;
  }

  await updateWeather();
  await updateNamedays();
}

main().catch((e) => {
  console.error("❌ update-weather-namedays failed:", e);
  process.exit(1);
});
