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
  feed_health: 600,   // 10 minut
  default: 300        // 5 minut (fallback)
};

// Max počet položek v data cache (prořezávání)
const MAX_CACHE_ITEMS = 50;

const APP_SHELL = [
  "/",
  "/index.html",
  "/filtr/",
  "/filtr/index.html",
  "/assets/app.js",
  "/filtr/assets/app.js",
  "/app-crash-shield.js",
  "/filtr/app-crash-shield.js",
  "/app-render-optimizer.js",
  "/filtr/app-render-optimizer.js",
  "/debug.js",
  "/filtr/debug.js"
];

// =========================
// === UTILITY FUNKCE
// =========================

function looksLikeHTML(text) {
  const s = String(text).trim().slice(0, 200).toLowerCase();
  return s.startsWith("<!doctype") || s.startsWith("<html") || s.includes("<head") || s.includes("<body");
}

function getTTLForPath(path) {
  if (path.includes("articles")) return TTL.articles;
  if (path.includes("videos")) return TTL.videos;
  if (path.includes("weather")) return TTL.weather;
  if (path.includes("namedays")) return TTL.namedays;
  if (path.includes("meta")) return TTL.meta;
  if (path.includes("status")) return TTL.status;
  if (path.includes("feed_health")) return TTL.feed_health;
  return TTL.default;
}

function getCacheKey(url) {
  // Normalizuj URL (odstran query string pro cache match)
  const u = new URL(url);
  u.search = "";
  return u.toString();
}

async function getCacheMetadata(cache, key) {
  try {
    const metaKey = `${DATA_META_CACHE}:${key}`;
    const metaCache = await caches.open(DATA_META_CACHE);
    const metaRes = await metaCache.match(metaKey);
    if (metaRes) {
      const meta = await metaRes.json();
      return meta;
    }
  } catch (e) {
    // Ignoruj chyby
  }
  return null;
}

async function setCacheMetadata(cache, key, metadata) {
  try {
    const metaKey = `${DATA_META_CACHE}:${key}`;
    const metaCache = await caches.open(DATA_META_CACHE);
    await metaCache.put(metaKey, new Response(JSON.stringify(metadata), {
      headers: { "Content-Type": "application/json" }
    }));
  } catch (e) {
    // Ignoruj chyby
  }
}

function isCacheStale(metadata, ttl) {
  if (!metadata || !metadata.cachedAt) return true;
  const age = (Date.now() - metadata.cachedAt) / 1000;
  return age > ttl;
}

async function pruneCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_CACHE_ITEMS) return;

    // Získej metadata pro všechny klíče
    const items = [];
    for (const key of keys) {
      const url = key.url || key;
      const cacheKey = getCacheKey(url);
      const meta = await getCacheMetadata(cache, cacheKey);
      items.push({ key, cacheKey, meta, url });
    }

    // Seřaď podle času uložení (nejstarší první)
    items.sort((a, b) => {
      const aTime = a.meta?.cachedAt || 0;
      const bTime = b.meta?.cachedAt || 0;
      return aTime - bTime;
    });

    // Odstraň nejstarší položky
    const toRemove = items.slice(0, items.length - MAX_CACHE_ITEMS);
    for (const item of toRemove) {
      await cache.delete(item.key);
      // Odstraň i metadata
      const metaKey = `${DATA_META_CACHE}:${item.cacheKey}`;
      const metaCache = await caches.open(DATA_META_CACHE);
      await metaCache.delete(metaKey);
    }

    console.log(`[SW] Prořezána cache: odstraněno ${toRemove.length} položek`);
  } catch (e) {
    console.warn("[SW] Chyba při prořezávání cache", e);
  }
}

// =========================
// === INSTALL
// =========================

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches.open(APP_SHELL_CACHE).then(cache => {
      return cache.addAll(APP_SHELL).catch(() => {});
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// =========================
// === ACTIVATE
// =========================

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          // Smaž staré cache verze (kromě aktuálních)
          if (key !== APP_SHELL_CACHE && key !== DATA_CACHE && key !== DATA_META_CACHE && key.startsWith("iu-")) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// =========================
// === FETCH
// =========================

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  const path = url.pathname;

  // JSON data: Network First + Cache Fallback s TTL
  if (path.endsWith(".json") && (path.includes("/data/") || path.includes("articles") || path.includes("videos") || path.includes("meta") || path.includes("status") || path.includes("weather") || path.includes("namedays"))) {
    ev.respondWith(
      (async () => {
        const cacheKey = getCacheKey(ev.request.url);
        const ttl = getTTLForPath(path);
        const cache = await caches.open(DATA_CACHE);

        // Zkus network
        try {
          const networkRes = await fetch(ev.request);
          if (networkRes.ok) {
            // Zkontroluj, že to není HTML (404 stránka)
            const text = await networkRes.clone().text();
            if (looksLikeHTML(text)) {
              throw new Error("HTML místo JSON (pravděpodobně 404)");
            }

            // OK → ulož do cache s metadata
            const clone = networkRes.clone();
            await cache.put(ev.request, clone);
            
            // Ulož metadata (timestamp)
            await setCacheMetadata(cache, cacheKey, {
              cachedAt: Date.now(),
              ttl: ttl,
              url: ev.request.url
            });

            // Prořež cache pokud je potřeba
            await pruneCache(cache);

            return networkRes;
          }
          throw new Error(`HTTP ${networkRes.status}`);
        } catch (networkErr) {
          // Network fail → zkus cache
          // Použij ignoreSearch pro match (ignoruje query stringy)
          const cached = await cache.match(ev.request, { ignoreSearch: true });
          
          if (cached) {
            // Ověř, že cache není HTML
            const text = await cached.clone().text();
            if (looksLikeHTML(text)) {
              // Cache je HTML → vrať fallback
              return new Response(JSON.stringify({ error: "offline", items: [] }), {
                headers: { "Content-Type": "application/json" }
              });
            }

            // Zkontroluj TTL
            const meta = await getCacheMetadata(cache, cacheKey);
            const stale = isCacheStale(meta, ttl);

            if (stale) {
              // Cache je stale, ale použijeme ji jako fallback
              return new Response(cached.body, {
                status: cached.status,
                statusText: cached.statusText,
                headers: {
                  ...Object.fromEntries(cached.headers.entries()),
                  "X-Cache-Status": "stale"
                }
              });
            }

            // Cache je fresh
            return cached;
          }

          // Žádná cache → fallback
          return new Response(JSON.stringify({ error: "offline", items: [] }), {
            headers: { "Content-Type": "application/json" }
          });
        }
      })()
    );
    return;
  }

  // App Shell: Cache First
  if (APP_SHELL.some(p => path === p || path.endsWith(p))) {
    ev.respondWith(
      caches.match(ev.request).then(cached => {
        if (cached) return cached;
        return fetch(ev.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(APP_SHELL_CACHE).then(cache => {
              cache.put(ev.request, clone);
            });
          }
          return res;
        });
      })
    );
    return;
  }

  // Ostatní: Network First
  ev.respondWith(
    fetch(ev.request).catch(() => {
      return caches.match(ev.request);
    })
  );
});
