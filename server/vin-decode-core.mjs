/**
 * VIN decode — backend only. Secrets via ENV (VIN_UPSTREAM_KEY).
 * Global upstream limit ~27/min, cache, in-flight dedup, short wait queue.
 */

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const DEFAULT_TTL_MS = 86400000;
const DEFAULT_IP_RATE = 60;
const UPSTREAM_WINDOW_MS = 60000;
const UPSTREAM_MAX = 27;
const UPSTREAM_TIMEOUT_MS = 15000;
const QUEUE_MAX_WAIT_MS = 25000;
const DEFAULT_CZ_URL = "https://api.dataovozidlech.cz/api/vehicletechnicaldata/v2/{vin}";

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
      m.set(vin, { exp: Date.now() + ttlMs, data: { ...data } });
    }
  };
}

function cleanStr(s) {
  if (s == null) return "";
  let t = String(s).trim();
  if (t === "undefined" || t === "null" || t === "NaN") return "";
  t = t.replace(/\b(undefined|null)\b/gi, "");
  return t.replace(/\s+/g, " ").trim();
}

function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return cleanStr(v);
  }
  return "";
}

export function normalizeCzPayload(j, vin) {
  if (j == null) return null;
  let root = j;
  if (Array.isArray(j) && j.length) root = j[0];
  if (typeof root !== "object") return null;
  const d =
    root.data ||
    root.Data ||
    root.vehicle ||
    root.Vehicle ||
    root.result ||
    root.Result ||
    root;

  const make = pick(d, [
    "vyrobce",
    "Vyrobce",
    "znacka",
    "Znacka",
    "make",
    "Make",
    "vyrobceVozidla"
  ]);
  const model = pick(d, [
    "model",
    "Model",
    "obchodniOznaceni",
    "obchodni_oznaceni",
    "ObchodniOznaceni",
    "typ",
    "Typ"
  ]);
  const year = pick(d, [
    "rokVyroby",
    "rok_vyroby",
    "RokVyroby",
    "modelYear",
    "ModelYear",
    "rokPrvniRegistrace",
    "rok_prvni_registrace"
  ]);
  const fuel = pick(d, ["palivo", "Palivo", "fuelType", "FuelTypePrimary"]);
  const body = pick(d, ["karoserie", "Karoserie", "bodyClass", "BodyClass"]);
  const disp = pick(d, [
    "objemMotoru",
    "objem_motoru",
    "ObjemMotoru",
    "zdvihovyObjem",
    "displacement"
  ]);
  let displacement = "";
  if (disp) {
    const n = parseInt(String(disp).replace(/\D/g, ""), 10);
    if (n > 100 && n < 20000) displacement = n + " cm³";
    else displacement = cleanStr(disp);
  }
  const kw = pick(d, ["vykon", "Vykon", "vykonMotoru", "powerKw", "EngineKW"]);
  const powerKw = kw && !isNaN(parseFloat(kw)) ? String(Math.round(parseFloat(kw))) : "";
  const color = pick(d, ["barva", "Barva", "exteriorColor"]);
  const seats = pick(d, ["pocetMist", "PocetMist", "seats"]);
  const stk = pick(d, ["platnostSTK", "stkDo", "stk"]);
  const owners = pick(d, ["pocetVlastniku", "PocetVlastniku"]);

  const firstRegYear = year.replace(/\D/g, "").slice(0, 4) || "";
  const firstReg = firstRegYear ? firstRegYear + "-01-01" : "";

  if (!make && !model) return null;
  return {
    make,
    model,
    vin,
    firstReg,
    firstRegYear,
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

function createUpstreamGate(maxPerWindow, windowMs) {
  const log = [];
  let tail = Promise.resolve();
  return {
    acquire() {
      const run = tail.then(async () => {
        const deadline = Date.now() + QUEUE_MAX_WAIT_MS;
        while (Date.now() < deadline) {
          const now = Date.now();
          while (log.length && log[0] < now - windowMs) log.shift();
          if (log.length < maxPerWindow) {
            log.push(Date.now());
            return;
          }
          const wait = log[0] + windowMs - Date.now() + 10;
          await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(50, wait))));
        }
        throw new Error("queue_timeout");
      });
      tail = run.catch(() => {});
      return run;
    }
  };
}

