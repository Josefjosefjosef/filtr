/* IU_INVOICE_PDF_LEGACY_EXPORT */
  /** Stejný html2pdf stack jako Word → PDF (po převodu na HTML) — pro fakturační modul bez otevírání quick feedu. */
  function iuInvoicePdfExportDiag(step, detail, err) {
    try {
      var nav = typeof navigator !== "undefined" ? navigator : null;
      var entry = {
        t: Date.now(),
        step: String(step || ""),
        detail: detail && typeof detail === "object" ? detail : {},
        errorName: err && err.name ? String(err.name) : "",
        errorMessage: err && err.message ? String(err.message) : err ? String(err) : "",
        userAgent: nav ? String(nav.userAgent || "").slice(0, 160) : "",
      };
      if (!window._iuInvoicePdfExportDiagLog) window._iuInvoicePdfExportDiagLog = [];
      window._iuInvoicePdfExportDiagLog.push(entry);
      if (window._iuInvoicePdfExportDiagLog.length > 40) window._iuInvoicePdfExportDiagLog.shift();
      window._iuInvoicePdfExportDiag = entry;
    } catch (eDiag) {}
  }
  function iuInvoicePdfIsNarrowViewport() {
    try {
      return !!(window.matchMedia && window.matchMedia("(max-width: 1024px)").matches);
    } catch (eNv) {
      return false;
    }
  }
  function iuInvoicePdfIsIOSDevice() {
    try {
      var ua = String((navigator && navigator.userAgent) || "");
      return /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    } catch (eIos) {
      return false;
    }
  }
  function iuInvoicePdfNormalizeBlob(blob, cb) {
    if (!blob || typeof blob.size !== "number" || blob.size < 1500) {
      if (typeof cb === "function") cb(null);
      return;
    }
    if (blob.type === "application/pdf") {
      if (typeof cb === "function") cb(blob);
      return;
    }
    try {
      var slice = blob.slice ? blob.slice(0, 8) : blob;
      var reader = slice.arrayBuffer ? slice.arrayBuffer() : Promise.reject(new Error("no_array_buffer"));
      Promise.resolve(reader)
        .then(function (ab) {
          var u = new Uint8Array(ab);
          var magic = u.length >= 4 && u[0] === 37 && u[1] === 80 && u[2] === 68 && u[3] === 70;
          if (!magic) {
            if (typeof cb === "function") cb(null);
            return;
          }
          if (blob.type === "application/pdf") {
            if (typeof cb === "function") cb(blob);
          } else {
            try {
              if (typeof cb === "function") cb(new Blob([blob], { type: "application/pdf" }));
            } catch (eWrap) {
              if (typeof cb === "function") cb(blob);
            }
          }
        })
        .catch(function () {
          if (blob.type === "" || blob.type === "application/octet-stream") {
            if (typeof cb === "function") cb(blob);
          } else if (typeof cb === "function") cb(null);
        });
    } catch (eNorm) {
      if (typeof cb === "function") cb(null);
    }
  }
  try {
    window.iuInvoicePdfExportDiag = iuInvoicePdfExportDiag;
  } catch (_) {}

  function iuInvoicePdfMeasureBlockRects(rootEl) {
    var blocks = {};
    if (!rootEl || !rootEl.querySelector) return blocks;
    var baseEl = rootEl.classList && rootEl.classList.contains("iu-inv-pr") ? rootEl : rootEl.querySelector(".iu-inv-pr");
    if (!baseEl) return blocks;
    var baseRect = baseEl.getBoundingClientRect();
    function put(key, sel) {
      var el = baseEl.querySelector(sel);
      if (!el) return;
      var r = el.getBoundingClientRect();
      blocks[key] = {
        x: Math.round(r.left - baseRect.left),
        y: Math.round(r.top - baseRect.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }
    put("header", ".iu-inv-pr-head");
    put("supplier", ".iu-inv-pr-grid > div:first-child");
    put("customer", ".iu-inv-pr-grid > div:last-child");
    put("bank", ".iu-inv-pr-bank");
    put("table", ".iu-inv-pr-table");
    put("summary", ".iu-inv-pr-totals");
    put("footer", ".iu-inv-pr-foot");
    return blocks;
  }

  function iuInvoicePdfCollectCompositionMetrics(exportRoot, paperEl, pageEl, canvasScale, pdfPageW, pdfPageH, contentBox) {
    var paperW = paperEl ? Math.round(paperEl.getBoundingClientRect().width) : 0;
    var paperH = paperEl ? Math.round(Math.max(paperEl.scrollHeight || 0, paperEl.offsetHeight || 0)) : 0;
    var exportH = exportRoot ? Math.round(Math.max(exportRoot.scrollHeight || 0, exportRoot.offsetHeight || 0)) : 0;
    var scale = canvasScale || 2;
    var contentW = contentBox && contentBox.width ? contentBox.width : paperW;
    var contentH = contentBox && contentBox.height ? contentBox.height : paperH;
    var effectiveScale = paperW > 0 && contentW > 0 ? Math.round((contentW / paperW) * 1000) / 1000 : 1;
    return {
      previewDocumentWidth: paperW,
      previewDocumentHeight: paperH,
      exportDocumentWidth: paperW,
      exportDocumentHeight: exportH,
      canvasWidth: Math.round(paperW * scale),
      canvasHeight: Math.round(paperH * scale),
      pdfPageWidth: pdfPageW || 0,
      pdfPageHeight: pdfPageH || 0,
      contentBoxWidth: contentW,
      contentBoxHeight: contentH,
      leftMargin: contentBox && typeof contentBox.left === "number" ? contentBox.left : 0,
      rightMargin: contentBox && typeof contentBox.right === "number" ? contentBox.right : 0,
      topMargin: contentBox && typeof contentBox.top === "number" ? contentBox.top : 0,
      bottomMargin: contentBox && typeof contentBox.bottom === "number" ? contentBox.bottom : 0,
      effectiveScale: effectiveScale,
      html2canvasScale: scale,
      exportBlocks: iuInvoicePdfMeasureBlockRects(pageEl),
      fitToPageActive: effectiveScale < 0.98,
      shrinkToFitActive: effectiveScale < 0.98,
    };
  }

  function iuInvoicePdfMirrorPreviewTableWidths(pageEl) {
    if (!pageEl) return;
    try {
      var panel = document.getElementById("iuInvoicePanel");
      var previewRoot =
        (panel && panel.querySelector("[data-inv-preview-layer]:not([hidden]) .iu-inv-pr")) ||
        (panel && panel.querySelector(".iu-inv-previewScroll .iu-inv-pr"));
      var exportTable = pageEl.querySelector(".iu-inv-pr-table");
      var previewTable = previewRoot && previewRoot.querySelector(".iu-inv-pr-table");
      if (!previewTable || !exportTable) return;
      var pHead = previewTable.querySelector("thead tr");
      var eHead = exportTable.querySelector("thead tr");
      if (!pHead || !eHead) return;
      exportTable.style.setProperty("table-layout", "fixed", "important");
      exportTable.style.setProperty("width", "100%", "important");
      for (var i = 0; i < pHead.cells.length && i < eHead.cells.length; i++) {
        var w = pHead.cells[i].offsetWidth;
        if (w > 0) {
          eHead.cells[i].style.setProperty("width", w + "px", "important");
          eHead.cells[i].style.setProperty("min-width", w + "px", "important");
          eHead.cells[i].style.setProperty("max-width", w + "px", "important");
        }
      }
    } catch (eTbl) {}
  }

  function iuInvoicePdfCollectDomSnapshot(rootEl) {
    var snap = { blocks: {}, tableColumnWidths: [], fontMetrics: {} };
    if (!rootEl) return snap;
    snap.blocks = iuInvoicePdfMeasureBlockRects(rootEl);
    try {
      var table = rootEl.querySelector(".iu-inv-pr-table thead tr");
      if (table) {
        for (var ti = 0; ti < table.cells.length; ti++) {
          snap.tableColumnWidths.push(table.cells[ti].offsetWidth || 0);
        }
      }
      var title = rootEl.querySelector(".iu-inv-pr-title");
      if (title) {
        var cs = window.getComputedStyle(title);
        snap.fontMetrics.title = {
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
        };
      }
      snap.computedWidth = rootEl.offsetWidth || Math.round(rootEl.getBoundingClientRect().width);
      snap.scrollWidth = rootEl.scrollWidth || 0;
      snap.scrollHeight = rootEl.scrollHeight || 0;
      var totalsEl = rootEl.querySelector(".iu-inv-pr-totals");
      if (totalsEl) {
        snap.summaryBox = {
          x: totalsEl.offsetLeft,
          y: totalsEl.offsetTop,
          width: totalsEl.offsetWidth,
          height: totalsEl.offsetHeight,
        };
      }
    } catch (eSnap) {}
    return snap;
  }

  function iuInvoicePdfApplyLayoutLock(exportRoot, paperEl, pageEl) {
    var W = 794;
    try {
      if (exportRoot) {
        exportRoot.style.setProperty("width", W + "px", "important");
        exportRoot.style.setProperty("min-width", W + "px", "important");
        exportRoot.style.setProperty("max-width", W + "px", "important");
        exportRoot.style.setProperty("min-height", "0", "important");
        exportRoot.style.setProperty("height", "auto", "important");
        exportRoot.style.setProperty("transform", "none", "important");
      }
      if (paperEl) {
        paperEl.style.setProperty("width", W + "px", "important");
        paperEl.style.setProperty("min-width", W + "px", "important");
        paperEl.style.setProperty("max-width", W + "px", "important");
        paperEl.style.setProperty("min-height", "0", "important");
        paperEl.style.setProperty("height", "auto", "important");
        paperEl.style.setProperty("margin", "0", "important");
        paperEl.style.setProperty("transform", "none", "important");
      }
      if (pageEl) {
        pageEl.style.setProperty("width", W + "px", "important");
        pageEl.style.setProperty("min-width", W + "px", "important");
        pageEl.style.setProperty("max-width", W + "px", "important");
        pageEl.style.setProperty("margin", "0", "important");
        pageEl.style.setProperty("transform", "none", "important");
      }
      var scope = pageEl || paperEl || exportRoot;
      if (!scope) return;
      var grid = scope.querySelector(".iu-inv-pr-grid");
      if (grid) {
        grid.style.setProperty("display", "grid", "important");
        grid.style.setProperty("grid-template-columns", "1fr 1fr", "important");
        grid.style.setProperty("gap", "14px", "important");
      }
      var tables = scope.querySelectorAll(".iu-inv-pr-table, .iu-inv-pr-meta");
      for (var ti = 0; ti < tables.length; ti++) {
        tables[ti].style.setProperty("width", "100%", "important");
        tables[ti].style.setProperty("max-width", "100%", "important");
        tables[ti].style.setProperty("table-layout", "auto", "important");
      }
    } catch (eLayout) {}
  }

  function iuInvoicePdfCollectLayoutMetrics(exportRoot, paperEl, pageEl, canvasScale) {
    var out = {
      previewWidth: null,
      exportHostWidth: 0,
      paperWidth: 0,
      pageWidth: 0,
      canvasWidth: 0,
      canvasHeight: 0,
      pdfPageWidth: 0,
      pdfPageHeight: 0,
      html2canvasScale: canvasScale || 2,
      devicePixelRatio: typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1,
      viewportWidth: typeof window.innerWidth === "number" ? window.innerWidth : 0,
      viewportHeight: typeof window.innerHeight === "number" ? window.innerHeight : 0,
      gridColumns: "",
      supplierColWidth: 0,
      buyerColWidth: 0,
      tableWidth: 0,
      summaryWidth: 0,
    };
    try {
      var portalEl = document.getElementById("iuInvoicePreviewPortal");
      var previewPaper =
        portalEl && !portalEl.hidden
          ? portalEl.querySelector(".iu-invoice-paper")
          : null;
      if (!previewPaper) {
        var panel = document.getElementById("iuInvoicePanel");
        previewPaper = panel && panel.querySelector(".iu-invoice-paper");
      }
      if (previewPaper) {
        out.previewWidth = Math.round(previewPaper.getBoundingClientRect().width);
        var prCs = window.getComputedStyle(previewPaper);
        out.PDF_LEFT_MARGIN = Math.round(parseFloat(prCs.paddingLeft) || 0);
        out.PDF_RIGHT_MARGIN = Math.round(parseFloat(prCs.paddingRight) || 0);
        out.PDF_TOP_MARGIN = Math.round(parseFloat(prCs.paddingTop) || 0);
        out.PDF_BOTTOM_MARGIN = Math.round(parseFloat(prCs.paddingBottom) || 0);
        var descCell = previewPaper.querySelector(".iu-inv-pr-desc");
        if (descCell) {
          var descCs = window.getComputedStyle(descCell);
          out.PDF_ITEM_DESCRIPTION_FONT_SIZE = descCs.fontSize || "";
        }
        var lineCell = previewPaper.querySelector(".iu-inv-pr-table tbody td");
        if (lineCell) {
          out.PDF_ITEM_FONT_SIZE = window.getComputedStyle(lineCell).fontSize || "";
        }
        var lineTable = previewPaper.querySelector(".iu-inv-pr-table");
        if (lineTable) {
          var ths = lineTable.querySelectorAll("th");
          var colW = [];
          for (var cwi = 0; cwi < ths.length; cwi++) {
            colW.push(Math.round(ths[cwi].getBoundingClientRect().width));
          }
          out.PDF_TABLE_COLUMN_WIDTHS = colW.join(",");
          var firstRow = lineTable.querySelector("tbody tr");
          if (firstRow) out.PDF_TABLE_ROW_HEIGHT = Math.round(firstRow.getBoundingClientRect().height);
        }
      }
    } catch (ePrev) {}
    try {
      if (exportRoot) out.exportHostWidth = Math.round(exportRoot.getBoundingClientRect().width);
      if (paperEl) out.paperWidth = Math.round(paperEl.getBoundingClientRect().width);
      if (pageEl) {
        out.pageWidth = Math.round(pageEl.getBoundingClientRect().width);
        var grid = pageEl.querySelector(".iu-inv-pr-grid");
        if (grid) {
          out.gridColumns = String(window.getComputedStyle(grid).gridTemplateColumns || "");
          var cols = grid.children;
          if (cols && cols.length > 0) out.supplierColWidth = Math.round(cols[0].getBoundingClientRect().width);
          if (cols && cols.length > 1) out.buyerColWidth = Math.round(cols[1].getBoundingClientRect().width);
        }
        var table = pageEl.querySelector(".iu-inv-pr-table");
        if (table) out.tableWidth = Math.round(table.getBoundingClientRect().width);
        var totals = pageEl.querySelector(".iu-inv-pr-totals");
        if (totals) out.summaryWidth = Math.round(totals.getBoundingClientRect().width);
      }
      out.canvasWidth = Math.round(out.pageWidth * out.html2canvasScale);
      out.canvasHeight = Math.round((pageEl ? pageEl.scrollHeight : 0) * out.html2canvasScale);
    } catch (eMet) {}
    return out;
  }

  function iuInvoicePdfApplyCanvasSafeStyles(pageEl) {
    if (!pageEl || !pageEl.querySelector) return;
    try {
      var head = pageEl.querySelector(".iu-inv-pr-head");
      if (head) {
        head.style.setProperty("position", "relative", "important");
        head.style.setProperty("overflow", "hidden", "important");
        head.style.setProperty("background-image", "none", "important");
        head.style.setProperty("background-color", "#ffffff", "important");
      }
      var tables = pageEl.querySelectorAll(".iu-inv-pr-table, .iu-inv-pr-meta");
      for (var ti = 0; ti < tables.length; ti++) {
        tables[ti].style.setProperty("border-collapse", "collapse", "important");
        tables[ti].style.setProperty("border-spacing", "0", "important");
      }
      var cells = pageEl.querySelectorAll(
        ".iu-inv-pr-table th, .iu-inv-pr-table td, .iu-inv-pr-meta th, .iu-inv-pr-meta td",
      );
      for (var ci = 0; ci < cells.length; ci++) {
        cells[ci].style.setProperty("border", "1px solid #dbe1e8", "important");
      }
      var lineTh = pageEl.querySelectorAll(".iu-inv-pr-table th");
      for (var hi = 0; hi < lineTh.length; hi++) {
        lineTh[hi].style.setProperty("background-image", "none", "important");
        lineTh[hi].style.setProperty("background-color", "rgba(136, 19, 55, 0.07)", "important");
      }
      var metaTh = pageEl.querySelectorAll(".iu-inv-pr-meta th");
      for (var mi = 0; mi < metaTh.length; mi++) {
        metaTh[mi].style.setProperty("background-image", "none", "important");
        metaTh[mi].style.setProperty("background-color", "rgba(15, 23, 42, 0.03)", "important");
      }
      var bank = pageEl.querySelector(".iu-inv-pr-bank");
      if (bank) {
        bank.style.setProperty("background-image", "none", "important");
        bank.style.setProperty("background-color", "rgba(15, 23, 42, 0.03)", "important");
      }
      var due = pageEl.querySelector(".iu-inv-pr-due");
      if (due) {
        due.style.setProperty("color", "#881337", "important");
        due.style.setProperty("font-weight", "800", "important");
        due.style.setProperty("font-size", "18px", "important");
      }
      var totals = pageEl.querySelector(".iu-inv-pr-totals");
      if (totals) {
        totals.style.setProperty("text-align", "right", "important");
      }
      pageEl.style.setProperty("border", "1px solid #e2e8f0", "important");
      var grid = pageEl.querySelector(".iu-inv-pr-grid");
      if (grid) {
        grid.style.setProperty("grid-template-columns", "1fr 1fr", "important");
      }
    } catch (eStyle) {}
  }

  function iuInvoicePdfHardenCloneForCanvas(clonedDoc) {
    try {
      if (!clonedDoc || !clonedDoc.querySelectorAll) return;
      try {
        clonedDoc.documentElement.style.setProperty("width", "794px", "important");
        clonedDoc.body.style.setProperty("width", "794px", "important");
        clonedDoc.body.style.setProperty("margin", "0", "important");
      } catch (eDoc) {}
      var roots = clonedDoc.querySelectorAll(".iu-pdf-render-mode--export, [data-iu=\"pdf-invoice-export-root\"]");
      for (var ri = 0; ri < roots.length; ri++) {
        var root = roots[ri];
        var paper = root.querySelector(".iu-invoice-paper");
        var page = root.querySelector(".iu-inv-pr");
        iuInvoicePdfApplyLayoutLock(root, paper, page);
        if (page) iuInvoicePdfApplyCanvasSafeStyles(page);
      }
    } catch (eCloneStyle) {}
  }

  function iuPdfExportHtmlStringToBlobForInvoice(htmlString, fileName, done) {
    iuInvoicePdfExportDiag("invoice_pdf_export_start", { narrow: iuInvoicePdfIsNarrowViewport(), ios: iuInvoicePdfIsIOSDevice() });
    var vendorBase = "/assets/vendor";
    function loadScript(src, cb) {
      var s = document.createElement("script");
      s.src = (/^\//.test(src) ? "" : "/") + src;
      s.onload = function () {
        if (typeof cb === "function") cb();
      };
      s.onerror = function () {
        if (typeof cb === "function") cb(new Error("load failed"));
      };
      document.head.appendChild(s);
    }
    function loadHtml2Pdf(cb) {
      if (typeof window.html2pdf !== "undefined") {
        cb();
        return;
      }
      loadScript(vendorBase + "/html2pdf.bundle.min.js", function () {
        if (typeof window.html2pdf === "undefined") {
          if (typeof cb === "function") cb(new Error("html2pdf"));
        } else if (typeof cb === "function") cb();
      });
    }
    var html = String(htmlString || "");
    if (!html.trim()) {
      iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "empty_html" }, new Error("empty html"));
      if (typeof done === "function") done(new Error("empty html"));
      return;
    }
    if (!/<table[\s>]/i.test(html) || !/<[a-z]/i.test(html)) {
      iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "plain_text_only" }, new Error("invoice_pdf_plain_text_only"));
      if (typeof done === "function") done(new Error("invoice_pdf_plain_text_only"));
      return;
    }
    iuInvoicePdfExportDiag("invoice_pdf_html_ready", { htmlLen: html.length });
    loadHtml2Pdf(function (e0) {
      if (e0 || typeof window.html2pdf === "undefined") {
        iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "html2pdf_load" }, e0 || new Error("html2pdf"));
        if (typeof done === "function") done(e0 || new Error("html2pdf"));
        return;
      }
      var exportRoot = document.createElement("div");
      exportRoot.setAttribute("data-iu", "pdf-invoice-export-root");
      exportRoot.className = "iu-pdf-render-mode iu-pdf-render-mode--export";
      exportRoot.innerHTML = '<div class="iu-invoice-paper">' + html + "</div>";
      document.body.appendChild(exportRoot);
      iuInvoicePdfExportDiag("invoice_pdf_host_attached", {
        narrow: iuInvoicePdfIsNarrowViewport(),
        innerWidth: typeof window.innerWidth === "number" ? window.innerWidth : 0,
      });
      try {
        window._iuInvoicePdfExportMeta = {
          renderSource: "paper_css_mode",
          generatedFromPreview: true,
          generatedFromScaledPreview: false,
          visualTemplateUsed: true,
          plainTextOnly: false,
          paperModeUsed: true,
        };
      } catch (eMeta) {}
      var narrowExport = iuInvoicePdfIsNarrowViewport();
      var canvasScale = 2;
      var opts = {
        filename: fileName || "faktura.pdf",
        margin: 0,
        image: { type: "jpeg", quality: narrowExport ? 0.92 : 0.98 },
        html2canvas: {
          scale: canvasScale,
          scrollX: 0,
          scrollY: 0,
          x: 0,
          y: 0,
          width: 794,
          height: 400,
          windowWidth: 794,
          windowHeight: 400,
          useCORS: false,
          backgroundColor: "#ffffff",
          logging: false,
          foreignObjectRendering: false,
          onclone: function (clonedDoc) {
            try {
              var roots = clonedDoc.querySelectorAll(".iu-pdf-render-mode--export, [data-iu=\"pdf-invoice-export-root\"]");
              for (var ci = 0; ci < roots.length; ci++) {
                var root = roots[ci];
                root.style.setProperty("left", "0", "important");
                root.style.setProperty("top", "0", "important");
                root.style.setProperty("visibility", "visible", "important");
                root.style.setProperty("opacity", "1", "important");
                root.style.setProperty("z-index", "2147483647", "important");
                root.style.setProperty("position", "fixed", "important");
                root.style.setProperty("pointer-events", "none", "important");
              }
              iuInvoicePdfHardenCloneForCanvas(clonedDoc);
            } catch (eClone) {}
          },
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait", compress: true },
        pagebreak: { mode: ["css", "legacy"] },
      };
      function runHtml2Pdf(retryPass) {
        iuInvoicePdfExportDiag("invoice_pdf_html2pdf_start", { scale: canvasScale, retry: !!retryPass });
        var paperHostExists = !!exportRoot && exportRoot.classList.contains("iu-pdf-render-mode");
        var paperEl = exportRoot.querySelector(".iu-invoice-paper");
        var pageEl = exportRoot.querySelector(".iu-inv-pr");
        var paperRootExists = !!pageEl && !!paperEl;
        if (!paperHostExists || !paperRootExists) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "paper_root_missing" }, new Error("invoice_paper_root_missing"));
          if (typeof done === "function") done(new Error("invoice_paper_root_missing"));
          return;
        }
        iuInvoicePdfApplyLayoutLock(exportRoot, paperEl, pageEl);
        iuInvoicePdfApplyCanvasSafeStyles(pageEl);
        iuInvoicePdfMirrorPreviewTableWidths(pageEl);
        var hostRect = exportRoot.getBoundingClientRect();
        var rect = pageEl.getBoundingClientRect();
        var paperRect = paperEl.getBoundingClientRect();
        var paperW = paperEl.offsetWidth || paperRect.width || 0;
        var paperH = paperEl.offsetHeight || paperEl.scrollHeight || 0;
        var pageW = pageEl.offsetWidth || rect.width || 0;
        var pageH = pageEl.offsetHeight || rect.height || 0;
        var textBody = pageEl.textContent || "";
        if (!narrowExport) {
          if (rect.left < hostRect.left - 0.5) {
            if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
            iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "negative_left" }, new Error("invoice_print_page_negative_left"));
            if (typeof done === "function") done(new Error("invoice_print_page_negative_left"));
            return;
          }
          if (rect.right > hostRect.right + 0.5) {
            if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
            iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "overflow_host" }, new Error("invoice_print_page_overflow_host"));
            if (typeof done === "function") done(new Error("invoice_print_page_overflow_host"));
            return;
          }
        }
        if (paperW < 760 || pageW < 760 || paperH < 200) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          iuInvoicePdfExportDiag(
            "invoice_pdf_error",
            { phase: "layout_invalid", paperW: paperW, pageW: pageW, paperH: paperH, rectW: rect.width },
            new Error("invoice_paper_layout_invalid"),
          );
          if (typeof done === "function") done(new Error("invoice_paper_layout_invalid"));
          return;
        }
        if (textBody.length < 100) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          if (typeof done === "function") done(new Error("invoice_print_text_too_short"));
          return;
        }
        if (textBody.indexOf("FAKTURA") === -1) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          if (typeof done === "function") done(new Error("invoice_print_missing_faktura"));
          return;
        }
        if (textBody.indexOf("Dodavatel") === -1) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          if (typeof done === "function") done(new Error("invoice_print_missing_supplier"));
          return;
        }
        if (textBody.indexOf("Odběratel") === -1) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          if (typeof done === "function") done(new Error("invoice_print_missing_buyer"));
          return;
        }
        if (textBody.indexOf("Celkem") === -1) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          if (typeof done === "function") done(new Error("invoice_print_missing_total"));
          return;
        }
        if (textBody.indexOf("infoUzel") === -1) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          if (typeof done === "function") done(new Error("invoice_print_missing_brand"));
          return;
        }
        var footEl = pageEl.querySelector(".iu-inv-pr-foot");
        if (!footEl) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          if (typeof done === "function") done(new Error("invoice_paper_footer_missing"));
          return;
        }
        var footRaw = String(footEl.textContent || "").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
        var footTrim = footRaw.replace(/\s+/g, " ").trim();
        if (footTrim.indexOf("www.infoUzel.cz") === -1) {
          if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
          if (typeof done === "function") done(new Error("invoice_paper_footer_invalid"));
          return;
        }
        try {
          var csOv = window.getComputedStyle(pageEl);
          if (String(csOv.overflow || "") === "hidden" || String(csOv.overflowX || "") === "hidden") {
            if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
            if (typeof done === "function") done(new Error("invoice_print_page_overflow_hidden"));
            return;
          }
        } catch (eOv) {}
        var pad = 0;
        try {
          var cs = window.getComputedStyle(pageEl);
          var pt = parseFloat(cs.paddingTop) || 0;
          var pr = parseFloat(cs.paddingRight) || 0;
          var pb = parseFloat(cs.paddingBottom) || 0;
          var pl = parseFloat(cs.paddingLeft) || 0;
          pad = pt + pr + pb + pl;
        } catch (ePad) {}
        var boldOk = false;
        var brandBordo = false;
        var supLblBold = false;
        var buyLblBold = false;
        var totalDueBold = false;
        try {
          var titleEl = pageEl.querySelector(".iu-inv-pr-title");
          if (titleEl) {
            var fwb = String(window.getComputedStyle(titleEl).fontWeight || "");
            var fnb = parseFloat(fwb);
            boldOk = fwb === "bold" || fwb === "bolder" || (!isNaN(fnb) && fnb >= 600);
          }
          var brandEl = pageEl.querySelector(".iu-inv-pr-created");
          if (brandEl) {
            var brandInk = String(window.getComputedStyle(brandEl).color || "");
            brandBordo = brandInk.indexOf("136, 19, 55") !== -1 || brandInk.indexOf("881337") !== -1;
          }
          var headEl = pageEl.querySelector(".iu-inv-pr-head");
          if (headEl) {
            var bl = String(headEl.style.borderLeft || "");
            if (!bl) {
              try {
                bl = String(window.getComputedStyle(headEl).borderLeftColor || "");
              } catch (eBl) {}
            }
            brandBordo = brandBordo || bl.indexOf("136, 19, 55") !== -1 || bl.indexOf("881337") !== -1;
          }
          var hLabels = pageEl.querySelectorAll(".iu-inv-pr-h");
          for (var hi = 0; hi < hLabels.length; hi++) {
            var ht = String(hLabels[hi].textContent || "");
            var hw = String(window.getComputedStyle(hLabels[hi]).fontWeight || "");
            var hn = parseFloat(hw);
            var hb = hw === "bold" || hw === "bolder" || (!isNaN(hn) && hn >= 700);
            if (ht.indexOf("Dodavatel") !== -1) supLblBold = hb;
            if (ht.indexOf("Odběratel") !== -1) buyLblBold = hb;
          }
          var dueEl = pageEl.querySelector(".iu-inv-pr-due");
          if (dueEl) {
            var dw = String(window.getComputedStyle(dueEl).fontWeight || "");
            var dn = parseFloat(dw);
            totalDueBold = dw === "bold" || dw === "bolder" || (!isNaN(dn) && dn >= 700);
          }
        } catch (eTw) {}
        var captureH = 900;
        try {
          captureH = Math.ceil(
            Math.max(pageEl.scrollHeight || 0, pageEl.offsetHeight || 0, paperEl.scrollHeight || 0, paperEl.offsetHeight || 0) + 2,
          );
          var capH = narrowExport ? 7200 : 14000;
          captureH = Math.min(Math.max(captureH, 200), capH);
          opts.html2canvas.windowHeight = captureH;
          opts.html2canvas.height = captureH;
          opts.html2canvas.width = 794;
          opts.html2canvas.windowWidth = 794;
          opts.html2canvas.scale = retryPass ? 1 : canvasScale;
          var contentHmm = Math.ceil((captureH / 794) * 210);
          if (contentHmm >= 80 && contentHmm <= 297) {
            opts.jsPDF.format = [210, contentHmm];
          } else {
            opts.jsPDF.format = "a4";
          }
          try {
            exportRoot.style.setProperty("min-height", "0", "important");
            exportRoot.style.setProperty("height", captureH + "px", "important");
            paperEl.style.setProperty("min-height", "0", "important");
            paperEl.style.setProperty("height", "auto", "important");
          } catch (eHostH) {}
        } catch (eSh) {}
        var previewBlocks = iuInvoicePdfMeasureBlockRects(pageEl);
        try {
          window._iuInvoicePdfPreviewBlocks = previewBlocks;
          var portal = document.getElementById("iuInvoicePreviewPortal");
          var previewPage =
            portal && !portal.hidden
              ? portal.querySelector(".iu-inv-pr")
              : null;
          if (!previewPage) {
            var panel = document.getElementById("iuInvoicePanel");
            previewPage =
              panel && panel.querySelector("[data-inv-preview-layer]:not([hidden]) .iu-inv-pr");
          }
          window._iuInvoicePdfDomParity = {
            preview: iuInvoicePdfCollectDomSnapshot(previewPage),
            capture: iuInvoicePdfCollectDomSnapshot(pageEl),
            previewHostHtmlLen: previewPage ? previewPage.outerHTML.length : 0,
            captureHostHtmlLen: pageEl ? pageEl.outerHTML.length : 0,
            previewHostHtml: previewPage ? String(previewPage.outerHTML).slice(0, 4000) : "",
            captureHostHtml: pageEl ? String(pageEl.outerHTML).slice(0, 4000) : "",
          };
        } catch (_) {}
        var layoutMetrics = iuInvoicePdfCollectLayoutMetrics(exportRoot, paperEl, pageEl, opts.html2canvas.scale);
        try {
          layoutMetrics.PDF_PAGE_WIDTH = layoutMetrics.pageWidth || 794;
          layoutMetrics.PDF_PAGE_HEIGHT = captureH;
          layoutMetrics.PDF_CONTENT_SCALE = opts.html2canvas.scale;
          window._iuInvoicePdfLayoutProof = layoutMetrics;
          window._iuInvoicePdfLayoutDiag = layoutMetrics;
          window._iuInvoicePdfCompositionProof = iuInvoicePdfCollectCompositionMetrics(
            exportRoot,
            paperEl,
            pageEl,
            opts.html2canvas.scale,
            0,
            0,
            { width: 794, height: captureH, left: 0, top: 0, right: 0, bottom: 0 },
          );
          window._iuInvoicePdfCompositionProof.captureHeight = captureH;
          window._iuInvoicePdfCompositionProof.jsPdfFormat = opts.jsPDF.format;
        } catch (eLay) {}
        var exportHostHidden = false;
        var exportHostCaptureReady = false;
        var brandColorBordo = false;
        var tableHeaderBordo = false;
        try {
          var hs = window.getComputedStyle(exportRoot);
          var hostLeft = parseFloat(hs.left || "0");
          exportHostCaptureReady =
            hs.visibility !== "hidden" && parseFloat(hs.opacity || "1") >= 0.95 && hostLeft <= -5000;
          exportHostHidden = exportHostCaptureReady || hostLeft <= -5000;
          var createdEl = pageEl.querySelector(".iu-inv-pr-created");
          if (createdEl) {
            var cc = String(window.getComputedStyle(createdEl).color || "");
            brandColorBordo = cc.indexOf("136, 19, 55") !== -1 || cc.indexOf("881337") !== -1;
          }
          var thEl = pageEl.querySelector(".iu-inv-pr-table th");
          if (thEl) {
            var bg = String(window.getComputedStyle(thEl).backgroundColor || "");
            tableHeaderBordo = bg.indexOf("136, 19, 55") !== -1 || bg.indexOf("881337") !== -1;
          }
        } catch (eVis) {}
        try {
          window._iuInvoicePrintProof = {
            paperHostExists: true,
            paperRootExists: true,
            exportHostHidden: exportHostHidden,
            exportHostCaptureReady: exportHostCaptureReady,
            brandColorBordo: brandColorBordo,
            tableHeaderBordo: tableHeaderBordo,
            renderSource: "paper_css_mode",
            generatedFromPreview: true,
            generatedFromScaledPreview: false,
            pageRectLeft: rect.left,
            pageRectWidth: rect.width,
            pageRectHeight: rect.height,
            pageTextLength: textBody.length,
            containsFAKTURA: textBody.indexOf("FAKTURA") !== -1,
            containsDodavatel: textBody.indexOf("Dodavatel") !== -1,
            containsOdběratel: textBody.indexOf("Odběratel") !== -1,
            containsCelkem: textBody.indexOf("Celkem") !== -1,
            containsInfoUzel: textBody.indexOf("infoUzel") !== -1,
            visualTemplateUsed: true,
            plainTextOnly: false,
            hasMargins: pad >= 60,
            hasBoldSections: boldOk,
            hasProfessionalLayout: !!pageEl.querySelector(".iu-inv-pr-table"),
            contentClipped: false,
            brandBordoAccent: brandBordo,
            supplierHeadingBold: supLblBold,
            buyerHeadingBold: buyLblBold,
            footerHasWwwInfoUzel: footTrim.indexOf("www.infoUzel.cz") !== -1,
            totalDueBold: totalDueBold,
          };
        } catch (ePr) {}
        try {
          window._iuInvoicePdfPositionProof = {
            hostRectLeft: hostRect.left,
            paperRectLeft: rect.left,
            paperRectRight: rect.right,
            paperRectWidth: rect.width,
            paperInsideHost: !!(rect.left >= hostRect.left - 1 && rect.right <= hostRect.right + 1),
            paperLeftNegative: rect.left < -0.5,
            contentClipped: false,
          };
        } catch (ePos) {}
        window
          .html2pdf()
          .set(opts)
          .from(paperEl)
          .toPdf()
          .outputPdf("blob")
          .then(function (blob) {
            if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
            iuInvoicePdfNormalizeBlob(blob, function (norm) {
              if (!norm) {
                iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "blob_invalid" }, new Error("invoice_pdf_blob_invalid_type"));
                if (typeof done === "function") done(new Error("invoice_pdf_blob_invalid_type"));
                return;
              }
              iuInvoicePdfExportDiag("invoice_pdf_blob_created", { size: norm.size, type: norm.type || "" });
              try {
                window._iuInvoicePdfExportMeta.paperModeUsed = true;
                window._iuInvoicePdfExportMeta.paperCaptureWidth = layoutMetrics.paperWidth;
                window._iuInvoicePdfExportMeta.canvasWidth = layoutMetrics.canvasWidth;
                if (window._iuInvoicePdfCompositionProof) {
                  window._iuInvoicePdfCompositionProof.pdfPageWidth = 210;
                  window._iuInvoicePdfCompositionProof.pdfPageHeight =
                    typeof opts.jsPDF.format === "object" && opts.jsPDF.format[1] ? opts.jsPDF.format[1] : 297;
                  window._iuInvoicePdfCompositionProof.fitToPageActive = false;
                  window._iuInvoicePdfCompositionProof.shrinkToFitActive = false;
                  window._iuInvoicePdfCompositionProof.effectiveScale = 1;
                }
              } catch (_) {}
              try {
                window._iuPdfLastEngine = "invoice-html2pdf-paper";
                window._iuPdfLastSource = "invoice-paper-html";
              } catch (_) {}
              if (typeof done === "function") done(null, { blob: norm, fileName: fileName || "faktura.pdf" });
            });
          })
          .catch(function (e) {
            if (!retryPass && exportRoot.parentNode) {
              iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "html2pdf_retry", retry: true }, e);
              try {
                opts.html2canvas.scale = 1;
              } catch (_) {}
              runHtml2Pdf(true);
              return;
            }
            try {
              window._iuInvoicePdfPositionProof = null;
            } catch (_) {}
            try {
              window._iuInvoicePrintProof = null;
            } catch (_) {}
            if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
            iuInvoicePdfExportDiag("invoice_pdf_error", { phase: "html2pdf_fail" }, e);
            if (typeof done === "function") done(e);
          });
      }
      function scheduleHtml2PdfRun() {
        var delayMs = narrowExport ? 150 : 0;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (delayMs) {
              window.setTimeout(function () {
                runHtml2Pdf(false);
              }, delayMs);
            } else {
              runHtml2Pdf(false);
            }
          });
        });
      }
      scheduleHtml2PdfRun();
    });
  }

  try {
    if (typeof iuPdfExportHtmlStringToBlobForInvoice === "function") {
      window.iuPdfExportHtmlStringToBlobForInvoice = iuPdfExportHtmlStringToBlobForInvoice;
    }
  } catch (_) {}
