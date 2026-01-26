/**
 * Update data/weather.json and data/namedays.json
 * - Weather: Open-Meteo (no API key), fixed location: Praha
 * - Nameday: svatky.adresa.info (no API key), writes today's MM-DD key only
 *
 * Runs in GitHub Actions.
 */

const fs = require("fs");
const path = require("path");

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "infoUzel.cz-bot" },
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
  const dir = path.join("data");
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
    "&timezone=Europe%2FPrague";

  const data = await fetchJson(url);

  const temp = data?.current?.temperature_2m;
  const code = data?.current?.weather_code;

  if (temp === undefined || temp === null) {
    throw new Error("Open-Meteo: missing current.temperature_2m");
  }

  const condition = weatherCodeToCz(code);

  const weather = {
    tempC: Math.round(Number(temp) * 10) / 10,
    location: "Praha",
    condition
  };

  ensureDataDir();

  // ✅ FIX: Output to filtr/data/ for web on /filtr/
  const outputDir = process.env.OUTPUT_DIR || "filtr/data";
  const outPath = path.join(outputDir, "weather.json");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(weather, null, 2) + "\n", "utf8");
  console.log("✅ Updated", outPath, weather);
}

async function updateNamedays() {
  const { key } = pragueToday();

  const url = "https://svatky.adresa.info/json";
  const data = await fetchJson(url);

  // robust field picking
  const name =
    data?.name ||
    data?.svatek ||
    data?.today ||
    data?.[0]?.name ||
    "";

  const namedays = { [key]: String(name || "").trim() };

  ensureDataDir();

  // ✅ FIX: Output to filtr/data/ for web on /filtr/
  const outputDir = process.env.OUTPUT_DIR || "filtr/data";
  const outPath = path.join(outputDir, "namedays.json");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(namedays, null, 2) + "\n", "utf8");
  console.log("✅ Updated", outPath, namedays);
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
