(() => {
  const $ = (sel) => document.querySelector(sel);

  const elStatus = $("#dataStatus");
  const elFeed = $("#feed");
  const elDebugPanel = $("#debugPanel");
  const elDebugOut = $("#debugOut");
  const elDataCount = $("#dataCount");
  const btnToggleDebug = $("#toggleDebugBtn");

  const DATA_URL = "./data/articles.json";
  const LS_KEY = "iu:debug";

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

  function escapeAttr(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("\"", "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function renderEmpty(message, extraHtml = "") {
    if (!elFeed) return;
    elFeed.innerHTML = `
      <div class="empty">
        <div>${message}</div>
        ${extraHtml ? `<div style="margin-top:10px">${extraHtml}</div>` : ""}
      </div>
    `;
    if (elDataCount) elDataCount.textContent = "0";
  }

  function renderItems(items) {
    if (!elFeed) return;
    if (!items || items.length === 0) {
      renderEmpty(
        "Žádná data k zobrazení.",
        `Tip: zapni <b>debug</b> (tlačítko nahoře nebo <code>?debug=1</code>) a zkontroluj strukturu JSON.`
      );
      writeDebug({
        ok: true,
        note: "Žádné položky k zobrazení",
        itemsCount: 0,
      });
      if (elDataCount) elDataCount.textContent = "0";
      return;
    }

    const html = items
      .map((it) => {
        const title = safeText(it.title || it.name || "(bez názvu)");
        const publishedAt = fmtDate(it.publishedAt || it.date || it.published || "");
        const sourceName =
          safeText(
            (it.source && (it.source.name || it.source.title)) || it.sourceName || it.source || ""
          );
        const url =
          safeText(it.url || (it.link && (it.link.href || it.link)) || it.href || "");

        const metaBits = [];
        if (sourceName) metaBits.push(`<span>Zdroj: <b>${escapeHtml(sourceName)}</b></span>`);
        if (publishedAt) metaBits.push(`<span>Publikováno: ${escapeHtml(publishedAt)}</span>`);
        if (url)
          metaBits.push(`<a href="${escapeAttr(url)}" target="_blank" rel="noopener">Otevřít</a>`);

        return `
          <article class="card">
            <div class="titleRow">
              <h2>${escapeHtml(title)}</h2>
            </div>
            <div class="meta">${metaBits.join(" · ")}</div>
          </article>
        `;
      })
      .join("");

    elFeed.innerHTML = html;
    if (elDataCount) elDataCount.textContent = String(items.length);
  }

  function writeDebug(obj) {
    if (!elDebugOut) return;
    try {
      elDebugOut.textContent = JSON.stringify(obj, null, 2);
    } catch {
      elDebugOut.textContent = String(obj);
    }
  }

  async function loadData() {
    const startedAt = new Date();
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

      const items = normalizeItems(data);
      setStatus(`Stav dat: OK (${items.length} položek)`);
      renderItems(items);

      if (isDebugOn()) {
        writeDebug({
          ok: true,
          url: DATA_URL,
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          rawType: Array.isArray(data) ? "array" : typeof data,
          keys:
            data && typeof data === "object" && !Array.isArray(data)
              ? Object.keys(data)
              : [],
          itemsCount: items.length,
          sample: items.slice(0, 3),
        });
      }
    } catch (err) {
      setStatus("Stav dat: chyba (nelze načíst)");
      renderEmpty(
        "Data se nepodařilo načíst. Stránka funguje, ale nemá co vykreslit.",
        `
        <div>
          <a href="${DATA_URL}" target="_blank" rel="noopener">Otevřít ${DATA_URL}</a>
          &nbsp;|&nbsp;
          <a href="?debug=1">Zapnout debug</a>
        </div>
        <div style="margin-top:8px">
          Pozn.: Soubor <code>articles.json</code> může dočasně chybět (generuje se jiným workflow). Deploy na Pages kvůli tomu nesmí padat.
        </div>
        `
      );

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

  function init() {
    renderDebugVisibility();

    if (btnToggleDebug) {
      btnToggleDebug.addEventListener("click", () => {
        setDebug(!isDebugOn());
        if (isDebugOn() && (!elDebugOut || !elDebugOut.textContent.trim())) {
          writeDebug({ note: "Debug aktivní. Pokud data nejdou načíst, uvidíš chybu zde." });
        }
      });
    }

    loadData();
  }

  init();
})();
