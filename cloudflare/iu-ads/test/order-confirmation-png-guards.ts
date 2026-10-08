import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Detect dense dark text in the bottom footer band (hash/body overlapping footer notes). */
export async function orderConfirmationPage1FooterBandContentOverlap(png: Buffer): Promise<boolean> {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
  const yStart = Math.floor(height * 0.872);
  const xStart = Math.floor(width * 0.12);
  const xEnd = Math.floor(width * 0.9);
  let darkRunMax = 0;
  for (let y = yStart; y < height - 2; y += 1) {
    let run = 0;
    for (let x = xStart; x < xEnd; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const isDarkText = r < 70 && g < 70 && b < 75;
      if (isDarkText) {
        run++;
        if (run > darkRunMax) darkRunMax = run;
      } else {
        run = 0;
      }
    }
  }
  const spanThreshold = Math.floor(width * 0.35);
  return darkRunMax >= spanThreshold;
}

/** Sample creative uses brand blue fill — expect visible blue in the upper creative zone on page 2. */
export async function orderConfirmationPage2HasEmbeddedCreative(png: Buffer): Promise<{
  ok: boolean;
  blueRatio: number;
  aspectOk: boolean;
}> {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
  const yTop = Math.floor(height * 0.12);
  const yBottom = Math.floor(height * 0.55);
  let blue = 0;
  let samples = 0;
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (let y = yTop; y < yBottom; y += 2) {
    for (let x = Math.floor(width * 0.08); x < Math.floor(width * 0.92); x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      samples++;
      const isBrandBlue = r < 40 && g > 40 && g < 120 && b > 200;
      if (isBrandBlue) {
        blue++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const blueRatio = samples > 0 ? blue / samples : 0;
  const boxW = maxX - minX;
  const boxH = maxY - minY;
  const aspect = boxH > 0 ? boxW / boxH : 0;
  const aspectOk = aspect > 1.2 && aspect < 2.2 && boxW > width * 0.25 && boxH > height * 0.08;
  return { ok: blueRatio > 0.04 && aspectOk, blueRatio, aspectOk };
}
