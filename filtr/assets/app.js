(() => {
  const $ = (sel) => document.querySelector(sel);

  const elStatus = $("#dataStatus");
  const elDebugPanel = $("#debugPanel");
  const elDebugOut = $("#debugOut");
  const elDataCount = $("#dataCount");
  const btnToggleDebug = $("#toggleDebugBtn");
  const elNewsList = document.getElementById("newsList");
  const emptyBox = document.getElementById("emptyBox");
  const sectionLabel = document.getElementById("sectionLabel");
  const sectionsBar = document.getElementById("sectionsBar");
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");
  const searchModal = document.getElementById("searchModal");
  const modalGoogle = document.getElementById("modalGoogle");
  const modalCancel = document.getElementById("modalCancel");

  const feedTarget = elNewsList;
  const LS_KEY = "iu:debug";
  const SECTION_KEYS = ["vse", "aktualne", "doprava", "pocasi", "sport", "finance", "krimi", "zdravi", "video"];
  let activeSections = ["vse"];
  let cachedItems = [];
  let hasLoadedData = false;
  const BASE_ROOT = getBaseRoot();
  const DATA_URL = `${BASE_ROOT}data/articles.json`;
  const VIDEOS_URL = `${BASE_ROOT}data/videos.json`;
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

  function getBaseRoot() {
    // BASE = složka, kde leží tento skript (filtr/assets/app.js -> filtr/)
    try {
      const u = new URL(document.currentScript?.src || "", location.href);
      return u.pathname.replace(/\/assets\/[^/]*$/, "/");
    } catch {
      // fallback: relativně k current path
      let p = location.pathname.replace(/\\/g, "/");
      if (p.endsWith("index.html")) p = p.slice(0, -10);
      if (!p.endsWith("/")) p += "/";
      return p || "/";
    }
  }

  function getBuildStamp() {
    const meta = document.querySelector('meta[name="iu-build"]');
    const value = meta ? (meta.getAttribute("content") || "").trim() : "";
    return value || null;
  }

  const BUILD_STAMP = getBuildStamp();
  console.log("[BUILD]", BUILD_STAMP || "no-build-stamp");

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
    const qs = new URLSearchParams(location.search);
    if (qs.get("debug") === "1") return true;
    return localStorage.getItem(LS_KEY) === "1";
  }

  function setDebug(on) {
    localStorage.setItem(LS_KEY, on ? "1" : "0");
    renderDebugVisibility();
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

  function setStatus(text) {
    if (elStatus) {
      elStatus.textContent = text;
    }
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

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
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

  function matchesSections(item) {
    if (!item) return false;
    if (activeSections.includes("vse")) return true;
    if (activeSections.includes("video")) {
      return String(item.contentType || "").toLowerCase() === "video";
    }
    const sectionValue = ((item.section || item.topic) || "").toLowerCase();
    return activeSections.some((section) => section === sectionValue);
  }

  function getFeedTarget() {
    return feedTarget;
  }

  function renderEmpty(message, extraHtml = "") {
    const target = getFeedTarget();
    if (target) {
      withScrollLock(() => {
        target.innerHTML = "";
      });
    }
    if (emptyBox) {
      emptyBox.innerHTML = `<p>${escapeHtml(message)}</p>${extraHtml ? extraHtml : ""}`;
      emptyBox.style.display = "block";
    }
    if (elDataCount) elDataCount.textContent = "0";
  }

  function renderItems(items) {
    const target = getFeedTarget();
    if (!target) return;
    if (emptyBox) {
      emptyBox.style.display = "none";
      emptyBox.innerHTML = "";
    }
    if (!items || items.length === 0) {
      renderEmpty("Žádné články k zobrazení. Zkontroluj Stav dat.");
      writeDebug({
        ok: true,
        note: "Žádné položky k zobrazení",
        itemsCount: 0,
      });
      return;
    }

    const html = items
      .map((it) => {
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
          safeUrl(it.url) ||
          safeUrl((it.link && (it.link.href || it.link)) || it.href || "");
        const titleMarkup = linkUrl
          ? `<a class="news-titleLink" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              title
            )}</a>`
          : `<span class="news-titleLink">${escapeHtml(title)}</span>`;

        return `
          <article class="news-card">
            <h2 class="news-title">${titleMarkup}</h2>
            <div class="news-row2">
              ${publishedAt ? `<span class="meta-time">${escapeHtml(publishedAt)}</span>` : ""}
              <span class="news-sourceLabel">Zdroj:</span>
              <span class="news-sources">${sourceMarkup}</span>
            </div>
          </article>
        `;
      })
      .join("");

    withScrollLock(() => {
      target.innerHTML = html;
      if (elDataCount) elDataCount.textContent = String(items.length);
    });
  }

  function writeDebug(obj) {
    if (!elDebugOut) return;
    try {
      elDebugOut.textContent = JSON.stringify(obj, null, 2);
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

  function applyFilter() {
    if (!hasLoadedData) return;
    const query = (searchInput && searchInput.value.trim()) || "";
    const normalizedQuery = query.toLowerCase();
    let filtered = cachedItems.filter(matchesSections);
    if (normalizedQuery) {
      filtered = filtered.filter((item) => {
        const haystack =
          [
            item.title,
            item.name,
            item.summary,
            item.section,
            item.topic,
            ...(Array.isArray(item.sources) ? item.sources.map((s) => s.name || s.title || s) : []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase() || "";
        return haystack.includes(normalizedQuery);
      });
    }

    if (filtered.length === 0) {
      if (query) {
        openSearchModal();
      } else {
        hideSearchModal();
        renderEmpty("Žádné články neodpovídají filtrům.");
      }
      setStatus(`Stav dat: OK (0 / ${cachedItems.length})`);
      if (isDebugOn()) {
        writeDebug({
          sections: activeSections,
          hash: location.hash,
          search: query,
          totalItems: cachedItems.length,
          filtered: 0,
        });
      }
      return;
    }

    hideSearchModal();
    renderItems(filtered);
    setStatus(`Stav dat: OK (${filtered.length} / ${cachedItems.length})`);
    if (isDebugOn()) {
      writeDebug({
        sections: activeSections,
        hash: location.hash,
        search: query,
        totalItems: cachedItems.length,
        filtered: filtered.length,
      });
    }
  }

  async function fetchArticlesStatus() {
    const el = document.getElementById("dataStatusArticles");
    if (!el) return;
    try {
      const res = await fetch(makeDataUrl("data/articles.json"), { cache: "no-store" });
      if (!res.ok) {
        el.textContent = `Články: chyba (${res.status})`;
        return;
      }
      const data = await res.json();
      const items = normalizeItems(data);
      if (!items.length) {
        el.textContent = "Články: prázdné";
        return;
      }
      el.textContent = `Články: OK (${items.length})`;
    } catch {
      el.textContent = "Články: chyba";
    }
  }

  async function fetchVideosStatus() {
    const el = document.getElementById("dataStatusVideos");
    if (!el) return;
    try {
      const res = await fetch(makeDataUrl("data/videos.json"), { cache: "no-store" });
      if (res.status === 404) {
        el.textContent = "Videa: není k dispozici";
        return;
      }
      if (!res.ok) {
        el.textContent = `Videa: chyba (${res.status})`;
        return;
      }
      const data = await res.json();
      const items = Array.isArray(data) ? data : data?.items || [];
      if (!items.length) {
        el.textContent = "Videa: prázdná";
        return;
      }
      el.textContent = `Videa: OK (${items.length})`;
    } catch {
      el.textContent = "Videa: chyba";
    }
  }

  async function loadData() {
    const startedAt = new Date();
    setStatus("Stav dat: načítám…");
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Neplatný JSON v data/articles.json");
      }

      cachedItems = normalizeItems(data);
      hasLoadedData = true;
      setStatus(`Stav dat: OK (${cachedItems.length} položek)`);
      applyFilter();

      if (isDebugOn()) {
        writeDebug({
          ok: true,
          url: DATA_URL,
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          rawType: Array.isArray(data) ? "array" : typeof data,
          keys:
            data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [],
          itemsCount: cachedItems.length,
          sample: cachedItems.slice(0, 3),
        });
      }
    } catch (err) {
      setStatus("Stav dat: chyba (nelze načíst)");
      if (!hasLoadedData) {
        renderEmpty("Nepodařilo se načíst články. Zkontroluj Stav dat.");
      }
      if (isDebugOn()) {
        writeDebug({
          ok: false,
          url: DATA_URL,
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          error: err && err.message ? err.message : String(err),
        });
      }
    }
  }

  async function loadVideoMetadata() {
    try {
      const res = await fetch(VIDEOS_URL, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          console.warn("[DATA] videos.json not found");
        } else {
          console.warn("[DATA] videos.json error", res.status);
        }
        return;
      }

      const text = await res.text();
      try {
        JSON.parse(text);
      } catch (err) {
        console.warn(
          "[DATA] videos.json parse error",
          err && err.message ? err.message : err
        );
      }
    } catch (err) {
      console.warn(
        "[DATA] videos.json error",
        err && err.message ? err.message : err
      );
    }
  }

  const SW_RELOAD_KEY = "iu:swReloaded";

  function scheduleSWReload(worker) {
    if (!worker || !("sessionStorage" in window)) return;
    if (sessionStorage.getItem(SW_RELOAD_KEY)) return;
    try {
      worker.postMessage({ type: "SKIP_WAITING" });
    } catch (error) {
      console.warn("[SW]", "skip waiting message failed", error);
    }
    sessionStorage.setItem(SW_RELOAD_KEY, "1");
    window.location.reload();
  }

  function watchForSWUpdates() {
    if (!("serviceWorker" in navigator)) return;
    const handleRegistration = (reg) => {
      if (!reg) return;
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

  function init() {
    renderDebugVisibility();
    renderSectionsBar();
    setSectionsFromHash();

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

    if (modalCancel) {
      modalCancel.addEventListener("click", () => {
        resetSearchAndReload();
      });
    }

    fetchArticlesStatus();
    fetchVideosStatus();
    loadData();
    loadVideoMetadata();
    watchForSWUpdates();
  }

  window.addEventListener("hashchange", () => {
    freezeScroll();
    setSectionsFromHash();
    applyFilter();
    restoreScroll();
  });

  init();
})();
