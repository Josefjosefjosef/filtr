/* sw.js – Service Worker pro infoUzel.cz
   Strategie: Network First + Cache Fallback pro JSON data s TTL
   App Shell: Cache First
   Poznámka: Kill switch ?nosw=1 je řešen v registraci na stránce (app-crash-shield.js), ne zde
*/

// Verze cache (měnit při každé významné změně)
// 2026-03-22: bust app shell po gap-align CSS (PR #1362) — klienti se starým SW mohli držet zastaralé /assets cache
// 2026-03-22: bump — app.js silent SW activation (SKIP_WAITING + jeden reload, bez spodního CTA)
// 2026-03-22: HTML document = network-first (žádný preferovaný starý shell)
// 2026-03-29: PR #1488 — nový SW + vyprázdnění APP_SHELL_CACHE po deployi (staré app.*.css v cache)
// 2026-06-10: mobile/tablet stability v1 — bottom-nav clearance, app-render-optimizer.js odstraněn z precache
// 2026-06-11: P1 perf fix #7 — IU_SW_DEPLOY_RELOAD se NEposílá při první instalaci SW (cold load se načítal 2×)
// 2026-06-28: PWA brand blue iU icons — bump app shell cache for new favicon/manifest references
// 2026-06-29: PWA icon final tuning v54 — larger optically centered iU + infoUzel.cz short_name
// 2026-07-14: PWA offline completion — reconnect refresh, sync external opens
// 2026-07-16: PWA offline menu/articles/images — durable last-good feed+img caches, tool modules precache
// 2026-07-20: Prehled dne settings/timeline — network-first for info-system modules (SWR + stripped ?v=
//             kept stale iu-prehled-dne-ui after #7622 for installed PWAs)
// 2026-07-21: Cross-origin passthrough (analytics Worker ingest) — SW must not re-fetch with a different UA
// 2026-07-27: Offline nav fallback — never bare 503 for navigations; durable offline.html + last-good public HTML
// 2026-07-29: Media sources removed — bust app/data caches + durable feed last-good so old media JSON cannot return offline
// 2026-07-30: Prehled dne banner + HomeCard FOUC fix — bust shell so cutover-first HTML/CSS reach clients
// 2026-08-01: Homecard CTA flush — banner + settings button zero seam (hero wrapper)
// 2026-08-01: Homecard CTA square top + hero block layout (no nested-flex collapse)
// 2026-08-03: Silver date/time fit v2 — bust shell so premium-draft + app CSS reach PWAs (SWR pathname key)
const CACHE_VERSION = "2026-08-12-date-time-right-edge-v3";
const APP_SHELL_CACHE = `iu-app-${CACHE_VERSION}`;
const DATA_CACHE = `iu-data-${CACHE_VERSION}`;
const DATA_META_CACHE = `iu-data-meta-${CACHE_VERSION}`; // Metadata for TTL
/** Durable across SW version bumps — last-good feed chunks/manifest for offline UI (v2 after media wipe). */
const FEED_OFFLINE_CACHE = "iu-feed-offline-v2";
/** Durable same-origin image cache (defaults + previously loaded /assets/images/*). */
const IMG_OFFLINE_CACHE = "iu-img-offline-v1";
const IMG_OFFLINE_MAX_ENTRIES = 120;
/** Durable approved offline HTML document (survives activate shell wipe). */
const OFFLINE_DOC_CACHE = "iu-offline-doc-v1";
/** Durable last-good public app HTML for offline navigation (never admin/auth). */
const HTML_LAST_GOOD_CACHE = "iu-html-last-good-v1";

// TTL pro JSON data (v sekundách)
const TTL = {
  articles: 300,
  videos: 600,
  weather: 1800,
  namedays: 86400,
  meta: 600,
  status: 300,
};

// Maximální stáří cache pro fallback (ms): čerstvost podle generatedAt
const MAX_STALE_MS = {
  articles: 10 * 60 * 1000,
  videos: 10 * 60 * 1000,
  probe: 10 * 60 * 1000,
  info_panel: 7 * 24 * 60 * 60 * 1000,
  meta: 30 * 60 * 1000,
};
const DATA_FETCH_TIMEOUT_MS = 5500;

function getDataRequestType(pathname) {
  if (pathname.includes("publishable_pool.json")) return "articles";
  if (pathname.includes("articles.json")) return "articles";
  if (pathname.includes("videos.json")) return "videos";
  if (pathname.includes("info_panel_snapshot.json")) return "info_panel";
  if (pathname.endsWith("probe.txt")) return "probe";
  return "meta";
}

