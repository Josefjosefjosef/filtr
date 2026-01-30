/* sw.js – Service Worker pro infoUzel.cz
   Strategie: Network First + Cache Fallback pro JSON data s TTL
   App Shell: Cache First
   Poznámka: Kill switch ?nosw=1 je řešen v registraci na stránce (app-crash-shield.js), ne zde
*/

// Verze cache (měnit při každé významné změně)
const CACHE_VERSION = "v2026-01-25-3";
const APP_SHELL_CACHE = `iu-app-${CACHE_VERSION}`;
const DATA_CACHE = `iu-data-${CACHE_VERSION}`;
const DATA_META_CACHE = `iu-data-meta-${CACHE_VERSION}`; // Metadata pro TTL

// TTL pro JSON data (v sekundách)
const TTL = {
  articles: 300,      // 5 minut
  videos: 600,        // 10 minut
  weather: 1800,      // 30 minut
  namedays: 86400,    // 24 hodin
  meta: 600,          // 10 minut
  status: 300,        // 5 minut
};

// ✅ FIX: App Shell soubory (Cache First) - relativní vůči BASE
// BASE bude definován později, takže použijeme funkci
function getAppShellUrls() {
  return [
    BASE,
    `${BASE}index.html`,
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

// Activate: cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== APP_SHELL_CACHE && key !== DATA_CACHE && key !== DATA_META_CACHE) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch: Network First pro data, Cache First pro App Shell
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname;

  if (path.includes("/assets/app.js") || path.includes("/projects/data/")) {
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
            // Validní JSON - cacheuj
            caches.open(DATA_CACHE).then((cache) => {
              cache.put(event.request, response.clone());
              // Ulož metadata pro TTL
              const meta = {
                timestamp: Date.now(),
                type: path.includes("articles") ? "articles" : path.includes("videos") ? "videos" : path.includes("weather") ? "weather" : path.includes("namedays") ? "namedays" : "meta"
              };
              caches.open(DATA_META_CACHE).then((metaCache) => {
                metaCache.put(new Request(event.request.url + ".meta"), new Response(JSON.stringify(meta)));
              });
            });
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

  // Ostatní: Network First
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