async function fetchCzUpstream(vin, env, signal) {
  const key = (env.VIN_UPSTREAM_KEY || "").trim();
  if (!key) throw new Error("no_api_key");

  let url = (env.VIN_UPSTREAM_URL || DEFAULT_CZ_URL).trim();
  url = url.includes("{vin}")
    ? url.split("{vin}").join(encodeURIComponent(vin))
    : url + (url.includes("?") ? "&" : "?") + "vin=" + encodeURIComponent(vin);

  const authStyle = (env.VIN_UPSTREAM_AUTH_STYLE || "bearer").toLowerCase();
  const headers = { Accept: "application/json" };
  if (authStyle === "x-api-key" || authStyle === "xapikey") {
    headers["X-API-Key"] = key;
  } else if (authStyle === "apikey-query") {
    url += (url.includes("?") ? "&" : "?") + "apiKey=" + encodeURIComponent(key);
  } else {
    headers.Authorization = "Bearer " + key;
  }

  let res;
  let text;
  const upstreamHost = (() => {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "";
    }
  })();
  try {
    res = await fetch(url, { method: "GET", headers, signal });
    text = await res.text();
  } catch (e) {
    const detail =
      e && e.name === "AbortError"
        ? "upstream_timeout"
        : String(e && e.message ? e.message : e);
    const err = new Error("upstream_network");
    err.upstreamDetail = detail;
    err.upstreamHost = upstreamHost;
    throw err;
  }

  if (/maximální\s+počet\s+požadavků|maximalni\s+pocet\s+ pozadavku/i.test(text)) {
    throw new Error("upstream_rate_text");
  }

  if (!res.ok) {
    if (res.status === 429) throw new Error("upstream_429");
    const err = new Error("upstream_http_" + res.status);
    err.upstreamHost = upstreamHost;
    err.upstreamDetail = text.length > 300 ? text.slice(0, 300) + "…" : text;
    throw err;
  }

  let j = null;
  try {
    j = JSON.parse(text);
  } catch (e) {
    if (text.length < 400 && /chyba|error|limit/i.test(text)) {
      throw new Error("upstream_plain_error");
    }
    throw new Error("upstream_json");
  }

  const norm = normalizeCzPayload(j, vin);
  if (!norm) throw new Error("upstream_empty");
  return norm;
}

