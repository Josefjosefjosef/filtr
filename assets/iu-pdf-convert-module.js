/* IU_PDF_CONVERT_MODULE */
  export function iuPdfConvertToolsBootstrap(quick) {
    const root = quick && quick.querySelector("[data-iu=\"pdfconvert-tools\"]");
    if (!root) return;
    const tabWord = root.querySelector("[data-iu=\"tab-word\"]");
    const tabText = root.querySelector("[data-iu=\"tab-text\"]");
    const panelWord = root.querySelector("[data-iu=\"tab-word-panel\"]");
    const panelText = root.querySelector("[data-iu=\"tab-text-panel\"]");
    const docxInput = root.querySelector("[data-iu=\"pdf-docx-input\"]");
    const wordFileBtn = document.getElementById("iuWordFileBtn");
    const wordFileLabel = document.getElementById("iuWordFileLabel");
    const docxBtn = root.querySelector("[data-iu=\"pdf-download-convert\"]");
    const textInput = root.querySelector("[data-iu=\"pdf-text-input\"]");
    const textBtn = root.querySelector("[data-iu=\"pdf-text-generate\"]");
    const wordHtmlWrapper = root.querySelector("[data-iu=\"pdf-word-html\"]");
    if (wordFileBtn && docxInput) wordFileBtn.addEventListener("click", function() { docxInput.click(); });
    if (docxInput) docxInput.addEventListener("change", function() {
      var hasFile = docxInput.files && docxInput.files.length > 0;
      if (wordFileLabel) wordFileLabel.textContent = hasFile ? docxInput.files[0].name : "Žádný soubor nebyl vybrán";
      if (docxBtn) docxBtn.disabled = !hasFile;
      updateShareConvertButton();
    });
    if (tabWord && panelWord) tabWord.addEventListener("click", function() {
      if (tabText && panelText) { tabText.setAttribute("aria-selected", "false"); panelText.hidden = true; }
      tabWord.setAttribute("aria-selected", "true"); panelWord.hidden = false;
      if (typeof window._iuPdfWordTabActivated === "undefined") window._iuPdfWordTabActivated = true;
      loadMammothIfNeeded();
    });
    if (tabText && panelText) tabText.addEventListener("click", function() {
      if (tabWord && panelWord) { tabWord.setAttribute("aria-selected", "false"); panelWord.hidden = true; }
      tabText.setAttribute("aria-selected", "true"); panelText.hidden = false;
    });
    var shareConvertBtn = root.querySelector("[data-iu=\"pdf-share-convert\"]");
    var canShareFiles = !!(typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [new File([], "x.pdf", { type: "application/pdf" })] }));
    var shareUnsupportedEl = document.getElementById("iuPdfShareUnsupported");
    function updateShareConvertButton() {
      if (!shareConvertBtn) return;
      var hasFile = docxInput && docxInput.files && docxInput.files.length > 0;
      shareConvertBtn.disabled = !hasFile || !canShareFiles;
      shareConvertBtn.title = canShareFiles ? "Převést a sdílet PDF" : "Sdílení není podporováno";
      if (shareUnsupportedEl) shareUnsupportedEl.style.display = canShareFiles ? "none" : "inline";
    }
    function loadScript(src, cb) {
      var s = document.createElement("script");
      s.src = (/^\//.test(src) ? "" : "/") + src;
      s.onload = function() { if (typeof cb === "function") cb(); };
      s.onerror = function() { if (typeof cb === "function") cb(new Error("load failed")); };
      document.head.appendChild(s);
    }
    var vendorBase = "/assets/vendor";
    var fontUrl = "/assets/fonts/noto-sans-latin-ext-400-normal.ttf";
    var pdfLibFontBytes = null;
    function loadPdfLibAndFont(cb) {
      if (pdfLibFontBytes) { cb(null, pdfLibFontBytes); return; }
      if (typeof window.PDFLib === "undefined") {
        loadScript(vendorBase + "/pdf-lib.min.js", function(err) {
          if (err || typeof window.PDFLib === "undefined") { cb(err || new Error("pdf-lib")); return; }
          loadScript(vendorBase + "/fontkit.umd.js", function(err2) {
            if (err2 || typeof window.fontkit === "undefined") { cb(err2 || new Error("fontkit")); return; }
            fetch(fontUrl).then(function(r) { return r.arrayBuffer(); }).then(function(ab) { pdfLibFontBytes = ab; cb(null, ab); }).catch(function(e) { cb(e); });
          });
        });
      } else if (typeof window.fontkit === "undefined") {
        loadScript(vendorBase + "/fontkit.umd.js", function(err2) {
          if (err2 || typeof window.fontkit === "undefined") { cb(err2 || new Error("fontkit")); return; }
          fetch(fontUrl).then(function(r) { return r.arrayBuffer(); }).then(function(ab) { pdfLibFontBytes = ab; cb(null, ab); }).catch(function(e) { cb(e); });
        });
      } else {
        fetch(fontUrl).then(function(r) { return r.arrayBuffer(); }).then(function(ab) { pdfLibFontBytes = ab; cb(null, ab); }).catch(function(e) { cb(e); });
      }
    }
    function normalizePdfText(t) {
      return (t || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "    ");
    }
    function iuPdfTextHash(s) {
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }
    function iuPdfGenerateFromPlainText(text, opts, done) {
      opts = opts || {};
      var normalized = normalizePdfText(text);
      var forRender = normalized.length ? normalized : " ";
      window._iuPdfLastTextHash = iuPdfTextHash(normalized);
      if (opts.source === "word") {
        window._iuPdfLastSource = "word";
        window._iuPdfLastTextLen = forRender.length;
      } else {
        window._iuPdfLastSource = "text";
        window._iuPdfLastTextLen = forRender.length;
      }
      loadPdfLibAndFont(function(err, fontBytes) {
        if (err || !fontBytes) { done(err); return; }
        var PDFLib = window.PDFLib;
        var fontkit = window.fontkit;
        if (!PDFLib || !fontkit) { done(new Error("PDFLib")); return; }
        PDFLib.PDFDocument.create().then(function(pdfDoc) {
          pdfDoc.registerFontkit(fontkit);
          return pdfDoc.embedFont(fontBytes).then(function(customFont) {
            var fontSize = 11;
            var marginPt = 40;
            var pageW = 595.28 - marginPt * 2;
            var lineHeight = fontSize * 1.25;
            var y = marginPt;
            var lines = forRender.split(/\n/);
            var page = pdfDoc.addPage([595.28, 841.89]);
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line === undefined || line === "") line = " ";
              var chunks = [];
              var rest = line;
              while (rest.length > 0) {
                var w = customFont.widthOfTextAtSize(rest, fontSize);
                if (w <= pageW) { chunks.push(rest); rest = ""; continue; }
                var low = 0, high = rest.length;
                while (low < high - 1) {
                  var mid = Math.ceil((low + high) / 2);
                  if (customFont.widthOfTextAtSize(rest.substring(0, mid), fontSize) <= pageW) low = mid; else high = mid;
                }
                var lastSpace = rest.lastIndexOf(" ", low);
                var cut = (lastSpace > 0) ? lastSpace : Math.max(1, low);
                chunks.push(rest.substring(0, cut).trim() || rest.substring(0, 1));
                rest = rest.substring(cut).trim();
              }
              for (var k = 0; k < chunks.length; k++) {
                if (y + lineHeight > 841.89 - marginPt) { page = pdfDoc.addPage([595.28, 841.89]); y = marginPt; }
                page.drawText(chunks[k], { x: marginPt, y: 841.89 - y, size: fontSize, font: customFont });
                y += lineHeight;
              }
            }
            return pdfDoc.save();
          });
        }).then(function(bytes) {
          window._iuPdfLastEngine = "pdf-lib+ttf-unicode-v2";
          var blob = new Blob([bytes], { type: "application/pdf" });
          window._iuPdfLastPdfBytes = blob.size;
          done(null, { blob: blob, fileName: opts.fileName || "document.pdf" });
        }).catch(function(e) { done(e); });
      });
    }
    var mammothLoaded = false;
    function loadMammothIfNeeded(cb) {
      if (typeof window.mammoth !== "undefined") { mammothLoaded = true; if (typeof cb === "function") cb(); return; }
      if (mammothLoaded) { if (typeof cb === "function") cb(); return; }
      loadScript(vendorBase + "/mammoth.browser.min.js", function() { mammothLoaded = true; if (typeof cb === "function") cb(); });
    }
    var html2pdfLoaded = false;
    function loadHtml2PdfIfNeeded(cb) {
      if (typeof window.html2pdf !== "undefined") { html2pdfLoaded = true; if (typeof cb === "function") cb(); return; }
      if (html2pdfLoaded) { if (typeof cb === "function") cb(); return; }
      loadScript(vendorBase + "/html2pdf.bundle.min.js", function() { html2pdfLoaded = true; if (typeof cb === "function") cb(); });
    }
    function showWordPdfError(msg) {
      var ra = document.querySelector("#iuQuickFeed [data-iu=\"pdf-word-result-actions\"]");
      if (ra) { ra.textContent = msg || ""; ra.hidden = !msg; }
    }
    function iuGenerateWordPdfBlobFromSelectedDocx(file) {
      window._iuPdfLastWordError = null;
      return new Promise(function(resolve, reject) {
        if (!file) { window._iuPdfLastWordError = "no file"; reject(new Error("no file")); return; }
        loadMammothIfNeeded(async function() {
          if (typeof window.mammoth === "undefined") { window._iuPdfLastWordError = "mammoth"; reject(new Error("mammoth")); return; }
          var ab;
          try { ab = await file.arrayBuffer(); } catch (e) {
            window._iuPdfLastWordError = String(e && (e.message || e));
            window._iuPdfLastSource = "word";
            window._iuPdfLastWordMode = "word-text-fallback";
            iuPdfGenerateFromPlainText("Dokument se nepodařilo přečíst.", { source: "word", fileName: "document.pdf" }, function(err, out) {
              if (err || !out || !out.blob) { reject(err || new Error("pdf")); return; }
              window._iuPdfLastPdfBytes = out.blob.size;
              resolve(out);
            });
            return;
          }
          window._iuPdfLastSource = "word";
          window._iuPdfLastWordMode = "word-pending";
          function isZipMagic(buffer) {
            if (!buffer || buffer.byteLength < 4) return false;
            var u8 = new Uint8Array(buffer);
            return u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04;
          }
          function fallbackToPdfMinimal() {
            window._iuPdfLastWordMode = "word-text-fallback";
            iuPdfGenerateFromPlainText("Dokument se nepodařilo přečíst.", { source: "word", fileName: "document.pdf" }, function(err, out) {
              if (err || !out || !out.blob) { reject(err || new Error("pdf")); return; }
              window._iuPdfLastPdfBytes = out.blob.size;
              resolve(out);
            });
          }
          function fallbackToText() {
            window.mammoth.extractRawText({ arrayBuffer: ab }).then(function(r) {
              var raw = (r && r.value) ? String(r.value) : "";
              var text = normalizePdfText(raw);
              if (!text || /^\s*$/.test(text)) { window._iuPdfLastWordError = "empty"; reject(new Error("empty")); return; }
              window._iuPdfLastWordMode = "word-text-fallback";
              iuPdfGenerateFromPlainText(text, { source: "word", fileName: "document.pdf" }, function(err, out) {
                if (err || !out || !out.blob) {
                  window._iuPdfLastWordError = String(err && (err.stack || err.message || err));
                  reject(err || new Error("pdf"));
                } else {
                  window._iuPdfLastPdfBytes = out.blob ? out.blob.size : 0;
                  resolve(out);
                }
              });
            }).catch(function(e) {
              window._iuPdfLastWordError = String(e && (e.stack || e.message || e));
              fallbackToPdfMinimal();
            });
          }
          if (!isZipMagic(ab)) { fallbackToPdfMinimal(); return; }
          var convertImage = window.mammoth.images && window.mammoth.images.inline
            ? window.mammoth.images.inline(function(image) {
                return image.read("base64").then(function(base64) {
                  return { src: "data:" + (image.contentType || "image/png") + ";base64," + base64 };
                });
              })
            : undefined;
          var convertPromise = window.mammoth.convertToHtml({ arrayBuffer: ab }, convertImage ? { convertImage: convertImage } : {});
          var timeoutPromise = new Promise(function(_, rej) { setTimeout(function() { rej(new Error("timeout")); }, 60000); });
          Promise.race([convertPromise, timeoutPromise]).then(function(result) {
              var html = (result && result.value) ? String(result.value) : "";
              if (!html || /^\s*$/.test(html)) { fallbackToText(); return; }
              if (html.length < 50) { fallbackToText(); return; }
              var hasImg = /<img\b/i.test(html);
              var hasTable = /<table\b/i.test(html);
              var textLen = (html.replace(/<[^>]+>/g, "").trim()).length;
              if (!hasImg && !hasTable && (!textLen || /^\s*$/.test(html.replace(/<[^>]+>/g, "")))) { fallbackToText(); return; }
              window._iuPdfWordExportV = "word-export-offscreen-v1";
              var exportRoot = document.createElement("div");
              exportRoot.setAttribute("data-iu", "pdf-export-root");
              exportRoot.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:auto;overflow:visible;background:#fff;color:#000;z-index:-1;pointer-events:none;box-sizing:border-box;padding:12px;font-family:system-ui,-apple-system,sans-serif;";
              document.body.appendChild(exportRoot);
              exportRoot.innerHTML = html;
              exportRoot.style.maxHeight = "none";
              exportRoot.style.height = "auto";
              exportRoot.style.overflow = "visible";
              var cs = window.getComputedStyle ? window.getComputedStyle(exportRoot) : {};
              var exportRootCss = { overflow: exportRoot.style.overflow || cs.overflow || "", height: exportRoot.style.height || cs.height || "", maxHeight: exportRoot.style.maxHeight || cs.maxHeight || "", position: cs.position || "", widthPx: exportRoot.scrollWidth || 0 };
              var imgCount = 0;
              var imgLoadedOk = 0;
              var imgLoadedFail = 0;
              var imgs = exportRoot.querySelectorAll ? exportRoot.querySelectorAll("img") : [];
              imgCount = imgs.length;
              function safeFontsReady() {
                try {
                  var r = document && document.fonts && document.fonts.ready;
                  if (r && typeof r.then === "function") {
                    return r.catch(function(){});
                  }
                } catch(e){}
                return Promise.resolve();
              }
              function waitImagesAndFonts(thenExport) {
                if (imgCount === 0) {
                  safeFontsReady().then(thenExport);
                  return;
                }
                var done = 0;
                function onImg() {
                  done++;
                  if (done === imgCount) {
                    for (var j = 0; j < imgs.length; j++) {
                      if (imgs[j].naturalWidth > 0) imgLoadedOk++; else imgLoadedFail++;
                    }
                    safeFontsReady().then(thenExport);
                  }
                }
                for (var i = 0; i < imgs.length; i++) {
                  var img = imgs[i];
                  if (img.complete) onImg(); else { img.onload = onImg; img.onerror = onImg; }
                }
              }
              waitImagesAndFonts(function() {
                if (hasImg && imgLoadedFail > 0) {
                  if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
                  fallbackToText();
                  return;
                }
                loadHtml2PdfIfNeeded(function() {
                  if (typeof window.html2pdf === "undefined") {
                    if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
                    fallbackToText();
                    return;
                  }
                  var opts = {
                    image: { type: "png", quality: 1.0 },
                    html2canvas: { scale: 2, scrollX: 0, scrollY: 0, windowWidth: exportRoot.scrollWidth, windowHeight: exportRoot.scrollHeight, useCORS: false, backgroundColor: "#ffffff" },
                    jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
                    pagebreak: { mode: ["css", "legacy"] }
                  };
                  var scrollH = exportRoot.scrollHeight;
                  var clientH = exportRoot.clientHeight;
                  window.html2pdf().set(opts).from(exportRoot).toPdf().outputPdf("blob").then(function(blob) {
                    if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
                    if (!blob || blob.size < 5000) { fallbackToText(); return; }
                    window._iuPdfLastWordMode = "word-html2pdf";
                    window._iuPdfLastWordHtmlStats = { hasImg: hasImg, hasTable: hasTable, htmlLen: html.length, textLen: textLen, imgCount: imgCount, imgLoadedOk: imgLoadedOk, imgLoadedFail: imgLoadedFail, exportRootScrollH: scrollH, exportRootClientH: clientH, exportRootCss: exportRootCss };
                    window._iuPdfLastPdfBytes = blob.size;
                    window._iuPdfLastWordError = null;
                    resolve({ blob: blob, fileName: "document.pdf" });
                  }).catch(function(e) {
                    if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
                    window._iuPdfLastWordError = String(e && (e.stack || e.message || e));
                    fallbackToText();
                  });
                });
              });
            }).catch(function(e) {
              window._iuPdfLastWordError = String(e && (e.stack || e.message || e));
              fallbackToText();
            });
        });
      });
    }
    function doDocxConvert(file, action) {
      action = action || "download";
      showWordPdfError("");
      loadMammothIfNeeded(function() {
        if (typeof window.mammoth === "undefined") { showWordPdfError("Převod není k dispozici."); return; }
        iuGenerateWordPdfBlobFromSelectedDocx(file).then(function(out) {
          showWordPdfError("");
          if (action === "share") {
            var f = new File([out.blob], out.fileName || "document.pdf", { type: "application/pdf" });
            if (navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f] }).catch(function() {});
          } else {
            var url = URL.createObjectURL(out.blob);
            var a = document.createElement("a"); a.href = url; a.download = out.fileName || "document.pdf"; a.click();
            setTimeout(function() { URL.revokeObjectURL(url); }, 500);
          }
        }).catch(function(err) {
          window._iuPdfLastWordMode = "word-error";
          window._iuPdfLastWordError = String(err && (err.stack || err.message || err));
          window._iuPdfLastPdfBytes = 0;
          if (String(err && err.message) === "empty") showWordPdfError("Dokument je prázdný nebo se nepodařilo přečíst text.");
          else if (String(err && err.message) === "read") showWordPdfError("Soubor nelze přečíst. Zkuste jiný .docx soubor.");
          else showWordPdfError("Generování PDF selhalo.");
        });
      });
    }
    if (textBtn && textInput) textBtn.addEventListener("click", function() {
      var text = textInput.value;
      iuPdfGenerateFromPlainText(text, { source: "text", fileName: "text.pdf" }, function(err, out) {
        if (err || !out || !out.blob) return;
        var url = URL.createObjectURL(out.blob);
        var a = document.createElement("a"); a.href = url; a.download = out.fileName || "text.pdf"; a.click();
        setTimeout(function() { URL.revokeObjectURL(url); }, 500);
      });
    });
    if (docxBtn && docxInput) docxBtn.addEventListener("click", function() {
      var file = docxInput.files && docxInput.files[0];
      if (!file) return;
      doDocxConvert(file, "download");
    });
    if (shareConvertBtn && docxInput) shareConvertBtn.addEventListener("click", function() {
      var file = docxInput.files && docxInput.files[0];
      if (!file || shareConvertBtn.disabled) return;
      doDocxConvert(file, "share");
    });
    updateShareConvertButton();
  }
