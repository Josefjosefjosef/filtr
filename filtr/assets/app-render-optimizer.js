/* app-render-optimizer.js
   infoUzel.cz – Chunked Rendering + Watchdog + Performance Optimizations
   Cíl: žádné zamrznutí UI, bezpečný render i pro velké feedy
*/

(() => {
  "use strict";

  // =========================
  // === KONFIGURACE
  // =========================

  const RENDER_CHUNK_SIZE = 30;           // kolik položek renderovat najednou
  const RENDER_CHUNK_DELAY_MS = 8;       // delay mezi chunky (ms)
  const RENDER_TIMEOUT_MS = 400;         // pokud render trvá déle, přepni do chunked režimu
  const MAX_DOM_ITEMS = 250;             // max počet položek v DOM (pak virtualizace)
  const FETCH_SEMAPHORE_MAX = 3;         // max paralelních fetchů

  // =========================
  // === WATCHDOG PROTI ZAMRZNUTÍ
  // =========================

  let renderWatchdogActive = false;
  let renderStartTime = 0;
  let renderTimeoutId = null;

  // ✅ FIX: Debug flag pro watchdog
  const DEBUG = (() => {
    try {
      const urlDebug = new URLSearchParams(location.search).get("debug") === "1";
      const storageDebug = localStorage.getItem("iu:debug") === "1";
      return urlDebug || storageDebug;
    } catch (e) {
      return false;
    }
  })();

  function startRenderWatchdog(timeoutMs = RENDER_TIMEOUT_MS) {
    if (renderWatchdogActive) return;
    renderWatchdogActive = true;
    renderStartTime = performance.now();
    
    renderTimeoutId = setTimeout(() => {
      if (renderWatchdogActive) {
        if (DEBUG) {
          console.warn("[infoUzel] Render watchdog: render trvá déle než", timeoutMs, "ms");
        }
        renderWatchdogActive = false;
      }
    }, timeoutMs);
  }

  function stopRenderWatchdog() {
    renderWatchdogActive = false;
    if (renderTimeoutId) {
      clearTimeout(renderTimeoutId);
      renderTimeoutId = null;
    }
    const duration = performance.now() - renderStartTime;
    if (DEBUG && duration > 100) {
      console.log("[infoUzel] Render dokončen za", Math.round(duration), "ms");
    }
  }

  // =========================
  // === CHUNKED RENDERING
  // =========================

  /**
   * Renderuje feed po blocích (chunks) pomocí requestAnimationFrame
   * @param {Function} renderFn - funkce, která renderuje jednu položku (index) a vrací DOM node
   * @param {number} totalItems - celkový počet položek k renderování
   * @param {HTMLElement} container - kontejner, kam se přidávají položky
   * @param {Object} opts - { chunkSize, onProgress, onComplete, cancelToken }
   * @returns {Object} - { cancel: function } pro zrušení renderu
   */
  function renderChunked(renderFn, totalItems, container, opts = {}) {
    const chunkSize = opts.chunkSize || RENDER_CHUNK_SIZE;
    const onProgress = opts.onProgress || (() => {});
    const onComplete = opts.onComplete || (() => {});
    const cancelToken = opts.cancelToken || { cancelled: false };
    
    let currentIndex = 0;
    let rafId = null;
    let frag = document.createDocumentFragment();
    let chunkNodes = [];
    let cancelled = false;

    function processChunk() {
      // Zkontroluj cancel token
      if (cancelToken.cancelled || cancelled) {
        stopRenderWatchdog();
        return;
      }

      const startTime = performance.now();
      const endIndex = Math.min(currentIndex + chunkSize, totalItems);
      
      // Renderuj chunk
      for (let i = currentIndex; i < endIndex; i++) {
        if (cancelToken.cancelled || cancelled) break;
        
        try {
          const node = renderFn(i);
          if (node) {
            chunkNodes.push(node);
            frag.appendChild(node);
          }
        } catch (e) {
          console.warn("[infoUzel] Chyba při renderování položky", i, e);
        }
      }

      // Přidej chunk do DOM najednou (minimalizace reflow)
      if (chunkNodes.length > 0 && !cancelled && !cancelToken.cancelled) {
        container.appendChild(frag);
        // Vytvoř nový fragment pro další chunk
        frag = document.createDocumentFragment();
        chunkNodes = [];
      }

      currentIndex = endIndex;
      const chunkDuration = performance.now() - startTime;

      // Progress callback
      if (!cancelled && !cancelToken.cancelled) {
        onProgress(currentIndex, totalItems);
      }

      // Pokud ještě zbývají položky, pokračuj v dalším chunk přes requestAnimationFrame
      if (currentIndex < totalItems && !cancelled && !cancelToken.cancelled) {
        rafId = requestAnimationFrame(() => {
          processChunk();
        });
      } else {
        // Hotovo
        if (!cancelled && !cancelToken.cancelled) {
          onComplete(totalItems);
        }
        stopRenderWatchdog();
        rafId = null;
      }
    }

    // Spusť první chunk přes requestAnimationFrame
    startRenderWatchdog();
    rafId = requestAnimationFrame(() => {
      processChunk();
    });

    // Vrať cancel funkci
    return {
      cancel: () => {
        cancelled = true;
        cancelToken.cancelled = true;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        stopRenderWatchdog();
      }
    };
  }

  // =========================
  // === FETCH SEMAPHORE (OMEZENÍ PARALELNÍCH FETCHŮ)
  // =========================

  let activeFetches = 0;
  const fetchQueue = [];

  async function fetchWithSemaphore(fetchFn) {
    return new Promise((resolve, reject) => {
      function tryFetch() {
        if (activeFetches < FETCH_SEMAPHORE_MAX) {
          activeFetches++;
          fetchFn()
            .then(result => {
              activeFetches--;
              resolve(result);
              // Zkus další z fronty
              if (fetchQueue.length > 0) {
                const next = fetchQueue.shift();
                tryFetch.call(next);
              }
            })
            .catch(err => {
              activeFetches--;
              reject(err);
              // Zkus další z fronty
              if (fetchQueue.length > 0) {
                const next = fetchQueue.shift();
                tryFetch.call(next);
              }
            });
        } else {
          // Fronta
          fetchQueue.push(tryFetch);
        }
      }
      tryFetch();
    });
  }

  // =========================
  // === DOM NODE LIMIT + VIRTUALIZACE
  // =========================

  function enforceDOMLimit(container, maxItems = MAX_DOM_ITEMS) {
    if (!container) return;
    
    const children = Array.from(container.children);
    if (children.length <= maxItems) return;

    // Odstraň nejstarší položky (zachovej posledních maxItems)
    const toRemove = children.slice(0, children.length - maxItems);
    toRemove.forEach(node => {
      try {
        node.remove();
      } catch (e) {
        console.warn("[infoUzel] Chyba při odstraňování DOM node", e);
      }
    });

    console.log(`[infoUzel] DOM limit: odstraněno ${toRemove.length} položek, zůstalo ${maxItems}`);
  }

  // =========================
  // === EXPORT
  // =========================

  window.__iuRenderOptimizer = {
    renderChunked,
    startRenderWatchdog,
    stopRenderWatchdog,
    fetchWithSemaphore,
    enforceDOMLimit,
    RENDER_CHUNK_SIZE,
    RENDER_TIMEOUT_MS,
    MAX_DOM_ITEMS,
    FETCH_SEMAPHORE_MAX
  };

  // ✅ FIX: Export cancel token factory pro použití v app.js
  window.__iuRenderOptimizer.createCancelToken = () => ({ cancelled: false });

  console.log("[infoUzel] Render optimizer načten");
})();
