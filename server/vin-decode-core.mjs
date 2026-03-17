/**
 * Shared VIN decode logic (Node + Cloudflare Workers).
 * No secrets in this file. Upstream key only via env at runtime.
 */

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const DEFAULT_TTL_MS = 86400000;
const DEFAULT_RATE = 27;
const UPSTREAM_TIMEOUT_MS = 12000;

export function trimVin(v) {
  return String(v || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function validateVin(vin) {
  const v = trimVin(vin);
  if (v.length !== 17) {
    return { ok: false, error: "VIN musí mít přesně 17 znaků." };
  }
  if (!VIN_RE.test(v)) {
    return {
      ok: false,
      error: "Neplatný formát VIN (povoleny alfanumerické znaky kromě I, O, Q)."
    };
  }
  return { ok: true, vin: v };
}

export function createRateLimiter(maxPerMinute) {
  const buckets = new Map();
  const windowMs = 60000;
  return function allow(ip) {
    const key = ip || "unknown";
    const now = Date.now();
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    while (arr.length && arr[0] < now - windowMs) arr.shift();
    if (arr.length >= maxPerMinute) return false;
    arr.push(now);
    return true;
  };
}

export function createMemoryCache(ttlMs) {
  const m = new Map();
  return {
    get(vin) {
      const e = m.get(vin);
      if (!e) return null;
      if (Date.now() > e.exp) {
        m.delete(vin);
        return null;
      }
      return e.data;
    },
    set(vin, data) {
      m.set(vin, { exp: Date.now() + ttlMs, data });
    }
  };
}

function cleanStr(s) {
  if (s == null) return "";
  let t = String(s).trim();
  t = t.replace(/\b(undefined|null)\b/gi, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export function normalizeVehicleRow(row) {
  if (!row || typeof row !== "object") return null;
  const make = cleanStr(row.Make || row.make);
  const model = cleanStr(row.Model || row.model);
  const year = cleanStr(row.ModelYear || row.modelYear || row.Year);
  const fuel = cleanStr(row.FuelTypePrimary || row.fuelTypePrimary || row.FuelType);
  const body = cleanStr(row.BodyClass || row.bodyClass);
  const dispL = cleanStr(row.DisplacementL || row.displacementL);
  let displacement = "";
  if (dispL && !isNaN(parseFloat(dispL))) {
    const l = parseFloat(dispL);
    if (l > 0 && l < 20) displacement = Math.round(l * 1000) + " cm³";
    else displacement = dispL;
  }
  const hp = parseFloat(row.EngineHP || row.engineHP || "0");
  let powerKw = "";
  if (hp > 0) powerKw = String(Math.round(hp * 0.745699872));
  const kwDirect = cleanStr(row.EngineKW || row.engineKW);
  if (kwDirect && !isNaN(parseFloat(kwDirect))) powerKw = String(Math.round(parseFloat(kwDirect)));
  const color = cleanStr(row.ExteriorColor || row.Color || row.exteriorColor);
  const seats = cleanStr(row.Seats || row.seats || row.SeatingCapacity);
  const stk = cleanStr(row.InspectionDate || row.stk);
  const owners = cleanStr(row.NumberOfOwners || row.owners);
  const firstReg = year ? year + "-01-01" : "";
  if (!make && !model) return null;
  return {
    make,
    model,
    vin: "",
    firstReg,
    firstRegYear: year,
    body,
    fuel,
    displacement,
    powerKw,
    color,
    seats,
    stk,
    owners
  };
}

async function fetchNhtsa(vin, signal) {
  const u = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`;
  const res = await fetch(u, {
    signal,
    headers: { Accept: "application/json" }
  });
  if (!res.ok) throw new Error("upstream_http_" + res.status);
  const j = await res.json();
  const row = j && j.Results && j.Results[0];
  return normalizeVehicleRow(row);
}

async function fetchCustomUpstream(vin, baseUrl, apiKey, signal) {
  const url = baseUrl.replace(/\{vin\}/gi, encodeURIComponent(vin));
  const headers = { Accept: "application/json" };
  if (apiKey) headers.Authorization = "Bearer " + apiKey;
  const res = await fetch(url, { signal, headers });
  if (!res.ok) throw new Error("upstream_http_" + res.status);
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error("upstream_json");
  }
  if (j && j.data && typeof j.data === "object") {
    const n = normalizeVehicleRow(j.data) || j.data;
    if (n && (n.make || n.model)) return { ...n, vin: vin };
  }
  const n2 = normalizeVehicleRow(j);
  if (n2) return { ...n2, vin: vin };
  throw new Error("upstream_empty");
}

export async function decodeVinHandler(vinRaw, clientIp, env) {
  const rateMax = parseInt(env.VIN_RATE_MAX || String(DEFAULT_RATE), 10) || DEFAULT_RATE;
  const ttl = parseInt(env.VIN_CACHE_TTL_MS || String(DEFAULT_TTL_MS), 10) || DEFAULT_TTL_MS;

  const v = validateVin(vinRaw);
  if (!v.ok) {
    return {
      status: 400,
      body: JSON.stringify({
        success: false,
        error: v.error,
        vin: trimVin(vinRaw),
        data: null,
        cached: false,
        source: null
      }),
      headers: { "Content-Type": "application/json; charset=utf-8" }
    };
  }
  const vin = v.vin;

  if (!env._rateAllow(clientIp)) {
    return {
      status: 429,
      body: JSON.stringify({
        success: false,
        error: "Příliš mnoho požadavků. Zkuste to za chvíli.",
        vin,
        data: null,
        cached: false,
        source: null
      }),
      headers: { "Content-Type": "application/json; charset=utf-8" }
    };
  }

  const cached = env._cache.get(vin);
  if (cached) {
    cached.vin = vin;
    return {
      status: 200,
      body: JSON.stringify({
        success: true,
        vin,
        data: cached,
        cached: true,
        source: cached._source || "cache"
      }),
      headers: { "Content-Type": "application/json; charset=utf-8" }
    };
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  let data;
  let source = "nhtsa";
  try {
    if (env.VIN_UPSTREAM_URL) {
      source = "upstream";
      data = await fetchCustomUpstream(vin, env.VIN_UPSTREAM_URL, env.VIN_UPSTREAM_KEY || "", ac.signal);
    } else {
      data = await fetchNhtsa(vin, ac.signal);
    }
  } catch (e) {
    clearTimeout(t);
    return {
      status: 502,
      body: JSON.stringify({
        success: false,
        error: "Služba dekódování VIN je dočasně nedostupná. Zkuste to později.",
        vin,
        data: null,
        cached: false,
        source: null
      }),
      headers: { "Content-Type": "application/json; charset=utf-8" }
    };
  }
  clearTimeout(t);

  if (!data || (!data.make && !data.model)) {
    return {
      status: 404,
      body: JSON.stringify({
        success: false,
        error: "Pro tento VIN nejsou k dispozici ověřené údaje v registru.",
        vin,
        data: null,
        cached: false,
        source: null
      }),
      headers: { "Content-Type": "application/json; charset=utf-8" }
    };
  }

  const out = { ...data, vin };
  env._cache.set(vin, { ...out });

  return {
    status: 200,
    body: JSON.stringify({
      success: true,
      vin,
      data: out,
      cached: false,
      source
    }),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=300"
    }
  };
}

export function createDecodeEnv(overrides = {}) {
  let procEnv = {};
  try {
    if (typeof process !== "undefined" && process.env) procEnv = process.env;
  } catch (e) {}
  const rateMax = parseInt(
    overrides.VIN_RATE_MAX || procEnv.VIN_RATE_MAX || String(DEFAULT_RATE),
    10
  );
  const ttl = parseInt(
    overrides.VIN_CACHE_TTL_MS || procEnv.VIN_CACHE_TTL_MS || String(DEFAULT_TTL_MS),
    10
  );
  const allow = createRateLimiter(rateMax);
  const cache = createMemoryCache(ttl);
  return {
    VIN_UPSTREAM_URL: overrides.VIN_UPSTREAM_URL || procEnv.VIN_UPSTREAM_URL || "",
    VIN_UPSTREAM_KEY: overrides.VIN_UPSTREAM_KEY || procEnv.VIN_UPSTREAM_KEY || "",
    VIN_RATE_MAX: String(rateMax),
    VIN_CACHE_TTL_MS: String(ttl),
    _rateAllow: allow,
    _cache: cache
  };
}
