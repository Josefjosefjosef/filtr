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
const CACHE_VERSION = "2026-04-22-invoice-overlay-v2";
const APP_SHELL_CACHE = `iu-app-${CACHE_VERSION}`;
const DATA_CACHE = `iu-data-${CACHE_VERSION}`;
const DATA_META_CACHE = `iu-data-meta-${CACHE_VERSION}`; // Metadata pro TTL

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
  meta: 30 * 60 * 1000,
};
const DATA_FETCH_TIMEOUT_MS = 5500;

function getDataRequestType(pathname) {
  if (pathname.includes("articles.json")) return "articles";
  if (pathname.includes("videos.json")) return "videos";
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
    `${BASE}assets/iu-invoice-overlay.css`,
    `${BASE}assets/app-crash-shield.js`,
    `${BASE}assets/app-render-optimizer.js`,
    `${BASE}assets/app.js`,
    `${BASE}sw.js`
  ];
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
  const isArticles = pathname.includes("articles.json");
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
  return (
    name === "articles.json" ||
    name === "videos.json" ||
    name === "_probe.txt"
  );
}

async function handleProjectsFeedDataPassthrough(event, pathname) {
  const doFetch = () =>
    fetch(event.request, { cache: "no-store" });

  try {
    const r = await doFetch();
    if (r.ok) return r;
  } catch (_) {}
  try {
    const r = await doFetch();
    if (r.ok) return r;
  } catch (_) {}

  if (pathname.endsWith("articles.json")) return seedResponse(pathname);
  if (pathname.endsWith("videos.json")) return seedResponse(pathname);
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

// Install: cache App Shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      const urls = getAppShellUrls().map(url => normalizeUrl(url));
      return cache.addAll(urls).catch((err) => {
        console.warn("[SW] App Shell cache failed:", err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: hard reset caches
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Fetch: Network First pro data, Cache First pro App Shell
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname;

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

  // P0: HTML dokumenty (navigace) — network-first; cache jen při výpadku sítě (offline fallback)
  if (
    event.request.method === "GET" &&
    url.origin === self.location.origin &&
    (event.request.mode === "navigate" || event.request.destination === "document")
  ) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(event.request, { cache: "no-store" });
          return res;
        } catch (_) {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return new Response("", {
            status: 503,
            statusText: "Offline",
            headers: { "Cache-Control": "no-store" },
          });
        }
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

  if (path.includes("/assets/app.js")) {
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

  // Ostatní: Network First (vždy platná Response — nikdy undefined)
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