// ✅ FIX: App Shell soubory (Cache First) - relativní vůči BASE
// BASE bude definován později, takže použijeme funkci
function getAppShellUrls() {
  return [
    // P0: BASE / index.html — nepre-cacheovat (document = network-first; starý shell by přežíval)
    // CSS/JS musí být updatovatelný i se stabilním ?v=... (viz fetch handler níž)
    `${BASE}assets/app.css`,
    `${BASE}assets/iu-financial-overlay.css`,
    `${BASE}assets/iu-legal-documents-overlay.css`,
    `${BASE}assets/iu-legal-documents-mobile-template-v1.css`,
    `${BASE}assets/iu-invoice-overlay.css`,
    `${BASE}assets/iu-custom-buttons-overlay.css`,
    `${BASE}assets/app-crash-shield.js`,
    `${BASE}assets/iu-network-connectivity-v1.js`,
    `${BASE}assets/app.js`,
    `${BASE}sw.js`
  ];
}

/** Offline tool modules + default section images — warmed after activate (not in install addAll). */
function getOfflineWarmUrls() {
  return [
    `${BASE}assets/iu-financial-calculators-module.js`,
    `${BASE}assets/iu-financial-calculators-engine.js`,
    `${BASE}assets/iu-financial-calculators-cta.js`,
    `${BASE}assets/iu-invoice-module.js`,
    `${BASE}assets/iu-invoice-engine.js`,
    `${BASE}assets/iu-invoice-pdf-renderer.js`,
    `${BASE}assets/iu-invoice-raster-renderer.js`,
    `${BASE}assets/iu-brand-colors.js`,
    `${BASE}assets/iu-local-data-protection.js`,
    `${BASE}assets/iu-tool-guard.js`,
    `${BASE}assets/iu-legal-documents-module.js`,
    `${BASE}assets/iu-silver-p0-engine.js`,
    `${BASE}assets/iu-pdf-convert-module.js`,
    `${BASE}assets/iu-invoice-pdf-legacy-export.js`,
    `${BASE}assets/images/news-default.jpg`,
    `${BASE}assets/images/sport-default.jpg`,
    `${BASE}assets/images/finance-default.jpg`,
    `${BASE}assets/images/culture-default.jpg`,
    `${BASE}assets/images/kultura-default.jpg`,
    `${BASE}assets/images/zdravi-default.jpg`,
    `${BASE}assets/images/cestovani-default.jpg`,
    `${BASE}assets/images/hry-default.jpg`,
    `${BASE}assets/images/veda-default.jpg`,
    `${BASE}assets/images/vzdelavani-default.jpg`,
    `${BASE}assets/images/section-zpravy.jpg`,
    `${BASE}assets/images/section-sport.jpg`,
    `${BASE}assets/images/section-finance.jpg`,
    `${BASE}assets/images/section-zdravi.jpg`,
    `${BASE}assets/images/section-kultura-akce.jpg`,
    `${BASE}assets/images/section-cestovani.jpg`,
    `${BASE}assets/images/section-hry.jpg`,
    `${BASE}assets/images/section-veda-historie.jpg`,
    `${BASE}assets/images/section-vzdelavani.jpg`,
  ];
}

async function warmOfflineAssets() {
  try {
    const shell = await caches.open(APP_SHELL_CACHE);
    const img = await caches.open(IMG_OFFLINE_CACHE);
    try {
      const offlineRes = await fetch(offlineDocumentUrl(), { cache: "no-store" });
      if (offlineRes && offlineRes.ok) await putOfflineDocument(offlineRes);
    } catch (_) {}
    const warmOne = async (raw) => {
      const url = normalizeUrl(raw);
      try {
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 4000) : null;
        const res = await fetch(url, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
        if (timer) clearTimeout(timer);
        if (!res || !res.ok) return;
        if (String(url).includes("/assets/images/")) {
          await img.put(new Request(url), res.clone());
        }
        await shell.put(new Request(url), res.clone());
      } catch (_) {}
    };
    /* Cap concurrency so background warm cannot saturate the worker. */
    const urls = getOfflineWarmUrls();
    for (let i = 0; i < urls.length; i += 4) {
      await Promise.all(urls.slice(i, i + 4).map(warmOne));
    }
  } catch (_) {}
}

// ✅ FIX: BASE je path-only ("/" nebo "/filtr/"), vždy s trailing slash
function getBaseRoot() {
  // Pro github.io projektové stránky: BASE = "/filtr/"
  if (self.location.hostname.endsWith("github.io")) {
    return "/filtr/";
  }
  // Jinak detekuj z pathname
  let p = self.location.pathname;
  if (p.includes("/filtr/")) {
    return "/filtr/";
  }
  if (p.endsWith("sw.js")) {
    p = p.slice(0, -5); // odstranit "sw.js"
  }
  if (!p.endsWith("/")) p += "/";
  return p;
}

const BASE = getBaseRoot();

