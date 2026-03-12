# OCR Receipt Corpus (Phase 7.2R)

## Účel

Tento adresář slouží jako **reálný corpus účtenek** pro validaci přesnosti OCR pipeline (Phase 7.2R). Do `receipts/` se ručně ukládají obrázky skutečných účtenek.

## Pravidla

- **Pouze reálné účtenky** – žádné syntetické ani simulované texty.
- **Minimálně 10 dokumentů** – pro splnění Phase 7.2R je potřeba alespoň 10 reálných dokladů.
- **Golden truth nezávislá na OCR** – očekávané hodnoty (header, items, totals, payment) se doplňují ručně a neodvozují se z výstupu OCR.
- **Syntetické scénáře nejsou povoleny** – měření přesnosti probíhá výhradně nad reálnými obrázky a nezávislou golden truth.

## Struktura

- `receipts/` – adresář pro obrázky účtenek (např. `funbaby_001.jpg`, `datart_001.jpg`, …).
- `receipt_corpus_template.json` – šablona pro popis dokumentů a golden truth (pole záznamů s `documentId`, `imageRef`, `golden`).
- `receipt_corpus.json` – vznikne později; obsahuje skutečný seznam dokumentů a golden truth.

## Proměnná prostředí

Pro spuštění Phase 7.2R real-image validace použijte:

```bash
IU_PHASE72R_CORPUS_JSON=ocr_corpus/receipt_corpus.json
```

Soubor `receipt_corpus.json` se vytvoří po doplnění obrázků a golden truth.
