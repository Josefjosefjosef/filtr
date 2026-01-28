(() => {
  /* ===== KONFIG ===== */
  // ✅ FIX: BASE je path-only ("/" nebo "/filtr/"), vždy s trailing slash
  function getBaseRoot(){
    let p = location.pathname;
    if (p.endsWith("index.html")) p = p.slice(0, -10);
    if (!p.endsWith("/")) p += "/";
    return p;
  }
  
  
  // ✅ FIX: BASE je path-only (ne origin+path) - pro správný SW scope
  const BASE = getBaseRoot();
  function getBuildStamp(){
    const meta = document.querySelector("meta[name=\"iu-build\"]");
    const stamp = meta ? (meta.getAttribute("content") || "").trim() : "";
    return stamp || null;
  }
  function makeDataUrl(relPath, opts = {}){
    const url = new URL(relPath, `${location.origin}${BASE}`);
    if(opts.bust){
      const stamp = getBuildStamp();
      const param = stamp || (DEBUG ? String(Date.now()) : null);
      if(param){
        url.searchParams.set("v", param);
      }
    }
    return url.toString();
  }
  
  // ✅ FIX: Debug log při ?debug=1
  const DEBUG = (() => {
    try {
      const urlDebug = new URLSearchParams(location.search).get("debug") === "1";
      const storageDebug = localStorage.getItem("iu:debug") === "1";
      return urlDebug || storageDebug;
    } catch (e) {
      return false;
    }
  })();
  
  if (DEBUG) {
    console.log("[infoUzel] DEBUG MODE");
    console.log("[infoUzel] BASE:", BASE);
    console.log("[infoUzel] ARTICLES_URL:", `${BASE}data/articles.json`);
    console.log("[infoUzel] VIDEOS_URL:", `${BASE}data/videos.json`);
    console.log("[infoUzel] window.__iuSafeFetch:", window.__iuSafeFetch);
    console.log("[infoUzel] window.__iuSafeFetch?.fetchJSON:", typeof window.__iuSafeFetch?.fetchJSON);
    console.log("[infoUzel] window.__iuSafeFetch?.safeFetchJSON:", typeof window.__iuSafeFetch?.safeFetchJSON);
  }

  function debugLog(...args) {
    if (DEBUG) {
      console.log("[infoUzel]", ...args);
    }
  }

  function debugWarn(...args) {
    if (DEBUG) {
      console.warn("[infoUzel]", ...args);
    }
  }

  // ✅ FIX: Odstraněn cache-busting - SW cache může fungovat
  // URL jsou stabilní, SW zajišťuje aktualizaci přes TTL
  // BASE už obsahuje trailing slash, takže nepřidáváme další
  const ARTICLES_URL = `${BASE}data/articles.json`;
  const VIDEOS_URL = `${BASE}data/videos.json`;
  const WEATHER_URL = `${BASE}data/weather.json`;
  const NAMEDAYS_URL = `${BASE}data/namedays.json`;

  // ✅ FIX: Univerzální unwrap pro různé formáty JSON
  function unwrapToArray(data){
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.articles)) return data.articles;
    if (Array.isArray(data?.arr)) return data.arr;
    return [];
  }

  // ✅ BEZ “Video” sekce — sekce = články + videa dohromady
  const SECTIONS = [
    { key: "vse",      label: "Vše" },
    { key: "aktualne", label: "Aktuálně" },
    { key: "doprava",  label: "Doprava" },
    { key: "pocasi",   label: "Počasí" },
    { key: "sport",    label: "Sport" },
    { key: "finance",  label: "Finance" },
    { key: "krimi",    label: "Krimi" },
    { key: "zdravi",   label: "Zdraví" }
  ];

  const EMAIL_LINKS = [
    { name:"Seznam",  url:"https://email.seznam.cz/",          ico:"S" },
    { name:"Gmail",   url:"https://mail.google.com/",          ico:"G" },
    { name:"Outlook", url:"https://outlook.live.com/mail/",    ico:"O" },
    { name:"iCloud",  url:"https://www.icloud.com/mail",       ico:"I" },
    { name:"Centrum", url:"https://mail.centrum.cz/",          ico:"C" },
    { name:"Proton",  url:"https://mail.proton.me/",           ico:"P" },
    { name:"Tuta",    url:"https://mail.tutanota.com/",        ico:"T" },
    { name:"Yahoo",   url:"https://mail.yahoo.com/",           ico:"Y" }
  ];

  /* ===== LIMITY ZOBRAZENÍ + "NAČÍST DALŠÍ" =====
     - Sekce: 60 položek na stránku (start i krok)
     - Vše: víc než sekce (start i krok)
     - Pozn.: JSON může mít klidně 1000, UI bude dávkovat tlačítkem
  */
  const PAGE_SIZE_SECTION = 60;
  const PAGE_SIZE_ALL = 120;

  /* ===== VIDEO SLOTY (pevné pozice) =====
     Chceš ~10 videí stabilně na "Vše".
     Vkládáme 10 slotů po N-tém článku tak, aby nebyla hned vedle banneru
     a aby mezi videem a bannerem byly min. 3 články.
  */
  const VIDEO_SLOTS_AFTER_ARTICLE = [5, 14, 24, 34, 44, 54, 64, 74, 84, 94];

  /* ===== BANNERY – ZABETONOVAT (pevné pozice po N-tém článku) =====
     - video NIKDY hned vedle banneru
     - mezi videem a bannerem min. 3 články
  */
  const BANNER_SLOTS_AFTER_ARTICLE = [8, 18, 28, 38, 48, 58, 68, 78, 88, 98];

  function isBannerAfterArticleCount(n){ return BANNER_SLOTS_AFTER_ARTICLE.includes(n); }

  /* ===== VIDEO: povolené kanály + priorita ===== */
  const VIDEO_ALLOWED_CHANNELS = [
    "ČT24",
    "Seznam Zprávy",
    "DVTV",
    "CNN Prima NEWS"
  ];

  function channelPriority(channel){
    const c = String(channel || "").trim();
    const i = VIDEO_ALLOWED_CHANNELS.indexOf(c);
    return (i >= 0) ? (100 - i) : 0;
  }

  function isAllowedChannel(channel){
    const c = String(channel || "").trim();
    return VIDEO_ALLOWED_CHANNELS.includes(c);
  }

  /* ===== STAV ===== */
  // allItems = články + videa (pro vyhledávání / filtry / řazení)
  let allItems = [];
  let filtered = [];

  // zvlášť držíme články a videa (pro pevné sloty na "Vše")
  let allArticles = [];
  let allVideos = [];

  // displayFeed = finální feed po vložení videí + bannerů (obsahuje article/video/ad)
  let displayFeed = [];
  let renderedItems = 0;      // index do displayFeed
  let renderedLimit = 0;      // kolik max zobrazit (tlačítko "Načíst další")

  // ÚKOL 4t: multi-select sekcí (prázdná množina = "Vše")
  let activeSections = new Set();
  let activeQuery = "";

  // pro bezpečný auto-refresh
  let lastDataSignature = "";
  let lastVideosSignature = "";

  /* ===== DOM SAFE GET ===== */
  const $ = (id) => document.getElementById(id);

  /* ===== ESCAPE ===== */
  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  /* ÚKOL 2m: escapování do HTML atributu (title/aria-label) */
  function escapeAttr(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function norm(s){ return String(s ?? "").toLowerCase().trim(); }

  function safeUrl(u){
    const s = String(u ?? "").trim();
    if(!s) return "";
    try{
      const url = new URL(s, location.origin);
      if(url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.toString();
    }catch(_){
      return "";
    }
  }

  /* ===== DOMÉNA PRO ZDROJ: "www..." ===== */
  function domainFromUrl(u){
    try{
      const url = new URL(u);
      let host = (url.hostname || "").toLowerCase();
      if(!host) return "";
      if(!host.startsWith("www.")) host = "www." + host;
      return host;
    }catch(_){
      return "";
    }
  }

  /* ===== ČAS ===== */
  function fmtTime(iso){
    try{
      const d = new Date(iso);
      if(Number.isNaN(d.getTime())) return "";
      // Zobrazujeme UTC čas, aby nedocházelo k posunu kvůli lokálnímu časovému pásmu
      const dd = String(d.getUTCDate()).padStart(2,"0");
      const mm = String(d.getUTCMonth()+1).padStart(2,"0");
      const yyyy = d.getUTCFullYear();
      const hh = String(d.getUTCHours()).padStart(2,"0");
      const mi = String(d.getUTCMinutes()).padStart(2,"0");
      return `${dd}. ${mm}. ${yyyy} ${hh}:${mi}`;
    }catch(e){
      return "";
    }
  }

  function czDateLabel(d){
    const days = ["neděle","pondělí","úterý","středa","čtvrtek","pátek","sobota"];
    const months = ["ledna","února","března","dubna","května","června","července","srpna","září","října","listopadu","prosince"];
    const dayName = days[d.getDay()];
    const dd = d.getDate();
    const mm = months[d.getMonth()];
    const yyyy = d.getFullYear();
    return `${dayName} ${dd}. ${mm} ${yyyy}`;
  }

  function hoursSince(iso){
    try{
      const t = new Date(iso).getTime();
      if(!t || Number.isNaN(t)) return Number.POSITIVE_INFINITY;
      const diff = Date.now() - t;
      return diff / 3600000;
    }catch(_){
      return Number.POSITIVE_INFINITY;
    }
  }

  /* ===== TOPBAR OFFSET ===== */
  function syncTopbarOffset(){
    const tb = $("topbarWrap");
    if(!tb) return;
    const h = tb.offsetHeight || 0;
    document.documentElement.style.setProperty("--topbarOffset", h + "px");
  }

  /* ===== DATA UPDATED AT (UI) ===== */
  function setDataUpdatedAtLabel(iso){
    const v = String(iso || "").trim();

    const el = $("dataUpdatedAt");
    if(!el) return;

    if(!v){
      el.textContent = "Poslední aktualizace dat: —";
      return;
    }

    const t = fmtTime(v);
    el.textContent = t ? `Poslední aktualizace dat: ${t}` : "Poslední aktualizace dat: —";
  }

  /* ===== DATA NORMALIZACE ===== */
  function normalizeSources(src){
    const arr = Array.isArray(src) ? src : [];
    const out = [];
    for(const s of arr){
      const name = String(s?.name ?? "").trim();
      const url = safeUrl(s?.url ?? "");
      if(!name && !url) continue;
      out.push({ name: name || "Zdroj", url });
    }
    return out;
  }

  function normalizeArticle(a){
    const section = norm(a?.section) || norm(a?.topic) || "aktualne";

    const ct = norm(a?.contentType) || "article";
    const contentType = (ct === "video") ? "video" : "article";

    let sources = normalizeSources(a?.sources);

    // VIDEO: vždy jen 1 zdroj (primární)
    if(contentType === "video" && sources.length > 1){
      sources = [sources[0]];
    }

    return {
      section,
      topic: section, // topic = section
      contentType,
      title: String(a?.title ?? "").trim(),
      publishedAt: String(a?.publishedAt ?? "").trim(),
      sources,
      // video fields (když přijdou)
      videoId: String(a?.videoId ?? "").trim(),
      channel: String(a?.channel ?? "").trim(),
      image: ""
    };
  }

  /* ===== VIDEO: parsování ===== */
  function youtubeIdFromUrl(url){
    const u = safeUrl(url);
    if(!u) return "";
    try{
      const x = new URL(u);
      const host = (x.hostname || "").toLowerCase();

      // youtu.be/<id>
      if(host.endsWith("youtu.be")){
        const id = (x.pathname || "").replace("/","").trim();
        return id || "";
      }

      // youtube.com/…id>
      if(host.includes("youtube.com")){
        const v = x.searchParams.get("v");
        if(v) return v.trim();

        // youtube.com/…id>
        const parts = (x.pathname || "").split("/").filter(Boolean);
        const idxShorts = parts.indexOf("shorts");
        if(idxShorts >= 0 && parts[idxShorts+1]) return parts[idxShorts+1].trim();

        // youtube.com/…id>
        const idxEmbed = parts.indexOf("embed");
        if(idxEmbed >= 0 && parts[idxEmbed+1]) return parts[idxEmbed+1].trim();
      }

      return "";
    }catch(_){
      return "";
    }
  }

  function ytEmbedUrl(videoId){
    const id = String(videoId || "").trim();
    if(!id) return "";
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1&playsinline=1`;
  }

  function normalizeVideoAsItem(v){
    const title = String(v?.title ?? "").trim();
    const url = safeUrl(v?.url ?? v?.link ?? "");
    const videoId = String(v?.videoId ?? v?.id ?? "").trim() || youtubeIdFromUrl(url);

    const section = norm(v?.section) || norm(v?.topic) || "aktualne";
    const publishedAt = String(v?.publishedAt ?? v?.published ?? v?.date ?? "").trim();
    const channel = String(v?.channel ?? v?.source ?? v?.author ?? "").trim();

    const sourceUrl = url || (videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : "");

    // pokud nemáme datum nebo videoId, nechceme to do feedu
    if(!publishedAt || !videoId) return null;

    // jen povolené kanály (priority)
    if(!isAllowedChannel(channel)) return null;

    return {
      section,
      topic: section,
      contentType: "video",
      title,
      publishedAt,
      sources: [
        {
          name: channel ? `YouTube / ${channel}` : "YouTube",
          url: sourceUrl
        }
      ],
      videoId,
      channel,
      image: ""
    };
  }

  /* ===== ZÁCHRANNÉ SLUČOVÁNÍ (jen stejné title) ===== */
  function mergeByExactTitle(items){
    const m = new Map();

    for(const x of items){
      const it = normalizeArticle(x);

      // VIDEO NIKDY NESLUČUJEME
      if(it.contentType === "video"){
        const firstUrl = safeUrl(it?.sources?.[0]?.url || "");
        const uniq = `video::${norm(it.title)}::${String(it.publishedAt||"")}::${firstUrl}`;
        m.set(uniq, it);
        continue;
      }

      const key = norm(it.title);
      if(!key) continue;

      if(!m.has(key)){
        m.set(key, it);
        continue;
      }

      const e = m.get(key);

      // sources merge (bez duplicit podle url)
      const urls = new Set((e.sources||[]).map(s => s?.url));
      const merged = [...(e.sources||[])];
      for(const s of it.sources){
        if(s?.url && !urls.has(s.url)){
          merged.push(s);
          urls.add(s.url);
        }
      }

      // ponech novější publishedAt
      let publishedAt = e.publishedAt;
      try{
        const t1 = Date.parse(it.publishedAt);
        const t2 = Date.parse(e.publishedAt);
        if(Number.isFinite(t1) && Number.isFinite(t2) && t1 > t2){
          publishedAt = it.publishedAt;
        }
      }catch(_){}

      // sekce s vyšší prioritou
      const prio = { doprava:7, pocasi:6, sport:5, finance:4, krimi:3, zdravi:2, aktualne:1 };
      const sec = (prio[it.section]||0) > (prio[e.section]||0) ? it.section : e.section;

      m.set(key, {
        ...e,
        section: sec,
        topic: sec,
        publishedAt,
        sources: merged,
        image: ""
      });
    }

    return Array.from(m.values());
  }

  /* ===== ÚKOL 4y: zabránění poskakování stránky ===== */
  let _freezeScrollY = null;

  function freezeScroll(){
    _freezeScrollY = window.scrollY || 0;
  }

  function restoreScroll(){
    if(_freezeScrollY === null || _freezeScrollY === undefined) return;

    const y = Number(_freezeScrollY) || 0;
    _freezeScrollY = null;

    requestAnimationFrame(() => {
      window.scrollTo(0, y);
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
    });
  }

  function applyFilterPreserveScroll(){
    freezeScroll();
    applyFilter();
    restoreScroll();
  }

  /* ===== HASH SEKCE (ÚKOL 4t: multi-select) ===== */
  function setSectionsFromHash(){
    const raw = (location.hash || "").replace("#","").trim().toLowerCase();
    const next = new Set();

    if(!raw){
      activeSections = next;
      return;
    }

    const parts = raw.split(",").map(s => s.trim()).filter(Boolean);

    const allowed = new Set(SECTIONS.map(s => s.key).filter(k => k !== "vse"));
    for(const p of parts){
      if(allowed.has(p)) next.add(p);
    }

    activeSections = next;
  }

  function hashFromActiveSections(){
    if(!activeSections || activeSections.size === 0) return "";
    const allowed = new Set(SECTIONS.map(s => s.key).filter(k => k !== "vse"));
    const keys = Array.from(activeSections).filter(k => allowed.has(k));
    keys.sort();
    return keys.join(",");
  }

  function setHashFromActiveSections({ preserveScroll = false } = {}){
    if(preserveScroll) freezeScroll();

    const h = hashFromActiveSections();
    const newUrl = location.pathname + location.search + (h ? `#${h}` : "");

    try{
      history.replaceState(null, "", newUrl);
    }catch(_){
      if(!h){
        if(location.hash) location.hash = "";
      }else{
        location.hash = `#${h}`;
      }
    }

    setSectionsFromHash();
    if(preserveScroll){
      applyFilter();
      restoreScroll();
    }else{
      applyFilter();
    }
  }

  /* ===== SECTIONS BAR ===== */
  function buildSectionsBar(){
    const bar = $("sectionsBar");
    if(!bar) return;

    bar.innerHTML = SECTIONS.map(s => `
      <button class="secBtn" type="button" data-key="${escapeHtml(s.key)}" aria-pressed="false">${escapeHtml(s.label)}</button>
    `).join("");

    bar.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".secBtn");
      if(!btn) return;

      const key = (btn.getAttribute("data-key") || "vse").toLowerCase();
      const allowed = new Set(SECTIONS.map(s => s.key).filter(k => k !== "vse"));

      if(key === "vse"){
        activeSections = new Set();
        setHashFromActiveSections({ preserveScroll: true });
        return;
      }

      if(!allowed.has(key)) return;

      if(activeSections.has(key)){
        activeSections.delete(key);
      }else{
        activeSections.add(key);
      }

      setHashFromActiveSections({ preserveScroll: true });
    });

    updateSectionsBarActive();
  }

  function updateSectionsBarActive(){
    const bar = $("sectionsBar");
    if(!bar) return;

    const noneSelected = !activeSections || activeSections.size === 0;

    bar.querySelectorAll(".secBtn").forEach(btn => {
      const k = (btn.getAttribute("data-key") || "").toLowerCase();

      const isActive = (k === "vse")
        ? noneSelected
        : (!noneSelected && activeSections.has(k));

      btn.classList.toggle("isActive", isActive);
      btn.setAttribute("aria-current", isActive ? "true" : "false");
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    updateMenuActive();
  }

  /* ===== MENU (drawer) ===== */
  function buildMenu(){
    const menu = $("menuList");
    if(!menu) return;

    menu.innerHTML = SECTIONS.map(s => `
      <div class="menuItem" data-key="${escapeHtml(s.key)}" role="button" tabindex="0" aria-pressed="false">${escapeHtml(s.label)}</div>
    `).join("");

    menu.addEventListener("click", (ev) => {
      const el = ev.target.closest(".menuItem");
      if(!el) return;

      const key = (el.getAttribute("data-key") || "vse").toLowerCase();
      const allowed = new Set(SECTIONS.map(s => s.key).filter(k => k !== "vse"));

      if(key === "vse"){
        activeSections = new Set();
        setHashFromActiveSections({ preserveScroll: true });
        closeMenu();
        return;
      }

      if(!allowed.has(key)) return;

      if(activeSections.has(key)){
        activeSections.delete(key);
      }else{
        activeSections.add(key);
      }

      setHashFromActiveSections({ preserveScroll: true });
      closeMenu();
    });

    menu.addEventListener("keydown", (ev) => {
      const el = ev.target.closest?.(".menuItem");
      if(!el) return;
      if(ev.key === "Enter" || ev.key === " "){
        ev.preventDefault();
        el.click();
      }
    });

    updateMenuActive();
  }

  function updateMenuActive(){
    const menu = $("menuList");
    if(!menu) return;

    const noneSelected = !activeSections || activeSections.size === 0;

    menu.querySelectorAll(".menuItem").forEach(item => {
      const k = (item.getAttribute("data-key") || "").toLowerCase();

      const isActive = (k === "vse")
        ? noneSelected
        : (!noneSelected && activeSections.has(k));

      item.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function openMenu(){
    const o = $("overlay");
    if(o) o.classList.add("show");
  }

  function closeMenu(){
    const o = $("overlay");
    if(o) o.classList.remove("show");
  }

  /* ===== EMAIL CHIPS ===== */
  function buildEmailChips(){
    const wrap = $("emailChips");
    if(!wrap) return;
    wrap.innerHTML = EMAIL_LINKS.map(e => `
      <a class="chipLink" href="${escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer">
        <span class="chipIcon">${escapeHtml(e.ico)}</span>
        <span>${escapeHtml(e.name)}</span>
      </a>
    `).join("");
  }

  /* ===== TOPBAR INFO (datum + svátek) ===== */
  let todayLabel = "";
  let todayName  = "";

  function splitFirstName(full){
    const s = String(full || "").trim();
    if(!s) return { first:"", rest:"" };
    const parts = s.split(/\s+/).filter(Boolean);
    const first = parts.shift() || "";
    const rest  = parts.join(" ");
    return { first, rest };
  }

  function updateTopbarInfo(){
    const el = $("topbarInfo");
    if(!el) return;

    if(!todayLabel){
      el.textContent = "—";
      return;
    }

    if(!todayName){
      el.textContent = `${todayLabel} — dnes má svátek —`;
      return;
    }

    const { first, rest } = splitFirstName(todayName);
    const firstHtml = first ? `<span class="nameFirst">${escapeHtml(first)}</span>` : "—";
    const restHtml  = rest ? ` ${escapeHtml(rest)}` : "";

    el.innerHTML = `${escapeHtml(todayLabel)} — dnes má svátek ${firstHtml}${restHtml}`;
  }

  function initHeaderDate(){
    const now = new Date();
    todayLabel = czDateLabel(now);
    updateTopbarInfo();
  }

  async function loadNamedays(){
    try{
      const res = await fetch(NAMEDAYS_URL, { cache: "no-store" });
      if(!res.ok) return;
      let nd;
      try{
        nd = await res.json();
      }catch(e){
        return;
      }
      if(!nd || typeof nd !== "object") return;

      const now = new Date();
      const mm = String(now.getMonth()+1).padStart(2,"0");
      const dd = String(now.getDate()).padStart(2,"0");
      const key = `${mm}-${dd}`;
      const name = nd[key];

      todayName = name ? String(name) : "";
      updateTopbarInfo();
    }catch(_){}
  }

  /* ===== POČASÍ ===== */
  function mapWeatherIcon(text){
    const t = norm(text);
    if(!t) return "⛅";
    if(t.includes("bouř")) return "⛈️";
    if(t.includes("déšť") || t.includes("dest") || t.includes("mrhol")) return "🌧️";
    if(t.includes("sněh") || t.includes("snih")) return "🌨️";
    if(t.includes("mlha")) return "🌫️";
    if(t.includes("jas")) return "☀️";
    if(t.includes("zataž") || t.includes("zataz")) return "☁️";
    if(t.includes("obla")) return "⛅";
    return "⛅";
  }

  function setWeatherUI({ tempText = "—", locText = "—", descText = "", iconText = "⛅" } = {}){
    const tempEl = $("weatherTemp");
    const locEl  = $("weatherLoc");
    const iconEl = $("weatherIcon");
    const descEl = $("weatherDesc");

    if(tempEl) tempEl.textContent = tempText;
    if(locEl)  locEl.textContent  = locText;
    if(iconEl) iconEl.textContent = iconText;
    if(descEl) descEl.textContent = descText || "—";
  }

  async function loadWeather(){
    try{
      // ✅ FIX: Odstraněn cache:"no-store" - SW cache může fungovat
      const res = await fetch(WEATHER_URL);
      if(!res.ok) throw new Error("weather fetch failed");
      let w;
      try{
        w = await res.json();
      }catch(e){
        throw new Error("weather json parse failed");
      }

      const tempRaw =
        (w?.tempC ?? w?.temp ?? w?.temperature ?? w?.temp_c ?? null);

      const locRaw =
        (w?.location ?? w?.loc ?? w?.city ?? w?.place ?? w?.name ?? w?.station ?? "");

      const descRaw =
        (w?.condition ?? w?.status ?? w?.summary ?? w?.text ?? w?.weather ?? "");

      let tempText = "—";
      if(tempRaw !== null && tempRaw !== undefined && String(tempRaw).trim() !== ""){
        const num = Number(tempRaw);
        tempText = Number.isFinite(num) ? `${Math.round(num)}°C` : `${String(tempRaw).trim()}°C`;
      }

      const locText = String(locRaw || "").trim() || "—";
      const descText = String(descRaw || "").trim();
      const iconText = mapWeatherIcon(descText);

      setWeatherUI({ tempText, locText, descText, iconText });
    }catch(_){
      setWeatherUI({ tempText: "—", locText: "—", descText: "", iconText: "⛅" });
    }
  }

  /* ===== VYHLEDÁVÁNÍ + MODAL ===== */
  let pendingQuery = "";

  function openGoogleSearch(query){
    const q = encodeURIComponent(String(query || "").trim());
    if(!q) return;
    const url = `https://www.google.com/search?q=${q}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function showSearchModal(query){
    const searchModal  = $("searchModal");
    if(!searchModal) return;

    pendingQuery = String(query || "").trim();

    const inp = $("searchInput");
    if(inp) inp.blur();

    setTimeout(() => {
      searchModal.classList.add("show");
    }, 180);
  }

  function hideSearchModal(){
    const searchModal  = $("searchModal");
    if(!searchModal) return;
    searchModal.classList.remove("show");
    pendingQuery = "";
  }

  function clearSearchAndResetFeed(){
    const inp = $("searchInput");
    if(inp) inp.value = "";
    activeQuery = "";
    applyFilter();
  }

  function setupSearch(){
    const form = $("searchForm");
    const inp  = $("searchInput");
    const searchModal = $("searchModal");
    const modalGoogle = $("modalGoogle");
    const modalCancel = $("modalCancel");

    if(form){
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = inp ? inp.value.trim() : "";
        activeQuery = q;
        applyFilter();

        if(q && displayFeed.length === 0){
          showSearchModal(q);
        }
      });
    }

    if(searchModal){
      searchModal.addEventListener("click", (e) => {
        if(e.target === searchModal){
          hideSearchModal();
          clearSearchAndResetFeed();
        }
      });
    }

    if(modalCancel){
      modalCancel.addEventListener("click", () => {
        hideSearchModal();
        clearSearchAndResetFeed();
      });
    }

    if(modalGoogle){
      modalGoogle.addEventListener("click", () => {
        const q = pendingQuery;
        hideSearchModal();
        openGoogleSearch(q);
        clearSearchAndResetFeed();
      });
    }

    window.addEventListener("keydown", (e) => {
      const sm = $("searchModal");
      if(e.key === "Escape" && sm && sm.classList.contains("show")){
        hideSearchModal();
        clearSearchAndResetFeed();
      }
    });
  }

  /* ===== REKLAMA ===== */
  function createAdCard(posLabel){
    const card = document.createElement("article");
    card.className = "ad-card";
    card.innerHTML = `
      <div class="ad-head">
        <span class="pos">${escapeHtml(String(posLabel || ""))}</span>
        <span class="ad-label">Partner</span>
      </div>
      <h3 class="ad-title">Reklamní prostor (brzy)</h3>
      <div class="ad-text">
        Máte zájem o inzerci v tomto prostoru?<br>
        napište na <span class="ad-email">inzerce@infouzel.cz</span>
      </div>
    `;
    return card;
  }

  /* ===== VIDEO: render přes template ===== */
  function cloneTemplate(id){
    const tpl = $(id);
    if(!tpl || !("content" in tpl)) return null;
    return tpl.content.firstElementChild ? tpl.content.firstElementChild.cloneNode(true) : null;
  }

  function buildFeedPauseNode(){
    const n = cloneTemplate("tplFeedPause");
    if(n) return n;

    const div = document.createElement("div");
    div.className = "feedPause";
    div.setAttribute("aria-hidden","true");
    return div;
  }

  function buildVideoNodeFromItem(item){
    const n = cloneTemplate("tplVideoBlock");
    const v = item || null;

    const vid = v ? String(v.videoId || "").trim() : "";
    const title = v ? String(v.title || "").trim() : "";
    const srcUrl = v ? safeUrl(v?.sources?.[0]?.url || "") : "";
    const channel = v ? String(v.channel || "").trim() : "";

    if(n){
      const iframe = n.querySelector("iframe");
      const metaEl = n.querySelector("[data-video-age]");
      const descEl = n.querySelector("[data-video-title]");
      const srcA   = n.querySelector("[data-video-source]");
      const badge  = n.querySelector("[data-video-channel]");

      if(iframe){
        const embedSrc = vid ? ytEmbedUrl(vid) : "";
        if(embedSrc){
          iframe.src = embedSrc;
          iframe.title = title ? `Video: ${title}` : "Video";
        }else{
          iframe.style.display = "none";
          iframe.src = "";
        }
      }

      if(metaEl){
        const ageH = v ? hoursSince(v.publishedAt) : null;
        if(v && Number.isFinite(ageH)){
          const mins = Math.round(ageH * 60);
          metaEl.textContent = mins <= 90 ? `před ${mins} min` : `před ${Math.round(ageH)} h`;
        }else{
          metaEl.textContent = "—";
        }
      }

      if(descEl){
        descEl.textContent = title || "—";
      }

      if(srcA){
        srcA.href = srcUrl || "#";
        srcA.textContent = channel ? `YouTube / ${channel}` : "YouTube / oficiální kanál";
      }

      if(badge){
        if(channel){
          badge.textContent = channel;
          badge.style.display = "inline-flex";
        }else{
          badge.style.display = "none";
        }
      }

      return n;
    }

    // fallback
    const card = document.createElement("article");
    card.className = "videoRow";
    card.setAttribute("data-kind","video");

    const iframeSrc = vid ? ytEmbedUrl(vid) : "";
    const ageH = v ? hoursSince(v.publishedAt) : null;
    const meta = (v && Number.isFinite(ageH))
      ? ((Math.round(ageH * 60) <= 90) ? `před ${Math.round(ageH * 60)} min` : `před ${Math.round(ageH)} h`)
      : "—";

    const iframeHtml = iframeSrc
      ? `<iframe title="${escapeAttr(title ? `Video: ${title}` : "Video")}"
                  src="${escapeHtml(iframeSrc)}"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerpolicy="strict-origin-when-cross-origin"
                  allowfullscreen></iframe>`
      : `<div style="padding:56.25% 0 0 0;background:rgba(0,0,0,0.05);display:flex;align-items:center;justify-content:center;color:rgba(11,27,43,0.4);font-size:14px;">Video není k dispozici</div>`;

    card.innerHTML = `
      <div class="videoCardInner">
        <div class="videoTop">
          <div class="videoTitle">Video – souvislosti k tématu</div>
          <div class="videoMeta">${escapeHtml(meta)}</div>
        </div>
        <div class="videoFrame">
          ${iframeHtml}
        </div>
        <div class="videoDesc">${escapeHtml(title || "—")}</div>
        <div class="videoSource">Zdroj: <a href="${escapeHtml(srcUrl || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(channel ? `YouTube / ${channel}` : "YouTube / oficiální kanál")}</a></div>
      </div>
    `;
    return card;
  }

  /* ===== VIDEO: výběr pro sloty (priorita kanálů + nejnovější) ===== */
  function pickVideosForSlots(videos, n){
    const vids = Array.isArray(videos) ? videos : [];
    return vids
      .slice()
      .filter(v => norm(v.contentType) === "video" && v.publishedAt && v.videoId && isAllowedChannel(v.channel))
      .sort((a,b) => {
        const pa = channelPriority(a.channel);
        const pb = channelPriority(b.channel);
        if(pb !== pa) return pb - pa;

        const ta = new Date(a.publishedAt || 0).getTime();
        const tb = new Date(b.publishedAt || 0).getTime();
        if(!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
        if(!Number.isFinite(ta)) return 1;
        if(!Number.isFinite(tb)) return -1;
        return tb - ta;
      })
      .slice(0, n);
  }

  /* ===== LAYOUT FEED: články → video → banner (s pauzou) ===== */
  function buildDisplayFeedFromBase(baseItems, { injectSlots = false } = {}){
    const base = Array.isArray(baseItems) ? baseItems : [];

    if(!injectSlots){
      // bannery po N článcích (stabilně)
      return injectBannersIntoFeed(base);
    }

    const videos = Array.isArray(allVideos) ? allVideos : [];
    const picked = pickVideosForSlots(videos, VIDEO_SLOTS_AFTER_ARTICLE.length);

    const out = [];
    let articleCount = 0;
    let vi = 0;

    for(const it of base){
      const isVideo = norm(it.contentType) === "video";
      const isArticle = !isVideo;

      out.push(it);

      if(isArticle){
        articleCount += 1;

        if(VIDEO_SLOTS_AFTER_ARTICLE.includes(articleCount) && picked[vi]){
          out.push(picked[vi]);
          vi += 1;
        }
      }
    }

    return injectBannersIntoFeed(out);
  }

  function injectBannersIntoFeed(items){
    const src = Array.isArray(items) ? items : [];
    const out = [];

    let articleCount = 0;
    let bannerIndex = 0;

    for(let i=0;i<src.length;i++){
      const it = src[i];
      out.push(it);

      const isVideo = norm(it?.contentType) === "video";
      const isArticle = !isVideo && norm(it?.contentType) !== "ad";

      if(isArticle){
        articleCount += 1;

        if(isBannerAfterArticleCount(articleCount)){
          bannerIndex += 1;
          out.push({
            contentType: "ad",
            adLabel: `#${bannerIndex}`
          });
        }
      }
    }

    return out;
  }

  /* ===== "NAČÍST DALŠÍ" BUTTON ===== */
  function ensureLoadMoreUI(){
    const list = $("newsList");
    if(!list) return;

    let wrap = $("loadMoreWrap");
    if(!wrap){
      wrap = document.createElement("div");
      wrap.id = "loadMoreWrap";
      wrap.style.maxWidth = "var(--readWidth)";
      wrap.style.margin = "16px auto 0";
      wrap.style.display = "grid";
      wrap.style.placeItems = "center";
      wrap.style.gap = "10px";
      wrap.style.padding = "2px 0 0";

      const btn = document.createElement("button");
      btn.id = "loadMoreBtn";
      btn.type = "button";
      btn.textContent = "Načíst další";
      btn.setAttribute("aria-label","Načíst další položky");

      // výrazné tlačítko (inline styl, aby se nic nerozbilo bez úprav indexu)
      btn.style.height = "48px";
      btn.style.padding = "0 18px";
      btn.style.borderRadius = "16px";
      btn.style.border = "1px solid rgba(20,40,70,0.14)";
      btn.style.background = "rgba(255,255,255,0.92)";
      btn.style.boxShadow = "0 12px 28px rgba(20,40,70,0.08)";
      btn.style.fontWeight = "800";
      btn.style.cursor = "pointer";
      btn.style.webkitTapHighlightColor = "transparent";
      btn.style.color = "rgba(11,27,43,0.90)";
      btn.style.letterSpacing = "0.01em";

      btn.addEventListener("mouseenter", () => {
        btn.style.borderColor = "rgba(31,75,153,0.28)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.borderColor = "rgba(20,40,70,0.14)";
      });

      btn.addEventListener("click", () => {
        const step = pageStepForCurrentView();
        renderedLimit = Math.min(displayFeed.length, renderedLimit + step);
        renderUpToLimit();
        updateLoadMoreVisibility();
      });

      const hint = document.createElement("div");
      hint.id = "loadMoreHint";
      hint.style.fontSize = "12px";
      hint.style.fontWeight = "560";
      hint.style.color = "rgba(11,27,43,0.55)";
      hint.style.textAlign = "center";
      hint.textContent = "";

      wrap.appendChild(btn);
      wrap.appendChild(hint);

      // vložit za seznam
      list.insertAdjacentElement("afterend", wrap);
    }
  }

  function updateLoadMoreVisibility(){
    const btn = $("loadMoreBtn");
    const hint = $("loadMoreHint");
    const wrap = $("loadMoreWrap");
    if(!wrap || !btn || !hint) return;

    const hasMore = renderedItems < displayFeed.length;

    wrap.style.display = (displayFeed.length > 0) ? "grid" : "none";
    btn.style.display = hasMore ? "inline-flex" : "none";

    // text typu "Zobrazeno 120 z 1000"
    const shown = Math.min(renderedItems, displayFeed.length);
    hint.textContent = `Zobrazeno ${shown} z ${displayFeed.length}`;
  }

  function pageStepForCurrentView(){
    // pokud je "Vše" bez vyhledávání => větší krok
    const noneSelected = !activeSections || activeSections.size === 0;
    if(noneSelected && !activeQuery) return PAGE_SIZE_ALL;
    return PAGE_SIZE_SECTION;
  }

  function initialLimitForCurrentView(){
    const noneSelected = !activeSections || activeSections.size === 0;
    if(noneSelected && !activeQuery) return PAGE_SIZE_ALL;
    return PAGE_SIZE_SECTION;
  }

  /* ===== FILTR (ÚKOL 4t: multi-select) ===== */
  function applyFilter(){
    const noneSelected = !activeSections || activeSections.size === 0;

    const activeLabels = noneSelected
      ? ["Vše"]
      : Array.from(activeSections)
          .map(k => SECTIONS.find(s => s.key === k)?.label || k)
          .filter(Boolean);

    const qLabel = activeQuery ? ` · Hledání: „${activeQuery}“` : "";

    const secLabel = $("sectionLabel");
    if(secLabel){
      const joined = activeLabels.join(" + ");
      secLabel.textContent = `Sekce: ${joined}${qLabel}`;
    }

    updateSectionsBarActive();

    // ZÁKLAD
    let base = [];

    if(noneSelected){
      // Default: "Vše"
      if(!activeQuery){
        // pevné video sloty mezi články + bannery
        const articles = Array.isArray(allArticles) ? allArticles : [];
        base = buildDisplayFeedFromBase(articles.slice(), { injectSlots: true });
      }else{
        // při hledání chceme hledat i ve videích i článcích, a pak do toho vložit bannery
        const items = Array.isArray(allItems) ? allItems : [];
        base = buildDisplayFeedFromBase([...items], { injectSlots: false });
      }
    }else{
      // vybrané sekce: články + videa dohromady
      const items = Array.isArray(allItems) ? allItems : [];
      const picked = items.filter(a => {
        if(!a || typeof a !== "object") return false;
        const s = norm(a.section);
        for(const k of activeSections){
          if(s === k) return true;
        }
        return false;
      });

      base = buildDisplayFeedFromBase(picked, { injectSlots: false });
    }

    // Vyhledávání
    if(activeQuery){
      const q = norm(activeQuery);
      filtered = base.filter(a => {
        const ct  = norm(a?.contentType || "article");

        if(ct === "ad"){
          // reklamu při hledání necháme (stabilita layoutu)
          return true;
        }

        const title = norm(a?.title);
        const sec = norm(a?.section);
        const sources = Array.isArray(a?.sources) ? a.sources : [];
        const sourceNames = sources.map(s => norm(s?.name)).join(" ");

        return title.includes(q) || sec.includes(q) || sourceNames.includes(q) || ct.includes(q);
      });
    }else{
      filtered = base;
    }

    displayFeed = filtered;

    // reset renderu
    renderedItems = 0;
    renderedLimit = Math.min(displayFeed.length, initialLimitForCurrentView());

    const list = $("newsList");
    // ✅ FIX: Použití replaceChildren() místo innerHTML="" (rychlejší, bez reflow)
    if(list) {
      // Zruš probíhající render pokud existuje
      if(currentRenderCancel) {
        currentRenderCancel.cancel();
        currentRenderCancel = null;
      }
      list.replaceChildren();
    }

    const empty = $("emptyBox");
    if(empty) empty.style.display = (displayFeed.length === 0) ? "block" : "none";

    ensureLoadMoreUI();
    // ✅ FIX: Render přes requestAnimationFrame (ne synchronně)
    requestAnimationFrame(() => {
      renderUpToLimit();
      updateLoadMoreVisibility();
    });
  }


  /* ===== RENDER (CHUNKED PROTI ZAMRZNUTÍ) ===== */
  let renderInProgress = false;
  let currentRenderCancel = null; // Cancel token pro aktuální render

  function renderUpToLimit(){
    const list = $("newsList");
    if(!list) return;

    // ✅ FIX: Zruš probíhající render před spuštěním nového
    if(renderInProgress && currentRenderCancel) {
      currentRenderCancel.cancel();
      currentRenderCancel = null;
      renderInProgress = false;
    }

    const totalToRender = Math.min(displayFeed.length, renderedLimit);
    const alreadyRendered = renderedItems;
    
    if(alreadyRendered >= totalToRender) return;

    const itemsToRender = totalToRender - alreadyRendered;

    // Pro malé množství (< 50) použij původní rychlý render
    // Pro větší použij chunked rendering
    const useChunked = itemsToRender > 50 || (window.__iuRenderOptimizer && window.__iuRenderOptimizer.RENDER_CHUNK_SIZE);

    if(useChunked && window.__iuRenderOptimizer) {
      renderInProgress = true;
      
      // ✅ FIX: Cancel token pro možnost zrušení renderu
      const cancelToken = { cancelled: false };
      
      // Funkce pro render jedné položky
      function renderSingleItem(index) {
        const actualIndex = alreadyRendered + index;
        if(actualIndex >= displayFeed.length || actualIndex >= renderedLimit) return null;

        const a = displayFeed[actualIndex];
        if(!a || typeof a !== "object") return null;

        const ct = norm(a?.contentType || "article");

        if(ct === "ad"){
          const pause = buildFeedPauseNode();
          const ad = createAdCard(a?.adLabel || "Partner");
          const wrapper = document.createDocumentFragment();
          wrapper.appendChild(pause);
          wrapper.appendChild(ad);
          return wrapper;
        }

        if(ct === "video"){
          const pause = buildFeedPauseNode();
          const video = buildVideoNodeFromItem(a);
          const wrapper = document.createDocumentFragment();
          wrapper.appendChild(pause);
          wrapper.appendChild(video);
          return wrapper;
        }

        // ARTICLE
        const card = document.createElement("article");
        card.className = "news-card";

        const time = fmtTime(a.publishedAt);
        const rawTitle = String(a.title || "").trim();
        const titleText = rawTitle.trim();
        const titleHtml = escapeHtml(titleText);
        const sourcesAll = Array.isArray(a.sources) ? a.sources : [];
        const sources = sourcesAll;
        const primaryUrl = safeUrl(sources?.[0]?.url || "");

        const domainsHtml = (sources && sources.length)
          ? sources.map(s => {
              const u = safeUrl(s?.url || "");
              const dom = domainFromUrl(u);
              const label = escapeHtml(dom || "www");
              const href = escapeHtml(u || "#");
              return `<a class="sourceDomain" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
            }).join(`<span class="srcSep"> · </span>`)
          : `<span style="color:rgba(11,27,43,0.55);font-weight:600;font-size:11.5px;">—</span>`;

        const titleLinkHref = escapeHtml(primaryUrl || "#");
        const titleAttr = escapeAttr(titleText || "");

        card.innerHTML = `
          <h3 class="news-title">
            <a class="news-titleLink"
               href="${titleLinkHref}"
               target="_blank"
               rel="noopener noreferrer"
               title="${titleAttr}"
               aria-label="${titleAttr}">
              ${titleHtml || "—"}
            </a>
          </h3>

          <div class="news-row2">
            <span class="meta-time">${escapeHtml(time)}</span>
            <span class="news-sourceLabel">Zdroj:</span>
            <div class="news-sources">${domainsHtml}</div>
          </div>
        `;

        return card;
      }

      // ✅ FIX: Performance mark pro render
      if (DEBUG && performance.mark) {
        performance.mark("render_feed_start");
      }
      const renderStart = performance.now();

      // ✅ FIX: Chunked render s cancel tokenem přes requestAnimationFrame
      currentRenderCancel = window.__iuRenderOptimizer.renderChunked(
        renderSingleItem,
        itemsToRender,
        list,
        {
          chunkSize: 25, // ✅ FIX: Menší chunk pro lepší responsivitu
          cancelToken: cancelToken,
          onProgress: (current, total) => {
            if(!cancelToken.cancelled) {
              renderedItems = alreadyRendered + current;
              updateLoadMoreVisibility();
            }
          },
          onComplete: (total) => {
            if(!cancelToken.cancelled) {
              renderedItems = alreadyRendered + total;
              renderInProgress = false;
              currentRenderCancel = null;
              
              // ✅ FIX: Performance measure a log
              const renderDuration = performance.now() - renderStart;
              if (DEBUG && performance.mark && performance.measure) {
                performance.mark("render_feed_end");
                performance.measure("render_feed", "render_feed_start", "render_feed_end");
                debugLog(`Render feed: ${Math.round(renderDuration)}ms, items: ${total}`);
              }

              updateLoadMoreVisibility();
              
              // Enforce DOM limit
              if(window.__iuRenderOptimizer) {
                window.__iuRenderOptimizer.enforceDOMLimit(list);
              }
            }
          }
        }
      );
    } else {
      // Původní rychlý render pro malé feedy
      const frag = document.createDocumentFragment();

      while(renderedItems < displayFeed.length && renderedItems < renderedLimit){
        const a = displayFeed[renderedItems];
        if(!a || typeof a !== "object"){
          renderedItems += 1;
          continue;
        }
        const ct = norm(a?.contentType || "article");

        if(ct === "ad"){
          frag.appendChild(buildFeedPauseNode());
          frag.appendChild(createAdCard(a?.adLabel || "Partner"));
          renderedItems += 1;
          continue;
        }

        if(ct === "video"){
          frag.appendChild(buildFeedPauseNode());
          frag.appendChild(buildVideoNodeFromItem(a));
          renderedItems += 1;
          continue;
        }

        // ARTICLE
        const card = document.createElement("article");
        card.className = "news-card";

        const time = fmtTime(a.publishedAt);
        const rawTitle = String(a.title || "").trim();
        const titleText = rawTitle.trim();
        const titleHtml = escapeHtml(titleText);
        const sourcesAll = Array.isArray(a.sources) ? a.sources : [];
        const sources = sourcesAll;
        const primaryUrl = safeUrl(sources?.[0]?.url || "");

        const domainsHtml = (sources && sources.length)
          ? sources.map(s => {
              const u = safeUrl(s?.url || "");
              const dom = domainFromUrl(u);
              const label = escapeHtml(dom || "www");
              const href = escapeHtml(u || "#");
              return `<a class="sourceDomain" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
            }).join(`<span class="srcSep"> · </span>`)
          : `<span style="color:rgba(11,27,43,0.55);font-weight:600;font-size:11.5px;">—</span>`;

        const titleLinkHref = escapeHtml(primaryUrl || "#");
        const titleAttr = escapeAttr(titleText || "");

        card.innerHTML = `
          <h3 class="news-title">
            <a class="news-titleLink"
               href="${titleLinkHref}"
               target="_blank"
               rel="noopener noreferrer"
               title="${titleAttr}"
               aria-label="${titleAttr}">
              ${titleHtml || "—"}
            </a>
          </h3>

          <div class="news-row2">
            <span class="meta-time">${escapeHtml(time)}</span>
            <span class="news-sourceLabel">Zdroj:</span>
            <div class="news-sources">${domainsHtml}</div>
          </div>
        `;

        frag.appendChild(card);
        renderedItems += 1;
      }

      list.appendChild(frag);
    }
  }

  /* ===== ARTICLES LOAD ===== */
  function extractArticlesPayload(data){
    if(Array.isArray(data)){
      return { arr: data, generatedAt: "" };
    }

    const gen =
      (data && typeof data === "object" && (data.generatedAt || data.updatedAt || data.generated_at))
        ? String(data.generatedAt || data.updatedAt || data.generated_at)
        : "";

    const arr =
      (data && typeof data === "object" && Array.isArray(data.articles)) ? data.articles :
      (data && typeof data === "object" && Array.isArray(data.items)) ? data.items :
      [];

    return { arr, generatedAt: gen };
  }

  function signatureOf(arr, generatedAt){
    try{
      const n = Array.isArray(arr) ? arr.length : 0;
      const first = (Array.isArray(arr) && arr[0]) ? arr[0] : null;
      const t = first?.title ?? "";
      const p = first?.publishedAt ?? "";
      const ct = first?.contentType ?? "";
      return `${generatedAt || ""}::${n}::${String(p)}::${String(ct)}::${String(t).slice(0,60)}`;
    }catch(_){
      return `${generatedAt || ""}::0`;
    }
  }

  function signatureOfVideos(videosArr, generatedAt){
    try{
      const n = Array.isArray(videosArr) ? videosArr.length : 0;
      const first = (Array.isArray(videosArr) && videosArr[0]) ? videosArr[0] : null;
      const t = first?.title ?? "";
      const p = first?.publishedAt ?? "";
      const id = first?.videoId ?? "";
      return `${generatedAt || ""}::${n}::${String(p)}::${String(id)}::${String(t).slice(0,60)}`;
    }catch(_){
      return `${generatedAt || ""}::0`;
    }
  }

  async function loadArticlesOnly({ silent = false } = {}){
    // ✅ FIX: Použití pouze window.__iuSafeFetch.fetchJSON (žádný vlastní fetch)
    const safeFetch = window.__iuSafeFetch?.fetchJSON || window.__iuSafeFetch?.safeFetchJSON;

    if (!safeFetch) {
      console.error("[IU] safeFetch missing - crash shield not loaded");
      if (DEBUG) {
        debugLog("BASE:", BASE);
        debugLog("window.__iuSafeFetch:", window.__iuSafeFetch);
      }
      return { changed:false, items:[] };
    }

    const articlesUrl = makeDataUrl("data/articles.json", { bust: true });

    if (DEBUG) {
      debugLog("loadArticlesOnly: BASE=", BASE, "safeFetch available:", !!safeFetch);
    }

    // ✅ FIX: Performance mark pro observabilitu
    if (DEBUG && performance.mark) {
      performance.mark("fetch_articles_start");
    }
    const fetchStart = performance.now();

    const result = await safeFetch("articles", articlesUrl, { silent });
    
    // ✅ FIX: result.ok může být false, ale result.data může existovat (cache fallback)
    if (!result) {
      console.error("[IU] safeFetch returned null");
      if (DEBUG) {
        debugLog(`Fetch articles failed: null result`);
      }
      if(!silent){
        setDataUpdatedAtLabel("");
      }
      return { changed:false, items:[] };
    }
    
    // ✅ FIX: Pokud není data ani v fallbacku, vrať prázdné pole
    if (!result.data) {
      if (DEBUG) {
        debugLog(`Fetch articles failed: no data, error=`, result?.error || "unknown error");
      }
      if(!silent){
        setDataUpdatedAtLabel("");
      }
      return { changed:false, items:[] };
    }

    const data = result.data;

    // ✅ FIX: Performance measure
    const fetchDuration = performance.now() - fetchStart;
    if (DEBUG && performance.mark && performance.measure) {
      performance.mark("fetch_articles_end");
      performance.measure("fetch_articles", "fetch_articles_start", "fetch_articles_end");
    }

    // ✅ FIX: Unwrap pomocí univerzální funkce
    const arr = unwrapToArray(data);

    if (DEBUG) {
      console.log("articles loaded:", arr.length, articlesUrl);
      debugLog(`Fetch articles: ok=${result.ok}, source=${result?.source || "network"}, items=${arr.length}, error=${result?.error?.message || "none"}`);
      if(arr.length > 0){
        debugLog("[DATA] articles first:", {
          title: arr[0].title,
          source: (Array.isArray(arr[0]?.sources) && arr[0].sources[0]?.name) || ""
        });
      }
    }
    
    // Extrahuj generatedAt pokud existuje
    const generatedAt = data?.generatedAt || data?.updatedAt || data?.generated_at || "";
    setDataUpdatedAtLabel(generatedAt);

    // Signature check pro detekci změny
    const sig = signatureOf(arr, generatedAt);
    if(sig && sig === lastDataSignature){
      return { changed:false, items: null };
    }
    lastDataSignature = sig;

    // Normalizace a merge
    let out = arr.map(normalizeArticle);
    out = mergeByExactTitle(out);

    return { changed:true, items: out };
  }

  async function loadVideosOnly(){
    // ✅ FIX: Použití pouze window.__iuSafeFetch.fetchJSON (žádný vlastní fetch)
    const safeFetch = window.__iuSafeFetch?.fetchJSON || window.__iuSafeFetch?.safeFetchJSON;

    if (!safeFetch) {
      console.error("[IU] safeFetch missing - crash shield not loaded");
      return { changed:false, items:[] };
    }

    // ✅ FIX: Performance mark pro observabilitu
    if (DEBUG && performance.mark) {
      performance.mark("fetch_videos_start");
    }
    const fetchStart = performance.now();

    const result = await safeFetch("videos", VIDEOS_URL, { silent: true });
    
    // ✅ FIX: result.ok může být false, ale result.data může existovat (cache fallback)
    if (!result) {
      console.error("[IU] safeFetch videos returned null/undefined");
      return { changed:false, items:[] };
    }
    
    // ✅ FIX: Pokud není data ani v fallbacku, vrať prázdné pole
    if (!result.data) {
      if (DEBUG) {
        debugLog(`Fetch videos failed: no data, error=`, result?.error || "unknown error");
      }
      return { changed:false, items:[] };
    }

    const data = result.data;

    // ✅ FIX: Performance measure a log
    const fetchDuration = performance.now() - fetchStart;
    if (DEBUG && performance.mark && performance.measure) {
      performance.mark("fetch_videos_end");
      performance.measure("fetch_videos", "fetch_videos_start", "fetch_videos_end");
    }

    // ✅ FIX: Unwrap pomocí univerzální funkce
    const arr = unwrapToArray(data);

    if (DEBUG) {
      console.log("videos loaded:", arr.length, VIDEOS_URL);
    }
    
    // ✅ FIX: Debug log výsledku fetch
    if (DEBUG) {
      debugLog(`Fetch videos: ok=${result.ok}, source=${result?.source || "network"}, items=${arr.length}, error=${result?.error?.message || "none"}`);
    }
    
    // Extrahuj generatedAt pokud existuje
    const gen = data?.generatedAt || data?.updatedAt || data?.generated_at || "";

    // Signature check pro detekci změny
    const sig = signatureOfVideos(arr, gen);
    if(sig && sig === lastVideosSignature){
      return { changed:false, items: null };
    }
    lastVideosSignature = sig;

    // Normalizace videí
    const items = [];
    for(const v of arr){
      const it = normalizeVideoAsItem(v);
      if(it) items.push(it);
    }

    return { changed:true, items };
  }

  async function loadAllItems({ silent = false } = {}){
    const [aRes, vRes] = await Promise.all([
      loadArticlesOnly({ silent }),
      loadVideosOnly()
    ]);

    if(aRes.changed === false && vRes.changed === false){
      return false;
    }

    const articles = (aRes.items !== null) ? aRes.items : null;
    const videos   = (vRes.items !== null) ? vRes.items : null;

    let currentArticles = [];
    let currentVideos = [];

    for(const it of (Array.isArray(allItems) ? allItems : [])){
      if(norm(it.contentType) === "video") currentVideos.push(it);
      else currentArticles.push(it);
    }

    const nextArticles = (articles !== null) ? articles : currentArticles;
    const nextVideos   = (videos !== null) ? videos : currentVideos;

    allArticles = nextArticles.slice().filter(x => norm(x.contentType) !== "video");
    allVideos   = nextVideos.slice().filter(x => norm(x.contentType) === "video");

    let combined = [...nextArticles, ...nextVideos];

    combined.sort((a,b) => {
      const ta = new Date(a.publishedAt || 0).getTime();
      const tb = new Date(b.publishedAt || 0).getTime();
      if(!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if(!Number.isFinite(ta)) return 1;
      if(!Number.isFinite(tb)) return -1;
      return tb - ta;
    });

    allItems = combined;

    if(!silent){
      applyFilter();
    }

    return true;
  }

  /* ===== INIT ===== */
  let initCalled = false;
  let weatherIntervalId = null;
  let dataRefreshIntervalId = null;

  async function init(){
    // ✅ FIX: Ochrana proti duplicitnímu spuštění
    if (initCalled) {
      if (DEBUG) console.warn("[infoUzel] init() už byl volán, přeskočeno");
      return;
    }
    initCalled = true;

    syncTopbarOffset();
    window.addEventListener("resize", syncTopbarOffset);
    window.addEventListener("orientationchange", () => setTimeout(syncTopbarOffset, 50));
    setTimeout(syncTopbarOffset, 50);

    initHeaderDate();
    setDataUpdatedAtLabel("");

    buildEmailChips();
    buildSectionsBar();
    buildMenu();
    setupSearch();

    // hamburger menu now handled in index appMenuOverlay (no direct Section toggle here)

    setSectionsFromHash();

    await Promise.all([
      loadAllItems({ silent:true }),
      loadWeather(),
      loadNamedays()
    ]);

    applyFilter();

    // ✅ FIX: Ochrana proti duplicitnímu spuštění intervalů
    if (weatherIntervalId === null) {
      weatherIntervalId = setInterval(loadWeather, 300000);
    }

    // auto-refresh dat (bez "poskoku": my stejně přerenderujeme od začátku jen při změně)
    if (dataRefreshIntervalId === null) {
      dataRefreshIntervalId = setInterval(async () => {
        if(document.visibilityState !== "visible") return;
        await loadAllItems({ silent:false });
      }, 180000);
    }

    document.addEventListener("visibilitychange", () => {
      if(document.visibilityState === "visible"){
        loadWeather();
        loadAllItems({ silent:false });
      }
    });
  }

  // Když uživatel ručně změní hash / použije zpět/vpřed:
  window.addEventListener("hashchange", () => {
    freezeScroll();
    setSectionsFromHash();
    applyFilter();
    restoreScroll();
  });

  // ✅ FIX: Ochrana proti duplicitnímu spuštění - použij pouze jeden způsob
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    // Pokud už je DOM ready, spusť init asynchronně, aby se nestalo, že se zavolá 2x
    setTimeout(init, 0);
  }
})();