// Normalizace URL pro BASE
function normalizeUrl(url) {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("/")) {
    return new URL(url, self.location.origin).toString();
  }
  return new URL(url, BASE).toString();
}

// TTL kontrola
function isCacheValid(meta) {
  if (!meta || !meta.timestamp) return false;
  const age = Date.now() - meta.timestamp;
  return age < (TTL[meta.type] || 300) * 1000;
}

function isoNow() {
  return new Date().toISOString();
}

function getSeedArticles() {
  const generatedAt = isoNow();
  const items = [
    { title: "Info", link: "#", pubDate: generatedAt, source: "infoUzel" },
    { title: "Novinky", link: "#", pubDate: generatedAt, source: "infoUzel" },
    { title: "Přehled", link: "#", pubDate: generatedAt, source: "infoUzel" },
  ];
  return JSON.stringify({ generatedAt, items });
}

function getSeedVideos() {
  const generatedAt = isoNow();
  const vid = "dQw4w9WgXcQ";
  const videos = [
    { title: "Video", url: "https://www.youtube.com/watch?v=" + vid, publishedAt: generatedAt, videoId: vid, thumb: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg" },
    { title: "Přehled", url: "https://www.youtube.com/watch?v=" + vid, publishedAt: generatedAt, videoId: vid, thumb: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg" },
    { title: "Info", url: "https://www.youtube.com/watch?v=" + vid, publishedAt: generatedAt, videoId: vid, thumb: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg" },
  ];
  return JSON.stringify({ generatedAt, videos });
}

function seedResponse(pathname) {
  const isArticles = pathname.includes("articles.json") || pathname.includes("publishable_pool.json");
  const body = isArticles ? getSeedArticles() : getSeedVideos();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Feed-critical files: no SW body read / cache.put on live Response (avoids
 * "Response body is already used", invalid Response, FetchEvent reject).
 * Network-only pass-through; seed JSON only if network fails completely.
 */
function isProjectsFeedDataPath(pathname) {
  if (!pathname.startsWith("/projects/data/")) return false;
  const name = pathname.slice("/projects/data/".length);
  if (name === "articles.json" || name === "publishable_pool.json" || name === "videos.json" || name === "_probe.txt") {
    return true;
  }
  if (name.startsWith("article_feed_chunks/") && name.endsWith(".json")) return true;
  if (name === "articles/bootstrap.json") return true;
  if (name.startsWith("articles/") && name.endsWith(".json")) return true;
  // CHMI / info events: network-only (never SW meta TTL cache of stale feed).
  if (name === "info_events/feed.json" || name === "info_events/monitoring.json") return true;
  if (name.startsWith("info_events/lanes/") && name.endsWith(".json")) return true;
  if (name.startsWith("info_events/") && name.endsWith(".json")) return true;
  return false;
}

/** PWA deploy probe — always network, never SW cache (home-screen stale shell recovery). */
function isProjectsVersionProbePath(pathname) {
  return pathname === "/projects/version.json";
}

/** App hub HTML — network-first for all GET (iOS/Android home-screen may skip navigate mode). */
function isProjectsHtmlPath(pathname) {
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/filtr/" ||
    pathname === "/filtr" ||
    pathname === "/filtr/index.html" ||
    pathname === "/projects/" ||
    pathname === "/projects" ||
    pathname === "/projects/index.html" ||
    pathname === "/filtr/projects/" ||
    pathname === "/filtr/projects" ||
    pathname === "/filtr/projects/index.html"
  );
}

function offlineDocumentUrl() {
  return normalizeUrl(`${BASE}offline.html`);
}

/** Never cache admin/auth/private HTML shells. */
function isUnsafeHtmlCachePath(pathname) {
  const p = String(pathname || "").toLowerCase();
  if (p.includes("/admin")) return true;
  if (p.includes("/statistiky/admin")) return true;
  if (p.includes("/client")) return true;
  if (p.includes("/login")) return true;
  if (p.includes("/auth")) return true;
  return false;
}

function isPublicLastGoodHtmlPath(pathname) {
  if (isUnsafeHtmlCachePath(pathname)) return false;
  /* Only real app shells — never legacy /projects redirect stubs (offline loop risk). */
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/filtr/" ||
    pathname === "/filtr" ||
    pathname === "/filtr/index.html" ||
    pathname === "/offline.html" ||
    pathname === "/filtr/offline.html"
  );
}

function responseHasSetCookie(response) {
  try {
    if (typeof response.headers.getSetCookie === "function") {
      const list = response.headers.getSetCookie();
      if (Array.isArray(list) && list.length) return true;
    }
  } catch (_) {}
  try {
    return !!response.headers.get("Set-Cookie");
  } catch (_) {
    return false;
  }
}

async function putOfflineDocument(response) {
  try {
    if (!response || !response.ok) return;
    const ct = String(response.headers.get("content-type") || "");
    if (ct && !ct.includes("text/html")) return;
    const cache = await caches.open(OFFLINE_DOC_CACHE);
    await cache.put(offlineDocumentUrl(), response.clone());
  } catch (_) {}
}

async function matchOfflineDocument() {
  try {
    const cache = await caches.open(OFFLINE_DOC_CACHE);
    const key = offlineDocumentUrl();
    return (await cache.match(key)) || (await cache.match(new Request(key))) || null;
  } catch (_) {
    return null;
  }
}

async function putLastGoodPublicHtml(request, response) {
  try {
    if (!response || response.status !== 200) return;
    if (responseHasSetCookie(response)) return;
    const u = new URL(request.url);
    if (!isPublicLastGoodHtmlPath(u.pathname)) return;
    const ct = String(response.headers.get("content-type") || "");
    if (ct && !ct.includes("text/html")) return;
    const cache = await caches.open(HTML_LAST_GOOD_CACHE);
    await cache.put(new Request(u.origin + u.pathname), response.clone());
  } catch (_) {}
}

async function matchLastGoodPublicHtml(request) {
  try {
    const u = new URL(request.url);
    const cache = await caches.open(HTML_LAST_GOOD_CACHE);
    const exact = await cache.match(new Request(u.origin + u.pathname));
    if (exact) return exact;
    const root = await cache.match(new Request(u.origin + "/"));
    if (root) return root;
    return (await cache.match(new Request(u.origin + "/index.html"))) || null;
  } catch (_) {
    return null;
  }
}

function syntheticOfflineHtmlResponse() {
  const html =
    "<!doctype html><html lang=\"cs\"><head><meta charset=\"utf-8\"/>" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>" +
    "<title>Offline — infoUzel.cz</title>" +
    "<style>body{margin:0;font-family:system-ui,sans-serif;background:#e5eef6;color:#0f172a}" +
    "main{max-width:28rem;margin:0 auto;padding:2rem 1.25rem}.card{background:#fff;border:1px solid #dbe4ee;" +
    "border-radius:16px;padding:1.25rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#64748b;line-height:1.5}" +
    "button{border:0;border-radius:10px;background:#0369a1;color:#fff;padding:.7rem 1rem;font:inherit}</style>" +
    "</head><body><main><div class=\"card\"><strong style=\"color:#0369a1\">infoUzel.cz</strong>" +
    "<h1>Jste offline</h1><p>Internet není dostupný. Aktuální online data teď nejsou k dispozici.</p>" +
    "<button type=\"button\" id=\"r\">Zkusit znovu</button></div></main>" +
    "<script>(function(){var b=document.getElementById(\"r\");" +
    "function go(){try{location.reload()}catch(e){}}" +
    "if(b)b.addEventListener(\"click\",go);window.addEventListener(\"online\",go);})();</script>" +
    "</body></html>";
  return new Response(html, {
    status: 200,
    statusText: "OK",
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-IU-Offline-Fallback": "synthetic",
    },
  });
}

/**
 * Navigation offline order: exact cache → last-good public HTML → offline.html → synthetic 200.
 * Never return an unmanaged empty 503 when SW can serve a fallback document.
 */
async function offlineNavigationFallback(request) {
  try {
    const exact = await caches.match(request);
    if (exact) return exact;
  } catch (_) {}
  try {
    const lastGood = await matchLastGoodPublicHtml(request);
    if (lastGood) return lastGood;
  } catch (_) {}
  try {
    const offlineDoc = await matchOfflineDocument();
    if (offlineDoc) {
      const headers = new Headers(offlineDoc.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("X-IU-Offline-Fallback", "offline.html");
      return new Response(offlineDoc.body, {
        status: 200,
        statusText: "OK",
        headers,
      });
    }
  } catch (_) {}
  return syntheticOfflineHtmlResponse();
}

async function networkFirstNoStore(request, offlineFallback) {
  try {
    const res = await fetch(request, { cache: "no-store" });
    if (res && res.ok) {
      const hdrs = new Headers(res.headers);
      hdrs.set("Cache-Control", "no-cache, no-store, must-revalidate");
      hdrs.set("Pragma", "no-cache");
      const out = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: hdrs,
      });
      try {
        putLastGoodPublicHtml(request, out.clone());
      } catch (_) {}
      return out;
    }
  } catch (_) {}
  if (offlineFallback) {
    return offlineNavigationFallback(request);
  }
  return new Response("", {
    status: 503,
    statusText: "Offline",
    headers: { "Cache-Control": "no-store" },
  });
}

