#!/usr/bin/env bash
set -euo pipefail
OUT_DIR="${1:?out dir}"
PDF="${OUT_DIR}/invoice-reference-like.pdf"
PNG="${OUT_DIR}/invoice-reference-like.png"
test -s "$PDF"
if command -v pdftoppm >/dev/null 2>&1; then
  pdftoppm -png -singlefile -r 150 "$PDF" "${OUT_DIR}/invoice-reference-like"
  test -s "$PNG"
  echo "IU_INVOICE_PNG_RASTER=pdftoppm"
  exit 0
fi
node "$(dirname "$0")/rasterize-invoice-pdf-png.mjs" "$OUT_DIR"
