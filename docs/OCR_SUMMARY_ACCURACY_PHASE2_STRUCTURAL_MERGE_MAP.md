# OCR Summary Accuracy Phase 2 — Structural Line Merge (Forensic Map)

## Current pipeline (Phase 1)
- **Normalization:** `iuEvidenceNormalizeOcrText(raw)` — app.js ~9113. Called at pipeline start in `iuEvidenceOcrPipeline` ~11686.
- **Zone detection:** `iuEvidenceClassifyDocumentZones(geometry, docHeight)` — app.js ~9606. Used in `iuEvidenceDecodeReceiptStructure` ~9630; not used in text-only path (pipeline passes normalized string to parse).
- **Merchant scoring:** `iuEvidencePickMerchantFromLines(lines)` — app.js ~9248. Called inside `iuEvidenceParseNormalizedToFields` ~9307. `iuEvidenceSupplierFromLegalFormBlock` ~9279 overrides when present.
- **Total scoring:** Inside `iuEvidenceParseNormalizedToFields`: `celkemLine` = first line matching /celkem|total|celk/i; amount from same line or next line ~9327–9351. `totalAnchorIdx` = first line with total/footer marker ~9354.
- **Payment scoring:** `iuEvidencePaymentMethodResolver(linesText, pipelineResult)` — app.js ~10278. Called in pipeline ~11765 with `textLinesForPayment` (all lines). Footer re-run in OCR hook when payment unknown ~12674.
- **Structural merge insertion:** After `iuEvidenceNormalizeOcrText`, before `iuEvidenceParseNormalizedToFields`. New step: `iuEvidenceStructuralLineMerge(normalizedText)` → merged text → parse(mergedText).
- **Vertical pair insertion:** Inside `iuEvidenceStructuralLineMerge`: when line i is total/payment marker and line i+1 is amount or payment label, merge into one line.
- **Footer gravity insertion:** (1) In `iuEvidenceParseNormalizedToFields`: total = among total candidates pick by max line index (footer). (2) In `iuEvidencePaymentMethodResolver`: resolve payment from lines bottom-up (last line first).
- **Item-price noise penalty insertion:** In `iuEvidenceParseNormalizedToFields`: when collecting total candidates, exclude lines that match item+price pattern (e.g. `WORD 25,90`) without total marker.

## Existing coverage (Phase 1 tests)
- `iuEvidenceRunSummaryExtractionTests`: legal form, line cleanup, quality score, zone detection, payment resolver, action-like pipeline, date/time/total UI, Neurčeno, parse (addr_only, ico_only, dekujeme, legal_beats_header).
- New Phase 2 tests: vertical_pair_total, vertical_pair_total_alt, vertical_pair_payment_card, vertical_pair_payment_cash, merchant_multiline_block_action_like, merchant_multiline_legal_beats_slogan, footer_gravity_prefers_real_total, item_price_noise_penalty, action_like_acceptance_still_holds, ui_truth_still_holds.

## New tests planned
- vertical_pair_* (pipeline on synthetic "CELKEM\n195,30" etc. → total/payment)
- merchant_multiline_* (merged header "ACTION\nRETAIL\nCZECH\nSRO" → one merchant block)
- footer_gravity_* (synthetic footer: item line, mezisoučet, CELKEM\n195,30 → total 195,30)
- item_price_noise_penalty (JABLKO 25,90, CHLÉB 34,90, CELKEM 195,30 → total 195,30)
- action_like_acceptance_still_holds, ui_truth_still_holds (regression)