function feedOfflineCacheKey(request) {
  try {
    const u = new URL(request.url);
    return new Request(u.origin + u.pathname);
  } catch (_) {
    return request;
  }
}

async function putFeedOfflineLastGood(request, response) {
  try {
    if (!response || !response.ok) return;
    const ct = String(response.headers.get("content-type") || "");
    if (ct && !/json|javascript|text\/plain/i.test(ct) && !request.url.endsWith(".json")) return;
    const cache = await caches.open(FEED_OFFLINE_CACHE);
    await cache.put(feedOfflineCacheKey(request), response.clone());
  } catch (_) {}
}

async function matchFeedOfflineLastGood(request) {
  try {
    const cache = await caches.open(FEED_OFFLINE_CACHE);
    return (await cache.match(feedOfflineCacheKey(request))) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Online: network-first (no-store) — never serve stale as fresh when network works.
 * Offline: last-good JSON from FEED_OFFLINE_CACHE; then DATA_CACHE; then seed.
 */
async function handleProjectsFeedDataPassthrough(event, pathname) {
  const doFetch = () => fetch(event.request, { cache: "no-store" });

  try {
    const r = await doFetch();
    if (r.ok) {
      event.waitUntil(putFeedOfflineLastGood(event.request, r));
      return r;
    }
  } catch (_) {}
  try {
    const r = await doFetch();
    if (r.ok) {
      event.waitUntil(putFeedOfflineLastGood(event.request, r));
      return r;
    }
  } catch (_) {}

  const lastGood = await matchFeedOfflineLastGood(event.request);
  if (lastGood) return lastGood;

  try {
    const cached = await caches.match(event.request);
    if (cached) {
      const ct = cached.headers.get("content-type") || "";
      if (!pathname.endsWith(".json") || ct.includes("application/json") || ct.includes("text/plain")) {
        return cached;
      }
    }
  } catch (_) {}

  if (pathname.endsWith("articles.json") || pathname.endsWith("publishable_pool.json")) return seedResponse(pathname);
  if (pathname.endsWith("videos.json")) return seedResponse(pathname);
  if (pathname.includes("/info_events/") && pathname.endsWith(".json")) {
    return new Response(JSON.stringify({ error: "OFFLINE_NO_LAST_GOOD_FEED", items: [] }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-IU-Offline": "1",
      },
    });
  }
  return new Response("stale\n", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function handleDataRequest(event) {
  const url = new URL(event.request.url);
  const pathname = url.pathname;
  const type = getDataRequestType(pathname);
  const isJson = pathname.endsWith(".json");

  const send503 = () =>
    new Response(JSON.stringify({ error: "NETWORK_FAILED_NO_FRESH_CACHE" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DATA_FETCH_TIMEOUT_MS);
    const networkResponse = await fetch(event.request, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    if (!networkResponse.ok) throw new Error("Network not ok");

    const contentType = networkResponse.headers.get("content-type") || "";
    if (isJson && !contentType.includes("application/json")) throw new Error("Not JSON");

    const text = await networkResponse.text();
    const hdrs = new Headers(networkResponse.headers);
    hdrs.delete("content-length");
    const replay = () =>
      new Response(text, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers: hdrs,
      });

    if (isJson) {
      if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) throw new Error("Not JSON body");
      let generatedAt = null;
      try {
        const obj = JSON.parse(text);
        generatedAt = obj && (obj.generatedAt || obj.generated_at);
      } catch (_) {}
      const cache = await caches.open(DATA_CACHE);
      const bodyForClient = replay();
      await cache.put(event.request, bodyForClient.clone());
      const metaCache = await caches.open(DATA_META_CACHE);
      const metaReq = new Request(event.request.url + ".meta");
      await metaCache.put(
        metaReq,
        new Response(
          JSON.stringify({
            timestamp: Date.now(),
            type,
            generatedAt: generatedAt || null,
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      );
      return bodyForClient;
    }

    return replay();
  } catch (_) {
    const cached = await caches.match(event.request);
    if (!cached) return send503();

    const ct = cached.headers.get("content-type") || "";
    if (isJson) {
      if (!ct.includes("application/json")) return send503();
      let text;
      try {
        text = await cached.clone().text();
      } catch (_) {
        return send503();
      }
      if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) return send503();
      let obj;
      try {
        obj = JSON.parse(text);
      } catch (_) {
        return send503();
      }
      const generatedAt = obj && (obj.generatedAt || obj.generated_at);
      if (!generatedAt) return send503();
      const age = Date.now() - Date.parse(generatedAt);
      const maxStale = MAX_STALE_MS[type] ?? MAX_STALE_MS.meta;
      if (age > maxStale) return send503();
      return cached;
    }

    return send503();
  }
}

/* P1 perf fix #7: rozlišení FIRST INSTALL vs UPDATE.
   Při install nového SW je registration.active starý SW (= update / deploy);
   při úplně první instalaci je null. Flag přežije do activate (skipWaiting
   aktivuje tentýž SW instance hned po install). */
let IU_HAD_ACTIVE_SW_AT_INSTALL = false;

// Install: cache App Shell + durable offline.html
self.addEventListener("install", (event) => {
  try {
    IU_HAD_ACTIVE_SW_AT_INSTALL = !!(self.registration && self.registration.active);
  } catch (_) {}
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(APP_SHELL_CACHE);
        const urls = getAppShellUrls().map((url) => normalizeUrl(url));
        await cache.addAll(urls).catch((err) => {
          console.warn("[SW] App Shell cache failed:", err);
        });
      } catch (_) {}
      try {
        const offlineRes = await fetch(offlineDocumentUrl(), { cache: "no-store" });
        if (offlineRes && offlineRes.ok) await putOfflineDocument(offlineRes);
      } catch (_) {}
    })()
  );
  self.skipWaiting();
});

// Activate: hard reset caches + one safe client reload signal for stale PWA shells
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    /* P1 perf fix #7: reload signál jen pro UPDATE (deploy refresh), nikdy pro
       první instalaci — cold load se kvůli broadcastu načítal 2× (LCP +1.7-3.9 s).
       Update detekce: starý SW byl aktivní při install NEBO existují iu-* cache
       z jiné CACHE_VERSION (fallback, kdyby SW instance mezi install/activate padla). */
    /* Durable offline caches omit CACHE_VERSION on purpose. Exclude them from
       deploy detection — otherwise IU_SW_DEPLOY_RELOAD fires after the first
       feed/image write and breaks tab UI (Playwright + installed PWA). */
    const durableCaches = new Set([
      FEED_OFFLINE_CACHE,
      IMG_OFFLINE_CACHE,
      OFFLINE_DOC_CACHE,
      HTML_LAST_GOOD_CACHE,
    ]);
    const hadPreviousDeploy =
      IU_HAD_ACTIVE_SW_AT_INSTALL ||
      keys.some((key) => {
        if (durableCaches.has(key)) return false;
        return key.indexOf("iu-") === 0 && !key.endsWith(CACHE_VERSION);
      });
    /* Keep durable last-good feed/images + offline.html + public HTML shells.
       Always drop versioned app/data shell caches (including current) so
       activate matches main: CSS/JS come from network, not a half-filled
       install precache — keeping APP_SHELL here broke mobile Tools tab. */
    await Promise.all(
      keys.map((key) => {
        if (durableCaches.has(key)) return Promise.resolve();
        return caches.delete(key);
      })
    );
    await self.clients.claim();
    /* Fire-and-forget only — never event.waitUntil(warm…).
       A hung warm fetch would keep activate "activating" and freeze navigations
       (desktop section-close / Playwright). */
    try {
      warmOfflineAssets();
    } catch (_) {}
    if (hadPreviousDeploy) {
      try {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: "IU_SW_DEPLOY_RELOAD", cacheVersion: CACHE_VERSION });
        }
      } catch (_) {}
    }
  })());
});

