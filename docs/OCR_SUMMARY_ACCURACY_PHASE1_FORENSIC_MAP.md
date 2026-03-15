# OCR Summary Accuracy Phase 1 — Forensic Map

## Preprocessing (současný stav)
- **iuEvidencePrepareDocumentImage(file)** — načte obrázek do canvasu.
- **iuEvidenceContrastNormalize(canvas)** — kontrast (min/max luminance scale).
- **iuEvidenceThresholdBinarize(canvas)** — 128 threshold.
- **iuEvidenceAdaptiveBinarize(canvas)** — bloky 32px.
- **iuEvidenceDetectSkew**, **iuEvidenceRotateCanvas**, **iuEvidenceDeskewCanvas** — deskew.
- **iuEvidenceDenoiseCanvas** — 3×3 box blur.
- **iuEvidenceRunPreprocessing(canvas)** — volá: contrast → deskew → denoise → adaptive binarize → contrast.
- **Kde doplnit dual-pass:** V `iuEvidenceOcrHook`: po `iuEvidencePrepareDocumentImage` spustit OCR na **originálním** canvasu (PASS 1) a na **preprocessovaném** canvasu (PASS 2), spočítat quality score obou textů, vybrat lepší. Uložit `ocrPassChosen` (1|2) a pass metadata do result/debug.

## Normalization (současný stav)
- **iuEvidenceNormalizeOcrText(raw)** — `assets/app.js` ~9113: CRLF→LF, whitespace, Kc→Kč pak Kč→Kc (chyba?), ~→-, čárka v číslech.
- **iuEvidenceNormalizeLegalFormCzech(s)** — ~9130: spol. s r.o., v.o.s., k.s., a.s., s.r.o., s.p.
- **Kde doplnit:** V `iuEvidenceNormalizeOcrText`: line cleanup (CELKEM........195,30 → CELKEM 195,30), sjednocení CELKEM/TOTAL/K ÚHRADĚ, Kc→Kč jen při jistotě. Rozšířit **iuEvidenceNormalizeLegalFormCzech** o varianty s r o, s.r o, sr.o, a s, v o s, k s, spol s r o.

## Merchant extraction (současný stav)
- **iuEvidencePickMerchantFromLines(lines)** — ~9246: scoring (s.r.o./a.s. +3, merchantLike +2), fallback první řádek, filtrace header noise.
- **iuEvidenceSupplierFromLegalFormBlock(normalizedText)** — ~9277: regex bloky s právní formou.
- **iuEvidenceParseNormalizedToFields** — ~9302: store = supplierFromBlock nebo iuEvidencePickMerchantFromLines; pak iuEvidenceAutoCorrectStore.
- **iuEvidenceIsHeaderNoiseLine** — filtruje IČ/DIČ/datum/platba atd.
- Zone-based: po OCR, pokud cf.store==="unknown" && documentZones.merchantZone, znovu iuEvidencePickMerchantFromLines na merchantZone textech.
- **Kde doplnit line scoring:** Rozšířit **iuEvidencePickMerchantFromLines** (nebo nová funkce) o explicitní scoring kandidátů: body za právní formu, header, blízkost IČ/DIČ, retail/market/store/czech, penalizace cena/item/adresa/slogan. Vrátit value + confidence + evidence/sourceLineIndexes. Sjednotit s **iuEvidenceSupplierFromLegalFormBlock** (primární evidence).

## Total extraction (současný stav)
- **iuEvidenceParseNormalizedToFields:** celkemLine z řádků s /celkem|total|celk/i, regex pro částku, totalAnchorIdx od prvního markeru celkem/total/k úhradě.
- **iuEvidencePhase73ItemTotalsDecoder(geometry)** — totalKeywordRe, pravý sloupec cen.
- Zóny: totalsZone v iuEvidenceClassifyDocumentZones; TOTALS_BLOCK v DecodeReceiptStructure.
- **Kde doplnit line scoring:** Footer-first: total hledat primárně v totalsZone/footer. Total scoring: body za celkem/total/k úhradě, za \d+[.,]\d{2}, za footer; penalizace item řádky, mezisoučty. Finální formát vždy přes **iuEvidenceFormatTotalTwoDecimals** → "195,30 Kč".

