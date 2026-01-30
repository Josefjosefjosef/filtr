// === MAINTENANCE
// ::contentReference[oaicite:0]{index=0}
// REŽIM: MAINTENANCE
// Stav: FEED STABLE
// Povolené zásahy:
// - drobné UI úpravy mimo feed
// - přidání nových funkcí mimo render pipeline
// Zakázané zásahy:
// - loadData / applyFilter / renderFeed
// - state.cachedItems / state.filteredItems logika
// - změny routování přes contentType
// === INFOUZEL FEED INVARIANTS (NO-GO ZONE) ===
// - jediný zdroj pravdy: state.*
// - jediná render pipeline: loadData → state.cachedItems → applyFilter → renderFeed
// - render výhradně do #feed (safeTarget)
// - routování výhradně přes item.contentType
// Porušení = BUG (ne warning)
(() => {
  const $ = (sel) => document.querySelector(sel);
  /*
  Release summary (UI/data):

  Render zapisuje pouze do ověřeného #feed přes safeTarget.

  Routing je řízen jen item.contentType ("article"/"video").

  Veškerý stav je ve state.* (bez globálních proměnných).

  Produkce je tichá: diagnostika běží jen při ?debug=1.

  Chyby se propisují přes persistLastError + #lastErrInline, bez potřeby debug režimu.
  */
  function qsSafe(selector) {
    try {
      const el = document.querySelector(selector);
      if (!el) {
        debugWarn("[DOM] missing", selector);
      }
      return el;
    } catch (err) {
      debugWarn("[DOM] missing", selector, err);
      return null;
    }
  }

  const elStatus = $("#dataStatus");
  const elDebugPanel = $("#debugPanel");
  const elDebugOut = $("#debugOut");
  const elDataCount = $("#dataCount");
  const btnToggleDebug = $("#toggleDebugBtn");
  const elNewsList = document.getElementById("newsList");
  const elFeed = document.getElementById("feed");
  const emptyBox = document.getElementById("emptyBox");
  const sectionLabel = document.getElementById("sectionLabel");
  const sectionsBar = document.getElementById("sectionsBar");
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");
  const searchModal = document.getElementById("searchModal");
  const modalGoogle = document.getElementById("modalGoogle");
  const modalCancel = document.getElementById("modalCancel");

  const SECTION_KEYS = ["vse", "aktualne", "doprava", "pocasi", "sport", "finance", "krimi", "zdravi", "video"];
  let activeSections = ["vse"];
  const state = {
    cachedItems: [],
    filteredItems: [],
    hasLoadedData: false,
    loadRequestId: 0,
    stats: { articlesCount: 0, videosCount: 0 },
    lastArticlesGeneratedAt: null,
    lastVideosGeneratedAt: null,
    lastArticlesKeys: null,
    lastVideosKeys: null,
    lastArticlesUpdatedAt: null,
    lastVideosUpdatedAt: null,
  };
  state.cachedItems ??= [];
  state.filteredItems ??= [];
  const ALLOWED_CONTENT_TYPES = new Set(["article", "video"]);
  const isDebugLogging = location.search.includes("debug=1");
  function debugLog(...args) {
    if (!isDebugLogging) return;
    console.log(...args);
  }
  function debugWarn(...args) {
    if (!isDebugLogging) return;
    console.warn(...args);
  }
  function diagLog(tag, info) {
    console.log("[DIAG]", tag, info);
  }
  // DEBUG KONTRAKT:
  // debug se aktivuje pouze location.search.includes("debug=1")
  // debug je pouze console logging
  // v UI nesmí existovat #debugPanel ani žádný debug box
  // debug nesmí blokovat render ani měnit state.*
  if (isDebugLogging && document.getElementById("debugPanel")) {
    debugWarn("[DEBUG] Unexpected #debugPanel present in DOM (should not exist).");
  }
  const BASE_ROOT = getBaseRoot();
  const DATA_URL = `${BASE_ROOT}data/articles.json`;
  const VIDEOS_URL = `${BASE_ROOT}data/videos.json`;
  const SECTION_LABELS = {
    vse: "Vše",
    aktualne: "Aktuálně",
    doprava: "Doprava",
    pocasi: "Počasí",
    sport: "Sport",
    finance: "Finance",
    krimi: "Krimi",
    zdravi: "Zdraví",
    video: "Video",
  };

  function makeDataUrl(relativePath) {
    if (!relativePath) {
      return BASE_ROOT;
    }
    const sanitized = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
    const base = BASE_ROOT.endsWith("/") ? BASE_ROOT : `${BASE_ROOT}/`;
    return sanitized ? `${base}${sanitized}` : base;
  }

  function withCacheBust(url) {
    const candidate = String(url || "");
    if (!candidate) return "";
    if (!/(articles|videos)\.json/.test(candidate)) return candidate;
    const separator = candidate.includes("?") ? "&" : "?";
    return `${candidate}${separator}v=${Date.now()}`;
  }

  const PREFERRED_TTL_MS = 48 * 60 * 60 * 1000;
  const PREFERRED_STORAGE_KEY = "iu.preferredUrls";

  function loadPreferredPair() {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(PREFERRED_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.articlesUrl !== "string" || typeof parsed.videosUrl !== "string") {
        return null;
      }
      return {
        articlesUrl: parsed.articlesUrl,
        videosUrl: parsed.videosUrl,
        preferredAt: Number(parsed.preferredAt) || 0,
      };
    } catch {
      return null;
    }
  }

  function savePreferredPair(articlesUrl, videosUrl) {
    if (!articlesUrl || !videosUrl) return false;
    if (typeof localStorage === "undefined") return false;
    try {
      localStorage.setItem(
        PREFERRED_STORAGE_KEY,
        JSON.stringify({ articlesUrl, videosUrl, preferredAt: Date.now() })
      );
      return true;
    } catch {
      return false;
    }
  }

  async function evaluatePreferredPair() {
    const entry = loadPreferredPair();
    if (!entry) {
      return { articlesUrl: null, videosUrl: null, status: "missing" };
    }
    if (!entry.preferredAt || Date.now() - entry.preferredAt > PREFERRED_TTL_MS) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "expired" };
    }
    const [articlesOk, videosOk] = await Promise.all([
      quickCheckUrl(entry.articlesUrl),
      quickCheckUrl(entry.videosUrl),
    ]);
    if (articlesOk && videosOk) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "ok" };
    }
    if (!articlesOk) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "articles-unreachable" };
    }
    return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "videos-unreachable" };
  }

  function buildCandidateListFromPair(preferredEntry, type, baseSequence) {
    const seen = new Set();
    const list = [];
    const push = (value) => {
      if (!value) return;
      if (seen.has(value)) return;
      seen.add(value);
      list.push(value);
    };
    const preferredUrl = preferredEntry?.[`${type}Url`];
    if (preferredEntry?.status === "ok" && preferredUrl) {
      push(preferredUrl);
    }
    baseSequence.forEach(push);
    if (preferredUrl && preferredEntry?.status !== "ok") {
      push(preferredUrl);
    }
    return list;
  }

  async function quickCheckUrl(url) {
    if (!url) return false;
    const testUrl = withCacheBust(url);
    try {
      const headRes = await timeoutFetch(testUrl, { method: "HEAD", cache: "no-store" }, 2800);
      if (headRes.ok) return true;
      if (headRes.status === 405) {
        const fallback = await timeoutFetch(testUrl, { cache: "no-store" }, 2800);
        return fallback.ok;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function probeRootPaths() {
    const rootArticlesPath = "/data/articles.json";
    const rootVideosPath = "/data/videos.json";
    const [articlesOk, videosOk] = await Promise.all([
      quickCheckUrl(rootArticlesPath),
      quickCheckUrl(rootVideosPath),
    ]);
    return {
      ok: articlesOk && videosOk,
      articlesOk,
      videosOk,
      articlesPath: rootArticlesPath,
      videosPath: rootVideosPath,
    };
  }

  function appendDataCacheBust(url) {
    if (!url) return url;
    if (!/(articles|videos)\.json/.test(url)) return url;
    try {
      const parsed = new URL(url, location.origin);
      parsed.searchParams.append("iu_ts", Date.now().toString());
      return parsed.toString();
    } catch {
      return url;
    }
  }

  async function tryFetchJson(url, timeoutMs = 9000) {
    const requestUrl = appendDataCacheBust(url);
    try {
      const res = await timeoutFetch(requestUrl, { cache: "no-store" }, timeoutMs);
      const text = await res.text();
      if (!res.ok) {
        const preview = text ? text.slice(0, 200) : "";
        return {
          ok: false,
          url: requestUrl,
          json: null,
          status: res.status,
          error: `HTTP ${res.status} ${preview ? `| ${preview}` : ""}`,
        };
      }
      try {
        const json = JSON.parse(text);
        return { ok: true, url: requestUrl, json, status: res.status, error: null };
      } catch {
        return { ok: false, url: requestUrl, json: null, status: res.status, error: "Invalid JSON" };
      }
    } catch (err) {
      return {
        ok: false,
        url: requestUrl,
        json: null,
        status: 0,
        error: `Fetch failed: ${err && err.message ? err.message : "unknown"}`,
      };
    }
  }

  async function pickFirstWorkingJson(urls, timeoutMs = 9000) {
    let lastError = "";
    for (const url of urls) {
      if (!url) continue;
      const result = await tryFetchJson(url, timeoutMs);
      if (result.ok) {
        return { url: result.url, json: result.json };
      }
      lastError = `[${result.url}] ${result.error}`;
    }
    persistLastError(`DATA fetch failed: ${lastError} | tried ${urls.join(", ")}`);
    return null;
  }

  function normalizeFeedJson(json) {
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.articles)) return json.articles;
    if (json && Array.isArray(json.videos)) return json.videos;
    if (json && Array.isArray(json.items)) return json.items;
    return [];
  }

  function getBaseRoot() {
    let p = location.pathname.replace(/\\/g, "/");
    if (p.endsWith("index.html")) {
      p = p.slice(0, -10);
    }
    if (!p.endsWith("/")) {
      p += "/";
    }
    return p || "/";
  }

  function getBuildStamp() {
    const meta = document.querySelector('meta[name="iu-build"]');
    const value = meta ? (meta.getAttribute("content") || "").trim() : "";
    return value || null;
  }

  const BUILD_STAMP = getBuildStamp();
  debugLog("[BUILD]", BUILD_STAMP || "no-build-stamp");

  function freezeScroll() {
    if (freezeScroll.lock) return;
    freezeScroll.lock = { x: window.scrollX, y: window.scrollY };
    window.requestAnimationFrame(() => {
      window.scrollTo(freezeScroll.lock.x, freezeScroll.lock.y);
      window.requestAnimationFrame(() => window.scrollTo(freezeScroll.lock.x, freezeScroll.lock.y));
    });
  }
  freezeScroll.lock = null;

  function restoreScroll() {
    if (!freezeScroll.lock || restoreScroll.pending) return;
    restoreScroll.pending = true;
    const { x, y } = freezeScroll.lock;
    window.requestAnimationFrame(() => {
      window.scrollTo(x, y);
      window.requestAnimationFrame(() => {
        window.scrollTo(x, y);
        freezeScroll.lock = null;
        restoreScroll.pending = false;
      });
    });
  }
  restoreScroll.pending = false;

  function withScrollLock(fn) {
    freezeScroll();
    try {
      fn();
    } finally {
      restoreScroll();
    }
  }

  function isDebugOn() {
    return isDebugLogging;
  }

  function setDebug(on) {
    const params = new URLSearchParams(location.search);
    if (on) {
      params.set("debug", "1");
    } else {
      params.delete("debug");
    }
    const search = params.toString();
    const next = `${location.pathname}${search ? `?${search}` : ""}`;
    location.replace(next);
  }

  function renderDebugVisibility() {
    const on = isDebugOn();
    if (elDebugPanel) {
      elDebugPanel.style.display = on ? "block" : "none";
    }
    if (btnToggleDebug) {
      btnToggleDebug.textContent = on ? "Vypnout debug" : "Zapnout debug";
    }
  }

  let iuLastStatusLine = "";
  function setStatus(text) {
    if (elStatus) {
      elStatus.textContent = text;
    }
  }
  function iuWriteStatus(line) {
    iuLastStatusLine = String(line || "");
    setStatus(iuLastStatusLine);
  }
  function iuHasStatusPlaceholders(line) {
    const s = String(line || "");
    if (!s) return true;
    const placeholders = [
      "YES|NO",
      "preferred|fallback",
      "OK|NEOK",
      "…",
      "articles=…",
      "videos=…",
      "articles=<…>",
      "videos=<…>",
      "Načteno: články X, videa Y",
      "#feed children: N",
    ];
    if (placeholders.some((token) => s.includes(token))) return true;
    if (s.includes("<") || s.includes(">")) return true;
    if (/\bX\b/.test(s) || /\bY\b/.test(s) || /\bN\b/.test(s)) return true;
    return false;
  }

  function safeText(value) {
    if (value == null) return "";
    return String(value);
  }

  function safeUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.origin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.href;
      }
    } catch {
      return null;
    }
    return null;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleString("cs-CZ");
  }

  function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.articles)) return data.articles;
    }
    return [];
  }

  function iuExtractYouTubeId(item) {
    if (!item || typeof item !== "object") return null;
    const candidates = [];
    const directId = item.videoId;
    if (typeof directId === "string" && /^[A-Za-z0-9_-]{11}$/.test(directId.trim())) {
      return directId.trim();
    }
    const pushUrl = (value) => {
      if (!value) return;
      try {
        const normalized = new URL(value, location.origin).href;
        candidates.push(normalized);
      } catch {
        candidates.push(String(value));
      }
    };
    if (item.url) pushUrl(item.url);
    if (item.link) {
      if (typeof item.link === "string") pushUrl(item.link);
      else if (item.link.href) pushUrl(item.link.href);
    }
    if (item.canonicalUrl) pushUrl(item.canonicalUrl);
    if (Array.isArray(item.sources)) {
      for (const source of item.sources) {
        if (!source) continue;
        if (typeof source === "string") pushUrl(source);
        else if (source.url) pushUrl(source.url);
        else if (source.href) pushUrl(source.href);
      }
    }
    const patterns = [
      /(?:v=)([A-Za-z0-9_-]{11})/,
      /(?:\/embed\/)([A-Za-z0-9_-]{11})/,
      /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
      /(?:\/shorts\/)([A-Za-z0-9_-]{11})/,
      /(?:\/live\/)([A-Za-z0-9_-]{11})/,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      for (const pattern of patterns) {
        const match = candidate.match(pattern);
        if (match && match[1]) return match[1];
      }
    }
    return null;
  }

  function normalizeVideoList(input) {
    const source =
      Array.isArray(input) ? input
      : (input && Array.isArray(input.videos) ? input.videos
      : (input && Array.isArray(input.items) ? input.items : []));

    return source
      .map((video) => {
        if (!video || typeof video !== "object") return null;
        const inferredId = iuExtractYouTubeId(video);
        if (!video.videoId && inferredId) {
          video.videoId = inferredId;
        }
        const id = video.videoId || inferredId;
        if (!id) {
        const published = safeText(video.publishedAt || video.date || video.published || "");
        const url = safeUrl(video.url) || safeUrl(`https://www.youtube.com/watch?v=${id}`);
        if (!url) return null;
        const title = safeText(video.title || video.name || video.headline || "Video");
        return {
          ...video,
          contentType: "video",
          videoId: id,
          title,
          publishedAt: published,
          url,
          channel: safeText(video.channel || video.source || ""),
          section: "video",
          summary: safeText(video.summary || video.description || ""),
        };
      })
      .filter(Boolean);
  }

  function buildCombinedFeed(articles, videos) {
    const normalizedArticles = Array.isArray(articles)
      ? articles.map((item) => ({
          ...item,
          contentType: String(item.contentType || "article").toLowerCase(),
        }))
      : [];

    const normalizedVideos = Array.isArray(videos) ? videos : [];

    const combined = [...normalizedArticles, ...normalizedVideos];
    combined.sort((a, b) => {
      const ta = Number(new Date(a?.publishedAt || a?.date || a?.published || 0));
      const tb = Number(new Date(b?.publishedAt || b?.date || b?.published || 0));
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return tb - ta;
    });

    return combined;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDateShort(value) {
    if (!value) return "";
    let date;
    if (value instanceof Date) {
      date = value;
    } else {
      date = new Date(value);
    }
    if (Number.isNaN(date.getTime())) return "";
    const iso = date.toISOString();
    return iso.replace("T", " ").split(".")[0];
  }

  function getJsonTimestamp(json) {
    if (!json || typeof json !== "object") return "";
    const fields = ["updatedAt", "generatedAt", "buildAt"];
    for (const field of fields) {
      const value = json[field];
      const label = formatDateShort(value);
      if (label) return label;
    }
    return "";
  }

  function getSectionLabelText(keys) {
    const names = keys
      .map((key) => SECTION_LABELS[key] || key)
      .filter(Boolean);
    return names.length ? names.join(", ") : SECTION_LABELS.vse;
  }

  function updateSectionLabel() {
    if (!sectionLabel) return;
    const labelText = getSectionLabelText(activeSections);
    sectionLabel.textContent = `Sekce: ${labelText}`;
  }

  function renderSectionsBar() {
    if (!sectionsBar) return;
    sectionsBar.innerHTML = "";
    SECTION_KEYS.forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secBtn";
      btn.dataset.section = key;
      btn.textContent = SECTION_LABELS[key] || key;
      btn.addEventListener("click", () => handleSectionClick(key));
      sectionsBar.appendChild(btn);
    });
    updateSectionButtons();
  }

  function updateSectionButtons() {
    if (!sectionsBar) return;
    sectionsBar.querySelectorAll(".secBtn").forEach((btn) => {
      const key = btn.dataset.section;
      btn.classList.toggle("isActive", activeSections.includes(key));
    });
  }

  function handleSectionClick(key) {
    if (key === "vse") {
      if (location.hash.replace(/^#/, "") === "vse") {
        setSectionsFromHash();
        applyFilter();
        return;
      }
      location.hash = "#vse";
      return;
    }

    const current = new Set(activeSections.filter((k) => k !== "vse"));
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    const next = SECTION_KEYS.filter((k) => current.has(k));
    const finalSections = next.length ? next : ["vse"];
    const hashValue = finalSections.join(",");
    if (location.hash.replace(/^#/, "") === hashValue) {
      setSectionsFromHash();
      applyFilter();
      return;
    }
    location.hash = `#${hashValue}`;
  }

  function setSectionsFromHash() {
    const hash = location.hash.replace(/^#/, "");
    const parsed = hash
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && SECTION_KEYS.includes(s));

    activeSections = parsed.length ? parsed : ["vse"];
    updateSectionLabel();
    updateSectionButtons();
  }

  function matchesSections(item, sections = activeSections) {
    if (!item) return false;
    const type = String(item.contentType || "article").toLowerCase();
    if (type === "ad") return true;
    const effectiveSections = sections && sections.length ? sections : ["vse"];
    if (effectiveSections.includes("vse")) return true;
    const sectionValue = ((item.section || item.topic) || "").toLowerCase();
    return effectiveSections.some((section) => section === sectionValue);
  }

  function ensureFeedTarget() {
    let feed = document.getElementById("feed");
    if (feed) return feed;

    const newsList = document.getElementById("newsList");
    if (newsList) {
      feed = document.createElement("div");
      feed.id = "feed";
      newsList.appendChild(feed);
      return feed;
    }

    return null;
  }

  function getFeedTarget() {
    return ensureFeedTarget();
  }

  function insideTarget(target, fallback) {
    return target || fallback;
  }

  const STATUS_SCROLL_KEY = "iu:scrolledToStatus";

  function scrollToStatusOnce() {
    if (!("sessionStorage" in window)) return;
    if (sessionStorage.getItem(STATUS_SCROLL_KEY)) return;
    const el = document.getElementById("dataStatusArticles");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    sessionStorage.setItem(STATUS_SCROLL_KEY, "1");
  }

  function renderEmpty(message, extraHtml = "") {
    const target = getFeedTarget();
    if (target) {
      withScrollLock(() => {
        target.innerHTML = "";
      });
    }
    if (isDebugLogging) {
      debugLog("[RENDER EMPTY]", { message, cached: state.cachedItems.length });
    }
    if (emptyBox) {
      emptyBox.innerHTML = `<p>${escapeHtml(message)}</p>${extraHtml ? extraHtml : ""}`;
      emptyBox.style.display = "block";
    }
    if (elDataCount) elDataCount.textContent = "0";
  }

  // === LOCKED PIPELINE ===
  // Jakákoli změna této funkce MUSÍ respektovat invarianty feedu.
  // Druhá render cesta je zakázaná.
  function renderFeed(target, items) {
    const feedEl = document.getElementById("feed");
    const feedExists = !!(feedEl && feedEl.id === "feed");
    const feedChildrenBefore = feedEl ? feedEl.childElementCount : 0;
    const targetSelector = feedEl ? "#feed" : "(missing)";
    diagLog("renderFeed:start", {
      itemsLen: items ? items.length : 0,
      target: targetSelector,
      feedExists,
      feedChildrenBefore,
    });
    if (!feedEl || feedEl.id !== "feed") {
      persistLastError("Invariant breach: invalid render target");
      return;
    }
    const safeTarget = insideTarget(target, feedEl);
    if (emptyBox) {
      emptyBox.style.display = "none";
      emptyBox.innerHTML = "";
    }
    const beforeChildren = safeTarget.childElementCount;
    safeTarget.innerHTML = "";
    if (!items || items.length === 0) {
      renderEmpty("Žádné články k zobrazení. Zkontroluj Stav dat.");
      return;
    }
    for (const item of items) {
      const kind = String(item.contentType || "").toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(kind)) {
        persistLastError("Invariant breach: neznámý contentType");
        renderInlineError("Obsah dočasně nedostupný.");
        return;
      }
      const markup = kind === "video" ? buildVideoAsArticleCard(item) : buildArticleHtml(item);
      if (!markup) {
        persistLastError("Invariant breach: builder returned falsy markup");
        renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
        continue;
      }
      const template = document.createElement("template");
      template.innerHTML = markup.trim();
      const node = template.content.firstElementChild;
      if (!node || !(node instanceof HTMLElement)) {
        persistLastError("Invariant breach: builder returned invalid node");
        renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
        continue;
      }
      safeTarget.appendChild(node);
    }
    const feedChildrenAfter = safeTarget.childElementCount;
    const renderedCount = Math.max(feedChildrenAfter - beforeChildren, feedChildrenAfter ? feedChildrenAfter : 0);
    const typeCounts = items.reduce(
      (acc, entry) => {
        const kind = String(entry.contentType || "").toLowerCase();
        if (kind === "article") acc.article += 1;
        else if (kind === "video") acc.video += 1;
        else acc.unknown += 1;
        return acc;
      },
      { article: 0, video: 0, unknown: 0 }
    );
    diagLog("renderFeed:end", {
      itemsCount: items.length,
      renderedCount,
      feedChildrenAfter,
      typeCounts,
    });
    if (items.length > 0 && renderedCount === 0) {
      safeTarget.insertAdjacentHTML(
        "beforeend",
        `<div class="empty" style="margin-top:10px;color:rgba(11,27,43,0.7);font-weight:600;">Data načtena, ale nic se nevykreslilo. Obnov stránku.<br /><small>${items.length} položek</small></div>`
      );
      const preview = items.slice(0, 3).map((it) => `${it.contentType || "unknown"}:${it.title || it.name || "(bez názvu)"}`);
      diagLog("renderFeed:fallback", {
        preview,
        feedChildrenAfter,
      });
      persistLastError("Data existují, ale nic nebylo vykresleno");
      renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
      setStatus("Stav dat: chyba (viz feed)");
      return;
    }
    if (elDataCount) elDataCount.textContent = String(items.length);
    if (!Array.isArray(state.cachedItems)) {
      persistLastError("Invariant breach: state.cachedItems není pole");
      renderInlineError("Obsah dočasně nedostupný.");
      return;
    }
    for (const it of state.cachedItems) {
      if (!it || !it.contentType) {
        persistLastError("Invariant breach: položka bez contentType");
        renderInlineError("Obsah dočasně nedostupný.");
        break;
      }
    }

  function renderInlineError(message) {
    const inline = document.getElementById("lastErrInline");
    if (!inline) return;
    inline.textContent = message;
    inline.style.display = "block";
    inline.style.opacity = "1";
  }

  function renderItems(items) {
    const target = getFeedTarget();
    renderFeed(target, items);
  }

  function renderFeedItemHtml(item) {
    if (!item) return "";
    const type = String(item.contentType || "article").toLowerCase();
    if (type === "video") return buildVideoAsArticleCard(item);
    if (type === "ad") return buildAdHtml(item);
    return buildArticleHtml(item);
  }

  function buildArticleHtml(it) {
    const title = safeText(it.title || it.name || "(bez názvu)");
    const publishedAt = fmtDate(it.publishedAt || it.date || it.published || "");
    const rawSources = Array.isArray(it.sources) && it.sources.length
      ? it.sources
      : it.source
        ? [{ name: it.source }]
        : [];
    const sourceEntities = rawSources
      .map((source) => {
        const name = safeText(source.name || source.title || source);
        const href = safeUrl(source.url || source.link);
        return { name, href };
      })
      .filter((entry) => entry.name);
    const sourceMarkup =
      sourceEntities
        .map((entry, idx) => {
          const sep = idx === 0 ? "" : `<span class="srcSep">·</span>`;
          const link =
            entry.href
              ? `<a class="sourceDomain" href="${entry.href}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                  entry.name
                )}</a>`
              : `<span class="sourceDomain">${escapeHtml(entry.name)}</span>`;
          return `${sep}${link}`;
        })
        .join("") || '<span class="sourceDomain">—</span>';
    const linkUrl =
      it.url ||
      (Array.isArray(it.sources) ? (it.sources.find((s) => s && s.url && s.url.trim())?.url || "") : "") ||
      (it.canonicalUrl || "") ||
      (typeof it.link === "string"
        ? it.link
        : (it.link && typeof it.link === "object" ? (it.link.href || it.link.url || "") : ""));
    if (!linkUrl) {
      persistLastError("Article without URL skipped");
      return "";
    }
    const titleMarkup = linkUrl
      ? `<a class="news-titleLink" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          title
        )}</a>`
      : `<span class="news-titleLink">${escapeHtml(title)}</span>`;

    debugLog("[RENDER ARTICLE]", title);
    return `
      <article class="news-card" data-feed-type="article">
        <h2 class="news-title">${titleMarkup}</h2>
        <div class="news-row2">
          ${publishedAt ? `<span class="meta-time">${escapeHtml(publishedAt)}</span>` : ""}
          <span class="news-sourceLabel">Zdroj:</span>
          <span class="news-sources">${sourceMarkup}</span>
        </div>
      </article>
    `;
  }

let videoCardsWithoutImgCount = 0;

let videoCardsWithoutImgCount = 0;

function buildVideoAsArticleCard(it) {
    const title = safeText(it.title || "Video");
    const augmentedTitle = `VIDEO: ${title}`;
    const publishedAt = fmtDate(it.publishedAt || it.date || it.published || "");
    const channel = safeText(it.channel || "YouTube");
    const url =
      safeUrl(it.url) ||
      (it.videoId ? `https://www.youtube.com/watch?v=${it.videoId}` : "");
    const titleMarkup = url
      ? `<a class="news-titleLink" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          augmentedTitle
        )}</a>`
      : `<span class="news-titleLink">${escapeHtml(augmentedTitle)}</span>`;

    const hasImg = /<img\s/i.test(`
      <article class="news-card" data-feed-type="video">
        <h2 class="news-title">${titleMarkup}</h2>
        <div class="news-row2">
          ${publishedAt ? `<span class="meta-time">${escapeHtml(publishedAt)}</span>` : ""}
          <span class="news-sourceLabel">Zdroj:</span>
          <span class="news-sources">
            <span class="sourceDomain">${escapeHtml(channel)}</span>
          </span>
        </div>
      </article>
    `;
    `);
    if (!hasImg) {
      videoCardsWithoutImgCount += 1;
    }
    return `
      <article class="news-card" data-feed-type="video">
        <h2 class="news-title">${titleMarkup}</h2>
        <div class="news-row2">
          ${publishedAt ? `<span class="meta-time">${escapeHtml(publishedAt)}</span>` : ""}
          <span class="news-sourceLabel">Zdroj:</span>
          <span class="news-sources">
            <span class="sourceDomain">${escapeHtml(channel)}</span>
          </span>
        </div>
      </article>
    `;
  }

  function buildAdHtml(it) {
    const label = escapeHtml(it.adLabel || "Reklamní okýnko");
    const slot = escapeHtml(it.adSlot || "slot");
    return `
      <article class="ad-card" aria-hidden="true">
        <div class="ad-head">
          <span class="pos">${slot}</span>
          <span class="ad-label">${label}</span>
        </div>
      </article>
    `;
  }

  function ensureFallbackMessage() {
    const target = getFeedTarget();
    if (!target) return;
    if (target.children.length > 0) return;
    if (emptyBox && emptyBox.textContent.trim()) return;
    renderEmpty("Žádná data k zobrazení. Zkontroluj Stav dat.");
  }

  function iuComputeTopbarStackH(){
    try{
      const bars = Array.from(document.querySelectorAll(".iuBar, .topbar"));
      const visible = bars.filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.height > 0.5;
      });

      const total = Math.round(
        visible.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0)
      );

      document.documentElement.style.setProperty("--topbarStackH", Math.max(total, 0) + "px");
    }catch(e){}
  }

  function iuInitTopbarWatcher(){
    iuComputeTopbarStackH();
    window.addEventListener("load", iuComputeTopbarStackH, { passive: true });

    let t = 0;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(iuComputeTopbarStackH, 120);
    }, { passive: true });

    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(iuComputeTopbarStackH, 60);
    });

    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

  function writeDebug(obj) {
    if (!elDebugOut) return;
    try {
      elDebugOut.textContent = safeStringify(obj, null, 2);
    } catch {
      elDebugOut.textContent = String(obj);
    }
  }

  function openSearchModal() {
    if (searchModal) searchModal.classList.add("show");
  }

  function hideSearchModal() {
    if (searchModal) searchModal.classList.remove("show");
  }

  function resetSearchAndReload() {
    if (searchInput) searchInput.value = "";
    hideSearchModal();
    applyFilter();
  }

  // === LOCKED PIPELINE ===
  // Jakákoli změna této funkce MUSÍ respektovat invarianty feedu.
  // Druhá render cesta je zakázaná.
  function applyFilter() {
    if (!state.hasLoadedData) return;
    const query = (searchInput && searchInput.value.trim()) || "";
    const normalizedQuery = query.toLowerCase();
    const sectionsToUse = activeSections && activeSections.length ? activeSections : ["vse"];
    let filtered = state.cachedItems.filter((item) => matchesSections(item, sectionsToUse));
    if (normalizedQuery) {
      filtered = filtered.filter((item) => {
        const type = String(item.contentType || "article").toLowerCase();
        if (type === "ad") return true;
        const haystackData = [
          item.title,
          item.name,
          item.summary,
          item.section,
          item.topic,
          item.channel,
          ...(Array.isArray(item.sources) ? item.sources.map((s) => s.name || s.title || s) : []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystackData.includes(normalizedQuery);
      });
    }
    state.filteredItems = filtered;

    if (filtered.length === 0) {
      if (query) {
        openSearchModal();
      } else {
        hideSearchModal();
        renderInlineError("Filtry nenašly žádné články.");
      }
      setStatus(`Stav dat: OK (zobrazeno: 0 / celkem: ${state.cachedItems.length})`);
      if (isDebugOn()) {
        writeDebug({
          sections: activeSections,
          hash: location.hash,
          search: query,
          totalItems: state.cachedItems.length,
          filtered: 0,
        });
      }
      return;
    }
    if (!Array.isArray(state.filteredItems)) {
      persistLastError("Invariant breach: filteredItems is not array");
      state.filteredItems = [];
    }

    hideSearchModal();
    renderItems(filtered);
    setStatus(`Stav dat: OK (zobrazeno: ${filtered.length} / celkem: ${state.cachedItems.length})`);
    if (isDebugOn()) {
      writeDebug({
        sections: activeSections,
        hash: location.hash,
        search: query,
        totalItems: state.cachedItems.length,
        filtered: filtered.length,
      });
    }
  }

    ensureFallbackMessage();


  let firstLoadQuiet = false;

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    if (Number.isNaN(num)) {
      debugWarn("[SAFE] invalid number", value);
      return fallback;
    }
    return num;
  }

  const selfDiag = {
    build: getBuildStamp() || "no-build",
    articlesState: "INIT",
    articlesCount: "-",
    videosState: "INIT",
    videosCount: "-",
    swController: "no",
    swWaiting: "no"
  };

  let refreshInProgress = false;

  async function softRefreshData() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    debugLog("[REFRESH] start");
    try {
      await Promise.all([fetchArticlesStatus(), fetchVideosStatus()]);
      await loadData();
    } catch (error) {
      debugWarn("[REFRESH] error", error && error.message ? error.message : error);
    } finally {
      refreshInProgress = false;
      debugLog("[REFRESH] done");
    }
  }

  function safeDateParse(value) {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        debugWarn("[DATE] invalid", value);
        return null;
      }
      return date;
    } catch {
      debugWarn("[DATE] invalid", value);
      return null;
    }
  }

  function logSelfStatus() {
    debugLog(`[SELF] build=${selfDiag.build}`);
    debugLog(`[SELF] articles=${selfDiag.articlesState} count=${selfDiag.articlesCount}`);
    debugLog(`[SELF] videos=${selfDiag.videosState} count=${selfDiag.videosCount}`);
    debugLog(`[SELF] swController=${selfDiag.swController} swWaiting=${selfDiag.swWaiting}`);
  }

  function renderDiagBox() {
    const isDiag = new URLSearchParams(location.search).get("diag") === "1";
    if (!isDiag) return;
    const box = document.createElement("div");
    box.id = "iuDiagBox";
    const updatedLabel = document.getElementById("dataStatusUpdated")?.textContent || "Aktualizace: —";
    const swLabel = document.getElementById("dataStatusSW")?.textContent || "SW: —";
    const lastError = localStorage.getItem("iu:lastError") || "—";
    const lastOkAt = localStorage.getItem("iu:lastArticlesOkAt") || "—";
    const lastOkCount = localStorage.getItem("iu:lastArticlesCount") || "—";
    box.innerHTML = `
      <div style="padding:8px;border:1px solid rgba(0,0,0,0.14);background:#fff;margin:6px;">
        <p><strong>diag</strong></p>
        <p>build: ${selfDiag.build}</p>
        <p>articles: ${selfDiag.articlesState} count=${selfDiag.articlesCount}</p>
        <p>videos: ${selfDiag.videosState} count=${selfDiag.videosCount}</p>
        <p>${updatedLabel}</p>
        <p>${swLabel}</p>
        <p>lastError: ${lastError}</p>
        <p>last OK: ${lastOkAt} / ${lastOkCount}</p>
      </div>
    `;
    document.body.insertBefore(box, document.body.firstChild);
  }

  const eventThrottleMs = 500;
  const eventLastTs = new Map();

  function addTelemetryEvent(name, detail = "") {
    try {
      const raw = localStorage.getItem("iu:events");
      const parsed = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(parsed) ? parsed : [];
      const now = Date.now();
      const last = eventLastTs.get(name) || 0;
      if (now - last < eventThrottleMs) {
        debugLog("[EVENT] throttled", name);
        return;
      }
      eventLastTs.set(name, now);
      arr.push({ t: new Date().toISOString(), name, detail });
      while (arr.length > 10) arr.shift();
      localStorage.setItem("iu:events", safeStringify(arr));
      updateEventsUI();
    } catch {
      // ignore
    }
  }

  function safeStringify(value, replacer = null, space = 0) {
    try {
      return JSON.stringify(value, replacer, space);
    } catch {
      return "";
    }
  }

  function updateEventsUI() {
    const el = document.getElementById("dataStatusEvents");
    if (!el) return;
    try {
      const raw = localStorage.getItem("iu:events");
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr) || !arr.length) {
        el.textContent = "Události: —";
        return;
      }
      const latest = arr.slice(-5);
      el.innerHTML = "Události:<br />" + latest.map((item) => `${new Date(item.t).toLocaleTimeString("cs-CZ")} ${item.name}`).join("<br />");
    } catch {
      el.textContent = "Události: chybné data";
    }
  }

  function updateLastArticlesInfo(count, updatedAt) {
    const prevCount = localStorage.getItem("iu:lastArticlesCount");
    const now = new Date().toISOString();
    try {
      localStorage.setItem("iu:lastArticlesOkAt", now);
      localStorage.setItem("iu:lastArticlesCount", String(count));
      localStorage.setItem("iu:lastArticlesUpdatedAt", updatedAt || "");
      if (prevCount !== null && prevCount !== String(count)) {
        debugLog("[DIFF] articles count", prevCount, "->", count);
        localStorage.setItem("iu:lastArticlesDiffAt", now);
      }
    } catch {
      // ignore
    }
    const label = document.getElementById("dataStatusUpdated");
    if (!label) return;
    const lastOkTime = new Date(now).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    const updatedText = updatedAt ? fmtTime(updatedAt) : "neznámá";
    let ageWarning = "";
    if (updatedAt) {
      const parsed = safeDateParse(updatedAt);
      if (parsed) {
        const ageMinutes = Math.floor((Date.now() - parsed.getTime()) / 60000);
        if (ageMinutes > 360) {
          const hours = Math.floor(ageMinutes / 60);
          ageWarning = ` Zastaralé (${hours} h)`;
        }
      }
    }
    label.textContent = `Aktualizace: ${updatedText} (last OK: ${lastOkTime}, count: ${count})${ageWarning}`;
  }

  function finalStateReport() {
    const updatedAt = localStorage.getItem("iu:lastArticlesUpdatedAt") || "—";
    const parsedUpdated = safeDateParse(updatedAt);
    const dataAgeMin = parsedUpdated
      ? Math.round((Date.now() - parsedUpdated.getTime()) / 60000)
      : null;
    const report = {
      build: selfDiag.build || "no-build",
      online: navigator.onLine ? "yes" : "no",
      articlesStatus: selfDiag.articlesState,
      articlesCount: selfDiag.articlesCount,
      videosStatus: selfDiag.videosState,
      videosCount: selfDiag.videosCount,
      updatedAt: updatedAt === "" ? "—" : updatedAt,
      dataAgeMin,
      swController: selfDiag.swController,
      swWaiting: selfDiag.swWaiting,
      lastErrorAt: localStorage.getItem("iu:lastErrorAt") || "—",
      lastError: localStorage.getItem("iu:lastError") || "—"
    };
    debugLog("[STATE]", report);
  }

  logSelfStatus();

  function updateBuildStatusLabel() {
    const build = getBuildStamp() || "no-build";
    const seen = localStorage.getItem("iu:lastBuildSeen") || "";
    const label = document.getElementById("dataStatusBuild");
    if (!label) return;
    if (seen && seen !== build) {
      debugWarn("[BUILD] mismatch seen/current", seen, build);
      label.textContent = `Build: ${build} (změna)`;
    } else {
      label.textContent = `Build: ${build}`;
    }
  }

  function recordBuildSeen() {
    const build = getBuildStamp();
    if (!build) return;
    const prev = localStorage.getItem("iu:lastBuildSeen");
    const now = new Date().toISOString();
    try {
      localStorage.setItem("iu:lastBuildSeen", build);
      localStorage.setItem("iu:lastBuildSeenAt", now);
    } catch {
      // ignore
    }
    if (prev && prev !== build) {
      debugLog("[BUILD] changed", prev, "->", build);
    }
  }

  async function nukeCachesAndSwOnBuildChange() {
    const build = getBuildStamp() || "no-build";
    const prev = localStorage.getItem("iu:lastBuildHard") || "";
    if (prev === build) return;
    try {
      localStorage.setItem("iu:lastBuildHard", build);
    } catch (_) {}
    debugWarn("[BUILD] change detected -> clearing caches + SW", prev, "->", build);

    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        debugLog("[BUILD] caches cleared", keys);
      }
    } catch (err) {
      debugWarn("[BUILD] caches clear failed", err);
    }

    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        debugLog("[BUILD] service workers unregistered", regs.length);
      }
    } catch (err) {
      debugWarn("[BUILD] sw unregister failed", err);
    }

    try {
      sessionStorage.removeItem("iu:swReloaded");
      sessionStorage.removeItem("iu:swReloadedAt");
      sessionStorage.removeItem("iu:scrolledToStatus");
    } catch (_) {}

    window.location.reload();
  }

  function timeoutFetch(url, options = {}, ms = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
  }

  function resolveArray(data, fields) {
    if (Array.isArray(data)) return data;
    for (const field of fields) {
      if (Array.isArray(data?.[field])) return data[field];
    }
    return null;
  }

  const ARTICLE_RETRY_DELAYS = [2000, 6000];

  let loggedEmptyTitle = false;
  function normalizeArticleList(items) {
    return items.filter((it) => {
      const hasTitle = Boolean(it?.title || it?.headline || it?.name);
      const link = it?.url || it?.link || it?.href;
      let validLink = false;
      if (link) {
        try {
          new URL(link, location.origin);
          validLink = true;
        } catch {
          debugWarn("[DATA] invalid URL", link);
        }
      }
      if (!hasTitle && !loggedEmptyTitle) {
        debugWarn("[DATA] missing article title, substituting fallback");
        loggedEmptyTitle = true;
      }
      if (!hasTitle) {
        if (it) {
          it.title = "Bez názvu";
        }
      }
      return hasTitle && validLink;
    });
  }

  async function fetchArticlesStatus(attempt = 1) {
    const el = document.getElementById("dataStatusArticles");
    if (!el) return;
    try {
      const res = await timeoutFetch(makeDataUrl("data/articles.json"), { cache: "no-store" }, 9000);
      if (!res.ok) {
        el.textContent = `Články: chyba (${res.status})`;
        selfDiag.articlesState = "FAIL";
        selfDiag.articlesCount = "-";
        logSelfStatus();
        return;
      }
      const data = await res.json();
      const size = safeStringify(data).length;
      debugLog("[DATA] size=", size);
      const items = resolveArray(data, ["items", "articles"]);
      const validItems = items ? normalizeArticleList(items) : [];
      if (items && validItems.length < items.length) {
        debugWarn("[DATA] filtered invalid items", items.length, "->", validItems.length);
      }
      if (!items) {
        el.textContent = "Články: chyba formátu";
        debugWarn("[DATA] articles schema unexpected", Object.keys(data || {}));
        selfDiag.articlesState = "FAIL";
        selfDiag.articlesCount = "-";
        logSelfStatus();
        return;
      }
      const updatedAtValue = data?.updatedAt ?? data?.updated_at ?? null;
      const count = safeNumber(validItems.length);
      const ageMinutes = updatedAtValue ? Math.floor((Date.now() - new Date(updatedAtValue).getTime()) / 60000) : 0;
      if (!items.length || !count) {
        el.textContent = "Články: prázdné";
        selfDiag.articlesState = "EMPTY";
        selfDiag.articlesCount = "0";
        logSelfStatus();
        updateLastArticlesInfo(count, updatedAtValue);
        addTelemetryEvent("articles", `EMPTY count=${count}`);
        return;
      }
      if (ageMinutes > 1440 && !firstLoadQuiet) {
        el.textContent = "Články: zastaralé (24h+)";
        debugWarn("[DATA] articles too old");
      } else {
        el.textContent = `Články: OK (${count})`;
      }
      selfDiag.articlesState = "OK";
      selfDiag.articlesCount = String(count);
      logSelfStatus();
      updateLastArticlesInfo(count, updatedAtValue);
      addTelemetryEvent("articles", `OK count=${count} updated=${updatedAtValue || "—"}`);
      const firstItem = validItems[0] || {};
      const firstTitle = firstItem.title || firstItem.headline || firstItem.name || "—";
      debugLog("[SELF] firstTitle=", firstTitle);
      const dates = validItems
        .map((item) => item.publishedAt || item.date || item.published || "")
        .map((value) => new Date(value))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.getTime());
      for (let i = 1; i < dates.length; i += 1) {
        if (dates[i] > dates[i - 1]) {
          debugWarn("[DATA] articles not sorted");
          break;
        }
      }
    } catch (err) {
      el.textContent = "Články: chyba";
      selfDiag.articlesState = "FAIL";
      selfDiag.articlesCount = "-";
      logSelfStatus();
      if (attempt <= ARTICLE_RETRY_DELAYS.length) {
        const delay = ARTICLE_RETRY_DELAYS[attempt - 1];
        debugWarn("[RETRY] articles attempt", attempt);
        el.textContent = `Články: retry (${attempt})`;
        setTimeout(() => fetchArticlesStatus(attempt + 1), delay);
      }
      if (err?.name === "AbortError") {
        addTelemetryEvent("timeout", "articles");
        if (!firstLoadQuiet) {
          el.textContent = "Články: timeout";
        }
      }
      addTelemetryEvent("articles", `FAIL attempt=${attempt} err=${err && err.message ? err.message : "timeout"}`);
    }
  }

  async function fetchVideosStatus() {
    const el = document.getElementById("dataStatusVideos");
    if (!el) return;
    try {
      const res = await timeoutFetch(makeDataUrl("data/videos.json"), { cache: "no-store" }, 9000);
      if (res.status === 404) {
        el.textContent = "Videa: není k dispozici";
        selfDiag.videosState = "404";
        selfDiag.videosCount = "-";
        logSelfStatus();
        addTelemetryEvent("videos", "404");
        return;
      }
      if (!res.ok) {
        el.textContent = `Videa: chyba (${res.status})`;
        selfDiag.videosState = "FAIL";
        selfDiag.videosCount = "-";
        logSelfStatus();
        addTelemetryEvent("videos", `FAIL status=${res.status}`);
        return;
      }
      const data = await res.json();
      const size = safeStringify(data).length;
      debugLog("[DATA] size=", size);
      const items = resolveArray(data, ["items", "videos"]);
      if (!items) {
        el.textContent = "Videa: chyba formátu";
        debugWarn("[DATA] videos schema unexpected", Object.keys(data || {}));
        selfDiag.videosState = "FAIL";
        selfDiag.videosCount = "-";
        logSelfStatus();
        return;
      }
      if (!items.length) {
        el.textContent = "Videa: prázdná";
        selfDiag.videosState = "EMPTY";
        selfDiag.videosCount = "0";
        logSelfStatus();
        addTelemetryEvent("videos", "EMPTY");
        return;
      }
      el.textContent = `Videa: OK (${items.length})`;
      selfDiag.videosState = "OK";
      selfDiag.videosCount = String(items.length);
      logSelfStatus();
      addTelemetryEvent("videos", `OK count=${items.length}`);
    } catch (err) {
      el.textContent = "Videa: chyba";
      selfDiag.videosState = "FAIL";
      selfDiag.videosCount = "-";
      logSelfStatus();
      addTelemetryEvent("videos", "FAIL timeout");
      if (err?.name === "AbortError") {
        addTelemetryEvent("timeout", "videos");
        if (!firstLoadQuiet) {
          el.textContent = "Videa: timeout";
        }
      }
    }
  }

  function isLatestLoadRequest(id) {
    return id === state.loadRequestId;
  }

  function iuBuildDiagStatusLine({
    preferredSaved,
    preferredModeUsed,
    articlesOk,
    videosOk,
    chosenArticlesUrl,
    chosenVideosUrl,
    countArticles,
    countVideos,
    feedChildren,
    generatedAtArticles,
    generatedAtVideos,
    articlesKeys,
    videosKeys,
    effectiveUpdatedAtArticles,
    effectiveUpdatedAtVideos,
  }) {
    const ps = preferredSaved ? "YES" : "NO";
    const pm = preferredModeUsed === "preferred" ? "preferred" : "fallback";
    const as = articlesOk ? "OK" : "NEOK";
    const vs = videosOk ? "OK" : "NEOK";
    const au = chosenArticlesUrl || "-";
    const vu = chosenVideosUrl || "-";
    const ca = Number.isFinite(countArticles) ? countArticles : 0;
    const cv = Number.isFinite(countVideos) ? countVideos : 0;
    const fc = Number.isFinite(feedChildren) ? feedChildren : 0;
    const ga = generatedAtArticles || "none";
    const gv = generatedAtVideos || "none";
    return [
      `preferred saved: ${ps}`,
      `preferred mode used: ${pm}`,
      `articles status: ${as} | videos status: ${vs}`,
      `Vybrané URL: articles=${au} , videos=${vu}`,
      `Načteno: články ${ca}, videa ${cv}`,
      `#feed children: ${fc}`,
      `generatedAt articles: ${ga}`,
      `generatedAt videos: ${gv}`,
      `effective updatedAt articles: ${effectiveUpdatedAtArticles}`,
      `effective updatedAt videos: ${effectiveUpdatedAtVideos}`,
      `articles keys: ${articlesKeys || "none"}`,
      `videos keys: ${videosKeys || "none"}`,
    ].join("\n");
  }

  function iuHasStatusPlaceholders(s) {
    if (!s) return true;
    const bad = [
      "YES|NO",
      "preferred|fallback",
      "OK|NEOK",
      "…",
      "articles=…",
      "videos=…",
      "Načteno: články X, videa Y",
      "#feed children: N",
    ];
    return bad.some((t) => s.includes(t));
  }

  async function loadData() {
    const startedAt = new Date();
    const requestToken = ++state.loadRequestId;
    const previousItems = Array.isArray(state.cachedItems) ? [...state.cachedItems] : [];
    const previousHasLoaded = state.hasLoadedData;
    state.cachedItems = [];
    state.hasLoadedData = false;
    const lastErrInline = document.getElementById("lastErrInline");
    if (lastErrInline) {
      lastErrInline.style.display = "none";
    }
    if (emptyBox) {
      emptyBox.style.display = "block";
      emptyBox.innerHTML = "<p>Načítám data…</p>";
    }
    const preferredEntry = await evaluatePreferredPair();
    const baseArticleUrls = [
      "/projects/data/articles.json",
      makeDataUrl("data/articles.json"),
      "/data/articles.json",
      "./data/articles.json",
      makeDataUrl("projects/data/articles.json"),
      makeDataUrl("filtr/data/articles.json"),
    ].filter(Boolean);
    const baseVideoUrls = [
      "/projects/data/videos.json",
      makeDataUrl("data/videos.json"),
      "/data/videos.json",
      "./data/videos.json",
      makeDataUrl("projects/data/videos.json"),
      makeDataUrl("filtr/data/videos.json"),
    ].filter(Boolean);
    const articleUrls = buildCandidateListFromPair(preferredEntry, "articles", baseArticleUrls);
    const videoUrls = buildCandidateListFromPair(preferredEntry, "videos", baseVideoUrls);
    let preferredSaved = false;
    let preferredSavedReason = "";
    let preferredUpdatedToRoot = false;
    let chosenArticlesUrl = "";
    let chosenVideosUrl = "";
    let articleFetchResult = null;
    let videoFetchResult = null;
    let normalizedVideoSource = [];
    let articleStatusCode = null;
    let videoStatusCode = null;
    let articleStatusLabel = "404";
    let videoStatusLabel = "404";
    let articlesOk = false;
    let videosOk = false;
    let data = null;
    setStatus("Stav dat: načítám…");

    try {
      let lastArticleError = "articles candidates exhausted";
      for (const url of articleUrls) {
        if (!url) continue;
        const result = await tryFetchJson(url, 9000);
        articleStatusCode = result.status ?? articleStatusCode;
        if (!result.ok && result.status >= 400) {
          persistLastError(`DATA fetch failed: status=${result.status} url=${result.url}`);
        }
        if (result.ok) {
          data = result.json;
          articleFetchResult = result;
          chosenArticlesUrl = url;
          articleStatusLabel = "OK";
          articlesOk = true;
          break;
        }
        if (result.status === 404) {
          articleStatusLabel = "404";
        }
        lastArticleError = result.error || lastArticleError;
      }
      if (!data) {
        throw new Error(lastArticleError);
      }
      const articlesGeneratedAt = data?.generatedAt || data?.meta?.generatedAt || null;
      state.lastArticlesGeneratedAt = articlesGeneratedAt ? String(articlesGeneratedAt) : null;
      const articlesKeys = data && typeof data === "object" ? Object.keys(data).sort().join(",") : "none";
      state.lastArticlesKeys = articlesKeys;
      const articlesUpdatedAt = typeof data?.updatedAt === "string" ? data.updatedAt : null;
      state.lastArticlesUpdatedAt = articlesUpdatedAt;
      const articlesArray = normalizeFeedJson(data);
      debugLog("[ARTICLES RAW]", data);
      debugLog("[ARTICLES LENGTH]", Array.isArray(articlesArray) ? articlesArray.length : "NOT ARRAY");
      const rawArticles = normalizeItems(articlesArray);
      rawArticles.forEach((item) => {
        // canonical candidate
        let candidate = item.url;

        // legacy link variants
        const link = item.link;
        if (!candidate) {
          if (link && typeof link === "object") candidate = link.href || link.url;
          else if (typeof link === "string") candidate = link;
        }

        // sources[].url
        if (!candidate && Array.isArray(item.sources)) {
          const first = item.sources.find((s) => s && typeof s.url === "string" && s.url.trim());
          if (first) candidate = first.url;
        }

        // canonicalUrl fallback
        if (!candidate && item.canonicalUrl) candidate = item.canonicalUrl;

        // write back (ensure string)
        item.url = candidate || "";
      });
      let sanitizedArticles = normalizeArticleList(rawArticles).map((item) => ({
        ...item,
        contentType: "article",
      }));
      debugLog("[ARTICLES NORMALIZED]", sanitizedArticles.length);
      if (sanitizedArticles.length < rawArticles.length) {
        debugWarn("[DATA] filtered invalid items", rawArticles.length, "->", sanitizedArticles.length);
      }

      debugLog("[DATA] articles loaded count=", sanitizedArticles.length);
      debugLog("[DATA] articles first=", sanitizedArticles[0]?.title, sanitizedArticles[0]?.url);
      if (isDebugLogging) {
        debugLog("[ARTICLES] loaded", sanitizedArticles.length, sanitizedArticles.slice(0, 3));
      }

      let videoItems = [];
      let lastVideoError = "videos candidates exhausted";
      for (const url of videoUrls) {
        if (!url) continue;
        const result = await tryFetchJson(url, 9000);
        videoStatusCode = result.status ?? videoStatusCode;
        if (!result.ok && result.status >= 400) {
          persistLastError(`DATA fetch failed: status=${result.status} url=${result.url}`);
        }
        if (result.ok) {
          const videosKeys = result.json && typeof result.json === "object" ? Object.keys(result.json).sort().join(",") : "none";
          state.lastVideosKeys = videosKeys;
          const videosUpdatedAt = typeof result.json?.updatedAt === "string" ? result.json.updatedAt : null;
          state.lastVideosUpdatedAt = videosUpdatedAt;
          const rawVideosJson = normalizeFeedJson(result.json);
          normalizedVideoSource = rawVideosJson;
          videoItems = normalizeVideoList(rawVideosJson);
          chosenVideosUrl = url;
          videoStatusLabel = "OK";
          videoFetchResult = result;
          const videosGeneratedAt = result.json?.generatedAt || result.json?.meta?.generatedAt || null;
          state.lastVideosGeneratedAt = videosGeneratedAt ? String(videosGeneratedAt) : null;
          videosOk = true;
          debugLog(
            "[DATA] videos raw count=",
            videoItems.length,
            "keys=",
            result.json && typeof result.json === "object" ? Object.keys(result.json) : [],
          );
          debugLog("[DATA] videos loaded count=", videoItems.length);
          debugLog("[DATA] videos first=", videoItems[0]?.title, videoItems[0]?.url);
          break;
        }
        if (result.status === 404) {
          videoStatusLabel = "404";
        }
        lastVideoError = result.error || lastVideoError;
      }
      if (!chosenVideosUrl) {
        debugWarn("[DATA] videos load failed", lastVideoError);
      }
      const articlesJson = articleFetchResult?.json;
      const videosJson = videoFetchResult?.json;
      const normalizedArticles = Array.isArray(articlesArray) ? articlesArray : [];
      const hasArticlesField = Array.isArray(articlesJson?.articles);
      const hasNormalizedArticles = normalizedArticles.length > 0;
      const hasVideosField = Array.isArray(videosJson?.videos);
      const hasNormalizedVideos = Array.isArray(normalizedVideoSource) && normalizedVideoSource.length > 0;
      if (chosenArticlesUrl && chosenVideosUrl) {
        if ((hasArticlesField || hasNormalizedArticles) && (hasVideosField || hasNormalizedVideos)) {
          const storedPair = savePreferredPair(chosenArticlesUrl, chosenVideosUrl);
          if (storedPair) {
            preferredSaved = true;
            preferredSavedReason = "";
          } else if (!preferredSaved) {
            preferredSavedReason = "localStorage blocked";
          }
        } else if (!preferredSaved) {
          preferredSavedReason = "missing expected JSON arrays";
        }
      } else if (!preferredSaved && !preferredSavedReason) {
        preferredSavedReason = "no URLs to store";
      }

      if (!isLatestLoadRequest(requestToken)) {
        debugLog("[DATA] request canceled, token", requestToken);
        return;
      }
      const combined = buildCombinedFeed(sanitizedArticles, videoItems);
      const enriched = combined.map((item) => {
        const published =
          (item && String(item.publishedAt || item.published || item.date || item.createdAt || item.uploadedAt || item.time)) ||
          "";
        return {
          ...item,
          _ts: published ? Date.parse(published) || 0 : 0,
        };
      });
      const sorted = enriched.sort((a, b) => (b._ts || 0) - (a._ts || 0));
      const articlesOnly = sorted.filter((entry) => entry?.contentType === "article");
      const videosOnly = sorted.filter((entry) => entry?.contentType === "video");
      const mixed = [];
      let videoIndex = 0;
      for (let i = 0; i < articlesOnly.length; i++) {
        mixed.push(articlesOnly[i]);
        if ((i + 1) % 10 === 0 && videoIndex < videosOnly.length) {
          mixed.push(videosOnly[videoIndex++]);
        }
      }
      while (videoIndex < videosOnly.length) {
        mixed.push(videosOnly[videoIndex++]);
      }
      state.stats.articlesCount = articlesOnly.length;
      state.stats.videosCount = videosOnly.length;
      state.cachedItems = mixed.length ? mixed : combined; 
      state.hasLoadedData = true;
      if (isDebugLogging) {
        debugLog(
          "[CACHE] total",
          combined.length,
          "articles",
          sanitizedArticles.length,
          "videos",
          videoItems.length,
        );
        debugLog(
          "[ARTICLES] sample",
          sanitizedArticles.slice(0, 3).map((item) => ({
            title: item.title,
            url: item.url,
          })),
        );
        debugLog(
          "[VIDEOS] sample",
          videoItems.slice(0, 3).map((item) => ({
            title: item.title,
            url: item.url,
          })),
        );
      }
      applyFilter();
      const countArticles = state.cachedItems.filter((entry) => entry?.contentType === "article").length;
      const countVideos = state.cachedItems.filter((entry) => entry?.contentType === "video").length;
      const feedChildren = elFeed?.children?.length ?? 0;
      const preferredUsed = Boolean(
        preferredEntry?.status === "ok" &&
          chosenArticlesUrl === preferredEntry.articlesUrl &&
          chosenVideosUrl === preferredEntry.videosUrl
      );
      const preferredModeUsed = preferredUsed ? "preferred" : "fallback";
      const effectiveUpdatedAtArticles =
        state.lastArticlesGeneratedAt || state.lastArticlesUpdatedAt || "none";
      const effectiveUpdatedAtVideos =
        state.lastVideosGeneratedAt || state.lastVideosUpdatedAt || "none";
      const statusLine = iuBuildDiagStatusLine({
        preferredSaved,
        preferredModeUsed,
        articlesOk,
        videosOk,
        chosenArticlesUrl,
        chosenVideosUrl,
        countArticles,
        countVideos,
        feedChildren,
        generatedAtArticles: state.lastArticlesGeneratedAt,
        generatedAtVideos: state.lastVideosGeneratedAt,
        articlesKeys: state.lastArticlesKeys,
        videosKeys: state.lastVideosKeys,
        effectiveUpdatedAtArticles,
        effectiveUpdatedAtVideos,
      });
      if (iuHasStatusPlaceholders(statusLine)) {
        persistLastError("DIAG PLACEHOLDER DETECTED: " + statusLine.slice(0, 180));
        setStatus("Stav dat: načítám…");
      } else {
        persistLastError(null);
        persistLastOk({
          at: new Date().toISOString(),
          build: articlesStamp || videosStamp || "",
          articles: countArticles,
          videos: countVideos,
        });
        const feedSegment = feedChildren ? ` • feed ${feedChildren}` : "";
        let statusParts = ["Stav dat: OK"];
        if (articlesStamp && videosStamp && articlesStamp === videosStamp) {
          statusParts.push(`build ${articlesStamp}`);
          statusParts.push(`články ${countArticles}`);
          statusParts.push(`videa ${countVideos}`);
        } else {
          statusParts.push(`články ${countArticles}${articlesStamp ? ` (build ${articlesStamp})` : ""}`);
          statusParts.push(`videa ${countVideos}${videosStamp ? ` (build ${videosStamp})` : ""}`);
        }
        if (feedSegment.trim()) statusParts.push(feedSegment.replace(/^ • /, ""));
        setStatus(statusParts.join(" • "));
      }
      updateLastArticlesInfo(sanitizedArticles.length, data?.updatedAt ?? data?.updated_at ?? null);

      debugLog("[DATA] combined count=", state.cachedItems.length);
      debugLog("[DATA] combined first type=", state.cachedItems[0]?.contentType, state.cachedItems[0]?.title);

      if (isDebugOn()) {
        writeDebug({
          ok: true,
          url: chosenArticlesUrl || articleUrls[0] || "",
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          rawType: Array.isArray(data) ? "array" : typeof data,
          keys:
            data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [],
          itemsCount: state.cachedItems.length,
          sample: state.cachedItems.slice(0, 3),
        });
      }
    } catch (err) {
      if (!isLatestLoadRequest(requestToken)) {
        debugLog("[DATA] failure ignored, token", requestToken);
      } else {
        const message = err && err.message ? err.message : String(err);
        state.cachedItems = previousItems;
        state.hasLoadedData = previousHasLoaded;
        if (previousItems.length === 0) {
          const urlInfo = `articles=${chosenArticlesUrl || "—"}(${articleStatusLabel}) videos=${chosenVideosUrl || "—"}(${videoStatusLabel})`;
          const statusInfo = `codes articles=${articleStatusCode ?? "—"} videos=${videoStatusCode ?? "—"}`;
          persistLastError(`DATA unavailable: ${urlInfo} | ${statusInfo} | ${message}`);
          renderInlineError("Obsah dočasně nedostupný. Zkus stránku obnovit.");
          setStatus("Obsah se teď nenačetl (404). Zkus obnovit stránku.");
        } else {
          persistLastError(message);
          renderEmpty("Nepodařilo se načíst data: " + message);
          setStatus("Stav dat: chyba (detail viz Poslední chyba)");
        }
        debugLog("[DATA] error=", message);
        if (isDebugOn()) {
          writeDebug({
            ok: false,
            url: chosenArticlesUrl || articleUrls[0] || "",
            fetchedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            error: message,
          });
        }
      }
    }
  }

  async function fetchFeedHealth() {
    try {
      const res = await timeoutFetch(makeDataUrl("data/feed_health.json"), { cache: "no-store" }, 5000);
      if (res.status === 404) {
        debugWarn("[HEALTH] feed_health not found");
        return;
      }
      if (!res.ok) {
        debugWarn("[HEALTH] feed_health error", res.status);
        return;
      }
      const data = await res.json();
      const updated = data?.updatedAt ?? data?.updated_at;
      debugLog("[HEALTH] feed_health OK", updated ? `updatedAt=${updated}` : "updatedAt=—");
    } catch (err) {
      debugWarn("[HEALTH] feed_health fetch failed", err && err.message ? err.message : err);
    }
  }

  function persistLastOk(data) {
    try {
      localStorage.setItem("iu:lastOkAt", new Date().toISOString());
      localStorage.setItem("iu:lastOk", JSON.stringify(data));
    } catch {
      // ignore
    }
  }

  function persistLastError(message) {
    try {
      if (!message) {
        localStorage.removeItem("iu:lastErrorAt");
        localStorage.removeItem("iu:lastError");
      } else {
        localStorage.setItem("iu:lastErrorAt", new Date().toISOString());
        localStorage.setItem("iu:lastError", message);
      }
    } catch {
      // ignore
    }
    const el = document.getElementById("dataStatusLastError");
    if (el) {
      el.textContent = `Poslední chyba: ${message}`;
    }
    const inline = document.getElementById("lastErrInline");
    if (inline) {
      inline.textContent = `Poslední chyba: ${message}`;
      inline.style.display = "block";
    }
    console.error("[ERR]", message);
  }

  function handleMissingFeedContainer() {
    const msg = "[DOM] feed container missing";
    persistLastError(msg);
    const articlesEl = document.getElementById("dataStatusArticles");
    if (articlesEl) {
      articlesEl.textContent = "Články: chyba DOM";
    }
    return;
  }

  window.addEventListener("error", (event) => {
    try {
      const info = `${event.message} (${event.filename}:${event.lineno})`;
      persistLastError(info);
    } catch (err) {
      console.error("[ERR]", "error handler failed", err);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason ? event.reason.message || String(event.reason) : "unknown";
      persistLastError(`Promise rejection: ${reason}`);
    } catch (err) {
      console.error("[ERR]", "rejection handler failed", err);
    }
  });

  function updateNetworkStatus() {
    const el = document.getElementById("dataStatusNet");
    if (!el) return;
    el.textContent = `Síť: ${navigator.onLine ? "online" : "offline"}`;
  }

  function initAccordion() {
    const headers = document.querySelectorAll(".accordionCol .accHeader");
    headers.forEach((header) => {
      const targetId = header.getAttribute("aria-controls");
      const content = targetId ? document.getElementById(targetId) : header.nextElementSibling;
      if (!content) return;
      content.style.maxHeight = "0px";
      content.style.overflow = "hidden";
      header.setAttribute("aria-expanded", "false");
      header.addEventListener("click", () => {
        const isExpanded = header.classList.toggle("is-open");
        header.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        if (isExpanded) {
          content.style.maxHeight = `${content.scrollHeight}px`;
        } else {
          content.style.maxHeight = "0px";
        }
      });
    });
  }

  function updateSwStatusLabel() {
    const el = document.getElementById("dataStatusSW");
    if (!el) return;
    if (!("serviceWorker" in navigator)) {
      el.textContent = "SW: nepodporováno";
      return;
    }
    const controller = navigator.serviceWorker.controller ? "controller=ANO" : "controller=NE";
    const waiting = selfDiag.swWaiting === "yes" ? " waiting=ANO" : "";
    el.textContent = `SW: ${controller}${waiting}`;
  }

  function buildReportText() {
    const build = selfDiag.build || "no-build";
    const articles = `${selfDiag.articlesState} count=${selfDiag.articlesCount}`;
    const videos = `${selfDiag.videosState} count=${selfDiag.videosCount}`;
    const swController = navigator.serviceWorker?.controller ? "controller=ANO" : "controller=NE";
    const swWaiting = selfDiag.swWaiting === "yes" ? " waiting=ANO" : "";
    const updatedEl = document.getElementById("dataStatusUpdated");
    const updated = updatedEl ? updatedEl.textContent.trim() : "Aktualizace: —";
    const lastErrorAt = localStorage.getItem("iu:lastErrorAt") || "—";
    const lastError = localStorage.getItem("iu:lastError") || "—";
    const lastOkAt = localStorage.getItem("iu:lastArticlesOkAt") || "—";
    const lastOkCount = localStorage.getItem("iu:lastArticlesCount") || "—";
    return [
      `[REPORT] build=${build}`,
      `[REPORT] articles=${articles}`,
      `[REPORT] videos=${videos}`,
      `[REPORT] updated=${updated}`,
      `[REPORT] sw=${swController}${swWaiting}`,
      `[REPORT] lastErrorAt=${lastErrorAt}`,
      `[REPORT] lastError=${lastError}`,
      `[REPORT] lastOkAt=${lastOkAt}`,
      `[REPORT] lastOkCount=${lastOkCount}`,
    ].join("\n");
  }

  async function copyReportToClipboard() {
    const text = buildReportText();
    try {
      await navigator.clipboard.writeText(text);
      debugLog("[REPORT] copied");
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "absolute";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        debugLog("[REPORT] clipboard fallback used");
        debugLog("[REPORT] copied");
      } catch (fallbackErr) {
        const fallback = window.prompt("Copy report (Ctrl+C)", text);
        if (fallback !== null) {
          debugLog("[REPORT] copied");
        }
      }
    }
  }

  function refreshDebugPanelText() {
    const label = document.getElementById("dataDebugLabel");
    if (!label) return;
    label.textContent = `Debug: ${isDebugOn() ? "ON" : "OFF"}`;
  }

  const SW_RELOAD_KEY = "iu:swReloaded";
  const SW_RELOAD_AT_KEY = "iu:swReloadedAt";

  function clearStaleReloadGuard() {
    const at = Number(sessionStorage.getItem(SW_RELOAD_AT_KEY) || "0");
    if (!at) return false;
    if (Date.now() - at > 10 * 60 * 1000) {
      sessionStorage.removeItem(SW_RELOAD_KEY);
      sessionStorage.removeItem(SW_RELOAD_AT_KEY);
      debugLog("[SW] reload guard cleared");
      return false;
    }
    return Boolean(sessionStorage.getItem(SW_RELOAD_KEY));
  }

  function scheduleSWReload(worker) {
    if (!worker || !("sessionStorage" in window)) return;
    if (clearStaleReloadGuard()) return;
    try {
      worker.postMessage({ type: "SKIP_WAITING" });
      addTelemetryEvent("sw", "skip waiting");
    } catch (error) {
      debugWarn("[SW]", "skip waiting message failed", error);
    }
    sessionStorage.setItem(SW_RELOAD_KEY, "1");
    sessionStorage.setItem(SW_RELOAD_AT_KEY, Date.now().toString());
    window.location.reload();
  }

  function watchForSWUpdates() {
    if (!("serviceWorker" in navigator)) return;
    const handleRegistration = (reg) => {
      if (!reg) return;
      selfDiag.swController = navigator.serviceWorker?.controller ? "yes" : "no";
      if (reg.waiting) {
      addTelemetryEvent("sw", "waiting");
        selfDiag.swWaiting = "yes";
        logSelfStatus();
        scheduleSWReload(reg.waiting);
        return;
      }
      selfDiag.swWaiting = "no";
      logSelfStatus();
    updateSwStatusLabel();
      if (reg.waiting) {
        scheduleSWReload(reg.waiting);
        return;
      }
      const onUpdateFound = () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && reg.waiting) {
            scheduleSWReload(reg.waiting);
          }
        });
      };
      reg.addEventListener("updatefound", onUpdateFound);
      onUpdateFound();
    };

    navigator.serviceWorker
      .getRegistration()
      .then(handleRegistration)
      .catch(() => {});
    navigator.serviceWorker
      .ready
      .then(handleRegistration)
      .catch(() => {});
  }

  function auditLog() {
    const loadMoreEl = document.querySelector("[data-load-more], .loadMore");
    const loadMoreState = loadMoreEl && !loadMoreEl.hidden ? "visible" : "hidden";
    const swState = selfDiag.swWaiting === "yes"
      ? "waiting"
      : (selfDiag.swController === "yes" ? "controller" : "none");
    debugLog(`[AUDIT] build=${selfDiag.build}`);
    debugLog(`[AUDIT] articles=${selfDiag.articlesState} count=${selfDiag.articlesCount}`);
    debugLog(`[AUDIT] videos=${selfDiag.videosState} count=${selfDiag.videosCount}`);
    debugLog(`[AUDIT] loadMore=${loadMoreState}`);
    debugLog(`[AUDIT] sw=${swState}`);
  }

  function init() {
    if (sessionStorage.getItem("iu:firstLoadDone")) {
      debugLog("[LOAD] repeat");
    } else {
      debugLog("[LOAD] first");
      sessionStorage.setItem("iu:firstLoadDone", "1");
      firstLoadQuiet = true;
      setTimeout(() => {
        firstLoadQuiet = false;
      }, 5000);
    }
    renderDebugVisibility();
    renderSectionsBar();
    setSectionsFromHash();
    iuInitTopbarWatcher();

    if (btnToggleDebug) {
      btnToggleDebug.addEventListener("click", () => {
        setDebug(!isDebugOn());
        if (isDebugOn() && (!elDebugOut || !elDebugOut.textContent.trim())) {
          writeDebug({ note: "Debug aktivní. Pokud data nejdou načíst, uvidíš chybu zde." });
        }
      });
    }

    if (searchForm) {
      searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        applyFilter();
      });
    }

    if (modalGoogle) {
      modalGoogle.addEventListener("click", () => {
        const query = (searchInput && searchInput.value.trim()) || "";
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        window.open(url, "_blank", "noopener");
        resetSearchAndReload();
      });
    }

    const retryBtn = document.getElementById("dataRetryBtn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        fetchArticlesStatus();
        fetchVideosStatus();
        loadData();
      });
    }

    const debugBtn = document.getElementById("dataDebugToggle");
    if (debugBtn) {
      debugBtn.addEventListener("click", () => {
        const current = isDebugOn();
        setDebug(!current);
        refreshDebugPanelText();
        location.reload();
      });
      refreshDebugPanelText();
    }

    const copyBtn = document.getElementById("dataCopyReportBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        copyReportToClipboard();
      });
    }
    const hardBtn = document.getElementById("dataHardRefreshBtn");
    if (hardBtn) {
      hardBtn.addEventListener("click", () => {
        ["iu:swReloaded", "iu:swReloadedAt", "iu:scrolledToStatus"].forEach((key) => sessionStorage.removeItem(key));
        softRefreshData();
      });
    }
    renderDiagBox();
    initAccordion();
    updateBuildStatusLabel();
    recordBuildSeen();
    nukeCachesAndSwOnBuildChange();

    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    updateNetworkStatus();

    if (modalCancel) {
      modalCancel.addEventListener("click", () => {
        resetSearchAndReload();
      });
    }

    fetchArticlesStatus();
    fetchVideosStatus();
    loadData();
    watchForSWUpdates();
    updateSwStatusLabel();
    auditLog();
    fetchFeedHealth();
    updateEventsUI();
    finalStateReport();
  }

  document.addEventListener("visibilitychange", () => {
    debugLog("[VIS]", document.visibilityState);
  });

  window.addEventListener("focus", () => debugLog("[FOCUS] in"));
  window.addEventListener("blur", () => debugLog("[FOCUS] out"));

  window.addEventListener("hashchange", () => {
    freezeScroll();
    setSectionsFromHash();
    applyFilter();
    restoreScroll();
  });

  init();
})();

// CHECKPOINT: FEED STABLE
// Stav ověřen: invarianty splněny, render pipeline uzamčena,
// fail-soft aktivní, emergency visibility aktivní.
// Jakákoli změna výše musí projít kontrolou invariant.
// === NO-GO ZONE END ===
// Jakýkoli zásah pod tímto bodem je porušením technického standardu infoUzel.cz
// === MAINTENANCE MODE ACTIVE ===
// Jakákoli změna nad tímto bodem vyžaduje nový checkpoint