// Fetch: Network First pro data, Cache First pro App Shell
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname;

  if (url.origin === self.location.origin && isProjectsVersionProbePath(path)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  if (
    url.origin === self.location.origin &&
    isProjectsHtmlPath(path) &&
    event.request.method === "GET"
  ) {
    event.respondWith(networkFirstNoStore(event.request, true));
    return;
  }

  if (url.origin === self.location.origin && isProjectsFeedDataPath(path)) {
    event.respondWith(handleProjectsFeedDataPassthrough(event, path));
    return;
  }

  if (url.origin === self.location.origin && path.startsWith("/projects/data/")) {
    if (path.endsWith(".json")) {
      event.respondWith(handleDataRequest(event));
      return;
    }
  }

  if (
    url.origin === self.location.origin &&
    (path.startsWith("/projects/data/") || path.startsWith("/projects/assets/"))
  ) {
    return;
  }

  // P0: HTML dokumenty (navigace) — network-first; offline → last-good / offline.html / synthetic 200
  if (
    event.request.method === "GET" &&
    url.origin === self.location.origin &&
    (event.request.mode === "navigate" || event.request.destination === "document")
  ) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(event.request, { cache: "no-store" });
          if (res && res.ok) {
            try {
              putLastGoodPublicHtml(event.request, res.clone());
            } catch (_) {}
            if (path === "/offline.html" || path.endsWith("/offline.html")) {
              try {
                putOfflineDocument(res.clone());
              } catch (_) {}
            }
          }
          return res;
        } catch (_) {
          return offlineNavigationFallback(event.request);
        }
      })()
    );
    return;
  }

  // Same-origin images: cache-first with network update; keep last-good offline.
  if (
    url.origin === self.location.origin &&
    path.includes("/assets/images/") &&
    event.request.method === "GET"
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMG_OFFLINE_CACHE);
        const cacheKey = new Request(url.origin + url.pathname);
        const cached = await cache.match(cacheKey);
        try {
          const fresh = await fetch(event.request, { cache: "no-store" });
          if (fresh && fresh.ok) {
            event.waitUntil(
              (async () => {
                try {
                  await cache.put(cacheKey, fresh.clone());
                  const keys = await cache.keys();
                  if (keys.length > IMG_OFFLINE_MAX_ENTRIES) {
                    const overflow = keys.length - IMG_OFFLINE_MAX_ENTRIES;
                    for (let i = 0; i < overflow; i++) {
                      await cache.delete(keys[i]);
                    }
                  }
                } catch (_) {}
              })()
            );
            return fresh;
          }
        } catch (_) {}
        if (cached) return cached;
        return new Response("", { status: 503, statusText: "Offline", headers: { "Cache-Control": "no-store" } });
      })()
    );
    return;
  }

  // Cross-origin preview thumbs (HomeCards / remote article images): cache previously seen images.
  if (
    event.request.method === "GET" &&
    (event.request.destination === "image" ||
      /\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|\?)/i.test(path)) &&
    url.origin !== self.location.origin
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMG_OFFLINE_CACHE);
        const cacheKey = event.request;
        const cached = await cache.match(cacheKey);
        try {
          const fresh = await fetch(event.request, { mode: event.request.mode || "no-cors" });
          /* Cache opaque (status 0) and ok responses — both usable offline for <img>. */
          if (fresh && (fresh.ok || fresh.type === "opaque")) {
            event.waitUntil(
              (async () => {
                try {
                  await cache.put(cacheKey, fresh.clone());
                  const keys = await cache.keys();
                  if (keys.length > IMG_OFFLINE_MAX_ENTRIES) {
                    const overflow = keys.length - IMG_OFFLINE_MAX_ENTRIES;
                    for (let i = 0; i < overflow; i++) {
                      await cache.delete(keys[i]);
                    }
                  }
                } catch (_) {}
              })()
            );
            return fresh;
          }
        } catch (_) {}
        if (cached) return cached;
        return new Response("", { status: 503, statusText: "Offline", headers: { "Cache-Control": "no-store" } });
      })()
    );
    return;
  }

  /* app.js: network-first (must run before generic CSS/JS SWR). */
  if (path.includes("/assets/app.js")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        const cacheKey = new Request(url.origin + url.pathname);
        try {
          const res = await fetch(event.request, { cache: "no-store" });
          if (res && res.ok) {
            event.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
            return res;
          }
        } catch (_) {}
        const cached = (await cache.match(cacheKey)) || (await caches.match(event.request));
        if (cached) return cached;
        return new Response("", { status: 503, statusText: "Offline", headers: { "Cache-Control": "no-store" } });
      })()
    );
    return;
  }

  /* Prehled dne / info-system modules: network-first.
     Generic SWR below keys by pathname only (strips ?v=), so a pre-#7622 cached
     iu-prehled-dne-ui-v1.js could keep serving old settings UI to installed PWAs. */
  if (
    path.includes("/assets/iu-prehled-dne-") ||
    path.includes("/assets/iu-info-system-core-v1.js") ||
    path.includes("/assets/iu-traffic-overview-v1.js") ||
    path.includes("/assets/iu-json-parse-worker-v1.js")
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        const cacheKey = new Request(url.origin + url.pathname);
        try {
          const res = await fetch(event.request, { cache: "no-store" });
          if (res && res.ok) {
            event.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
            return res;
          }
        } catch (_) {}
        const cached = (await cache.match(cacheKey)) || (await caches.match(event.request));
        if (cached) return cached;
        return new Response("", { status: 503, statusText: "Offline", headers: { "Cache-Control": "no-store" } });
      })()
    );
    return;
  }

  // CSS/JS assets: stale-while-revalidate, cache key bez query stringu.
  // Důvod: stabilní ?v=... + Cache First by jinak mohl držet staré CSS/JS donekonečna.
  if (
    url.origin === self.location.origin &&
    path.includes("/assets/") &&
    (path.endsWith(".css") || path.endsWith(".js"))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        const cacheKey = new Request(url.origin + url.pathname);

        const cached = await cache.match(cacheKey);
        const updatePromise = fetch(event.request, { cache: "no-store" })
          .then((response) => {
            if (response && response.ok) {
              cache.put(cacheKey, response.clone());
              console.info("[SW] asset updated:", url.pathname);
            }
            return response;
          })
          .catch(() => null);

        // Update cache in background even when serving cached.
        event.waitUntil(updatePromise);

        if (cached) return cached;

        const fresh = await updatePromise;
        if (fresh) return fresh;

        // As a last resort, try cache again (race) then fall back.
        const cachedAfter = await cache.match(cacheKey);
        if (cachedAfter) return cachedAfter;
        return fetch(event.request);
      })()
    );
    return;
  }

  if (path.includes("/assets/iu-pwa-version-check.js")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  const isDataJson = path.startsWith(`${BASE}data/`) && path.endsWith(".json");

  if (isDataJson) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((networkResponse) => {
          if (!networkResponse.ok) {
            throw new Error(`Network ${networkResponse.status}`);
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) {
            const metaCache = await caches.open(DATA_META_CACHE);
            const metaRes = await metaCache.match(new Request(event.request.url + ".meta"));
            if (metaRes) {
              const meta = await metaRes.json();
              if (isCacheValid(meta)) {
                return cached;
              }
            } else {
              return cached;
            }
          }
          throw new Error("Network failed and no cache");
        })
    );
    return;
  }

  // ✅ FIX: App Shell: Cache First - detekce relativně vůči BASE
  const isAppShell = path === BASE || 
                     path === `${BASE}index.html` || 
                     path.startsWith(`${BASE}assets/`) && (path.endsWith(".js") || path.endsWith(".css")) ||
                     path === `${BASE}sw.js`;
  
  if (isAppShell) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // ✅ FIX: Funkce pro kontrolu, zda response je JSON (ne HTML)
  function looksLikeJSON(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return true;
    // Pokud není content-type, zkontroluj první znak
    return false; // Musíme zkontrolovat tělo
  }

  // JSON data: Network First + Cache Fallback s TTL
  if (path.endsWith(".json")) {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          // ✅ FIX: Nekacherovat 404 nebo HTML místo JSON
          if (!response.ok || response.status === 404) {
            // Zkus cache jako fallback
            const cached = await caches.match(event.request);
            if (cached) {
              const text = await cached.clone().text();
              if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
                return cached;
              }
            }
            return response; // Vrať chybu, ne cacheuj HTML
          }

          // ✅ FIX: Ověř, že response je skutečně JSON (ne HTML)
          const clone = response.clone();
          const text = await clone.text();
          const isJSON = text.trim().startsWith("{") || text.trim().startsWith("[");
          const isHTML = text.trim().toLowerCase().startsWith("<!doctype") || text.trim().toLowerCase().startsWith("<html");

          if (isHTML) {
            // HTML místo JSON - nekacherovat, zkus cache jako fallback
            const cached = await caches.match(event.request);
            if (cached) {
              const cachedText = await cached.clone().text();
              if (cachedText.trim().startsWith("{") || cachedText.trim().startsWith("[")) {
                return cached;
              }
            }
            return new Response(JSON.stringify({ error: "Server returned HTML instead of JSON" }), {
              status: 503,
              headers: { "Content-Type": "application/json" }
            });
          }

          if (isJSON) {
            // Validní JSON - cacheuj (klonovat a await před return response — jinak tělo už čte klient a .clone() spadne)
            const responseForCache = response.clone();
            const cache = await caches.open(DATA_CACHE);
            await cache.put(event.request, responseForCache);
            const meta = {
              timestamp: Date.now(),
              type: path.includes("articles") ? "articles" : path.includes("videos") ? "videos" : path.includes("weather") ? "weather" : path.includes("namedays") ? "namedays" : "meta"
            };
            const metaCache = await caches.open(DATA_META_CACHE);
            await metaCache.put(new Request(event.request.url + ".meta"), new Response(JSON.stringify(meta)));
          }

          return response;
        })
        .catch(async () => {
          // Network failed, zkus cache
          const cached = await caches.match(event.request);
          if (cached) {
            // ✅ FIX: Ověř, že cached response je JSON (ne HTML)
            const text = await cached.clone().text();
            if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
              // Ověř TTL
              const metaCache = await caches.open(DATA_META_CACHE);
              const metaRes = await metaCache.match(new Request(event.request.url + ".meta"));
              if (metaRes) {
                const meta = await metaRes.json();
                if (isCacheValid(meta)) {
                  return cached;
                }
              } else {
                // Pokud není metadata, použij cache (ale jen pokud je JSON)
                return cached;
              }
            }
          }
          return new Response(JSON.stringify({ error: "Network failed and no cache" }), {
            status: 503,
            headers: { "Content-Type": "application/json" }
          });
        })
    );
    return;
  }

  // Cross-origin (non-image): never intercept. Image GET is handled above.
  // Important for InfoUzel Analytics ingest — SW fetch() can use a different UA than the page
  // (e.g. Playwright UA override vs HeadlessChrome), which would fail the Worker crawler guard.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Ostatní same-origin: Network First (vždy platná Response — nikdy undefined)
  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } catch (_) {
        const c = await caches.match(event.request);
        if (c) return c;
        return new Response("", {
          status: 503,
          statusText: "Network Error",
          headers: { "Cache-Control": "no-store" },
        });
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