## Payment extraction (současný stav)
- **iuEvidencePaymentMethodResolver(linesText, pipelineResult)** — ~10276: cash/card/transfer/voucher/unknown, konflikt→unknown; kombinuje linesText a raw.
- **Kde doplnit footer-first:** Priorita: řádky z PAYMENT_BLOCK / footer zóny, pak total-neighborhood, pak globální text. "Vráceno (hotově)" silně → hotovost. Samotný "terminal" bez kontextu nedostatečný.

## Review UI (současný stav)
- **iuEvidenceUploadInit**, **setReviewField** — review-store/date/time/total/doctype/payment.
- **paymentDisplay** = iuEvidencePaymentToDisplayLabel(result.paymentMethodValue) nebo iuEvidenceMapPaymentMethod(raw).
- **iuEvidencePaymentToDisplayLabel** — cash→Hotovost, card→Karta, transfer→Převod, voucher→Stravenky, other→Jiné, default Neurčeno.
- **Problém:** iuEvidenceFormatTotalTwoDecimals při val==="unknown" vrací "unknown" → v UI se může zobrazit "unknown". Opravit na "—" pro zobrazení.
- **unknown:** Nikde nezobrazovat řetězec "unknown"; u payment/total/store použít "Neurčeno"/"—" dle kontextu.

## Zone detection (současný stav)
- **iuEvidenceClassifyDocumentZones(geometry, docHeight)** — ~9604: merchantZone (i===0 + yNorm<0.25), metaZone (datum/čas), itemsZone, totalsZone, vatZone, idsZone.
- **iuEvidenceDecodeReceiptStructure** — HEADER_BLOCK (merchant+meta), ITEMS_BLOCK, TOTALS_BLOCK, PAYMENT_BLOCK, FOOTER_BLOCK (idsZone), UNKNOWN_BLOCK.
- **Kde doplnit:** Sjednotit pojmy header/items/footer: header = začátek dokladu (firma, adresa, IČ/DIČ); footer = od prvního silného markeru (celkem, total, k úhradě, DPH, platba, hotově, karta, …). Items mezi nimi. Total a payment primárně z footer.

## Line scoring (kde doplnit)
- **Merchant:** Rozšířit stávající scoring v iuEvidencePickMerchantFromLines o body/penalizace dle specifikace; výstup value, confidence, needsReview, optional evidence/sourceLineIndexes.
- **Total:** Nová nebo rozšířená logika: kandidáti řádků s částkou; score za keyword (celkem/total/k úhradě), formát \d+[.,]\d{2}, footer zóna; penalizace item. Vybrat nejlepší, formátovat přes iuEvidenceFormatTotalTwoDecimals.
- **Payment:** Rozšířit iuEvidencePaymentMethodResolver o prioritu footer řádků a total-neighborhood; scoring pro hotově/karta/převod/stravenky; konflikt → Neurčeno.

## Dual-pass selection (kde doplnit)
- V **iuEvidenceOcrHook** po PrepareDocumentImage: PASS 1 = OCR(originalCanvas), PASS 2 = OCR(preprocessedCanvas) s lehkým preprocessem (grayscale, kontrast, jemný threshold, bez destruktivního crop).
- **iuEvidenceOcrTextQualityScore(text)** — body za počet písmen, číslic, klíčová slova (celkem, total, hotově, karta, IČ, DIČ, DPH, Kč), částky \d+[.,]\d{2}, datum, čas, právní formu; penalizace za příliš krátký text, nulové číslice, rozbitý text, opakované nesmysly.
- Vybrat text s vyšším skóre; uložit ocrPassChosen (1|2), pass1Score, pass2Score do result a __iuEvidenceDebug.