export async function decodeVinHandler(vinRaw, clientIp, env) {
  const ipMax = parseInt(env.VIN_IP_RATE_MAX || String(DEFAULT_IP_RATE), 10) || DEFAULT_IP_RATE;
  const ttl = parseInt(env.VIN_CACHE_TTL_MS || String(DEFAULT_TTL_MS), 10) || DEFAULT_TTL_MS;
  const upMax = parseInt(env.VIN_UPSTREAM_MAX_PER_MIN || String(UPSTREAM_MAX), 10) || UPSTREAM_MAX;

  const v = validateVin(vinRaw);
  if (!v.ok) {
    return jsonRes(400, {
      success: false,
      error: v.error,
      vin: trimVin(vinRaw),
      data: null,
      cached: false,
      source: null
    });
  }
  const vin = v.vin;

  if (!env._rateAllow(clientIp)) {
    return jsonRes(429, {
      success: false,
      error: "Příliš mnoho požadavků z této adresy. Zkuste to za chvíli.",
      vin,
      data: null,
      cached: false,
      source: null
    });
  }

  const cached = env._cache.get(vin);
  if (cached) {
    return jsonRes(200, {
      success: true,
      vin,
      data: { ...cached, vin },
      cached: true,
      source: "cache"
    });
  }

  if (env._inflight.has(vin)) {
    try {
      const data = await env._inflight.get(vin);
      return jsonRes(200, {
        success: true,
        vin,
        data: { ...data, vin },
        cached: false,
        source: "inflight-shared"
      });
    } catch (e) {
      return jsonRes(502, {
        success: false,
        error: "Požadavek se nepodařilo dokončit. Zkuste to znovu.",
        vin,
        data: null,
        cached: false,
        source: null
      });
    }
  }

  const keyOk = !!(env.VIN_UPSTREAM_KEY || "").trim();
  const allowNhtsa = (env.VIN_USE_NHTSA_FALLBACK || "").trim() === "1";

  if (!keyOk && !allowNhtsa) {
    return jsonRes(503, {
      success: false,
      error:
        "Služba dekódování VIN není na serveru nakonfigurována. Kontaktujte administrátora.",
      vin,
      data: null,
      cached: false,
      source: null
    });
  }

  const p = (async () => {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      if (keyOk) {
        await env._upstreamGate.acquire();
        try {
          return await fetchCzUpstream(vin, env, ac.signal);
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          if (msg === "upstream_rate_text" || msg === "upstream_429") {
            throw new Error("RATE");
          }
          if (msg === "queue_timeout") throw new Error("QUEUE");
          throw e;
        }
      }
      const u = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`;
      const res = await fetch(u, { signal: ac.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("nhtsa_http");
      const j = await res.json();
      const row = j && j.Results && j.Results[0];
      const n = normalizeNhtsaRow(row, vin);
      if (!n) throw new Error("empty");
      return n;
    } finally {
      clearTimeout(to);
    }
  })();

  env._inflight.set(vin, p);
  let data;
  try {
    data = await p;
  } catch (e) {
    env._inflight.delete(vin);
    const msg = String(e && e.message ? e.message : e);
    if (msg === "RATE") {
      return jsonRes(429, {
        success: false,
        error: "Byl dosažen limit dotazů. Zkuste to prosím později.",
        vin,
        data: null,
        cached: false,
        source: null
      });
    }
    if (msg === "QUEUE") {
      return jsonRes(503, {
        success: false,
        error: "Služba je vytížena. Zkuste to za okamžik.",
        vin,
        data: null,
        cached: false,
        source: null
      });
    }
    if (msg === "upstream_network") {
      return jsonRes(502, {
        success: false,
        error: "upstream_fetch_failed",
        detail: e.upstreamDetail || msg,
        upstreamHost: e.upstreamHost || "",
        vin,
        data: null,
        cached: false,
        source: null
      });
    }
    if (/^upstream_http_\d+$/.test(msg)) {
      const httpStatus = parseInt(msg.replace("upstream_http_", ""), 10);
      return jsonRes(502, {
        success: false,
        error: "upstream_http_error",
        httpStatus,
        detail: e.upstreamDetail || "",
        upstreamHost: e.upstreamHost || "",
        vin,
        data: null,
        cached: false,
        source: null
      });
    }
    return jsonRes(502, {
      success: false,
      error: "Údaje z registru se nepodařilo načíst. Zkuste to později.",
      vin,
      data: null,
      cached: false,
      source: null
    });
  }
  env._inflight.delete(vin);

  if (!data || (!data.make && !data.model)) {
    return jsonRes(404, {
      success: false,
      error: "Pro tento VIN nejsou k dispozici ověřené údaje.",
      vin,
      data: null,
      cached: false,
      source: null
    });
  }

  const out = { ...data, vin };
  env._cache.set(vin, out);

  return jsonRes(200, {
    success: true,
    vin,
    data: out,
    cached: false,
    source: keyOk ? "dataovozidlech" : "nhtsa"
  });
}

function normalizeNhtsaRow(row, vin) {
  if (!row || typeof row !== "object") return null;
  const make = cleanStr(row.Make);
  const model = cleanStr(row.Model);
  const year = cleanStr(row.ModelYear);
  if (!make && !model) return null;
  const hp = parseFloat(row.EngineHP || "0");
  const powerKw = hp > 0 ? String(Math.round(hp * 0.745699872)) : "";
  const dispL = parseFloat(row.DisplacementL || "0");
  const displacement =
    dispL > 0 && dispL < 20 ? Math.round(dispL * 1000) + " cm³" : "";
  return {
    make,
    model,
    vin,
    firstReg: year ? year + "-01-01" : "",
    firstRegYear: year,
    body: cleanStr(row.BodyClass),
    fuel: cleanStr(row.FuelTypePrimary),
    displacement,
    powerKw,
    color: "",
    seats: "",
    stk: "",
    owners: ""
  };
}

function jsonRes(status, obj) {
  return {
    status,
    body: JSON.stringify(obj),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(status === 200 ? { "Cache-Control": "private, max-age=120" } : {})
    }
  };
}

export function createDecodeEnv(overrides = {}) {
  let procEnv = {};
  try {
    if (typeof process !== "undefined" && process.env) procEnv = process.env;
  } catch (e) {}

  const g = (k, d) => String(overrides[k] != null ? overrides[k] : procEnv[k] || d);

  const ipMax = parseInt(g("VIN_IP_RATE_MAX", String(DEFAULT_IP_RATE)), 10) || DEFAULT_IP_RATE;
  const ttl = parseInt(g("VIN_CACHE_TTL_MS", String(DEFAULT_TTL_MS)), 10) || DEFAULT_TTL_MS;
  const upMax = parseInt(g("VIN_UPSTREAM_MAX_PER_MIN", String(UPSTREAM_MAX)), 10) || UPSTREAM_MAX;

  return {
    VIN_UPSTREAM_URL: g("VIN_UPSTREAM_URL", ""),
    VIN_UPSTREAM_KEY: g("VIN_UPSTREAM_KEY", ""),
    VIN_UPSTREAM_AUTH_STYLE: g("VIN_UPSTREAM_AUTH_STYLE", "bearer"),
    VIN_USE_NHTSA_FALLBACK: g("VIN_USE_NHTSA_FALLBACK", ""),
    VIN_IP_RATE_MAX: String(ipMax),
    VIN_CACHE_TTL_MS: String(ttl),
    _rateAllow: createRateLimiter(ipMax),
    _cache: createMemoryCache(ttl),
    _upstreamGate: createUpstreamGate(upMax, UPSTREAM_WINDOW_MS),
    _inflight: new Map()
  };
}
