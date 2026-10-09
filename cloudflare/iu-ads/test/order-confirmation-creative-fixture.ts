import { createCanvas } from "@napi-rs/canvas";

/** 320×200 brand-blue sample ad used in order-confirmation PDF tests (not a 1×1 placeholder). */
export function buildOrderConfirmationSampleCreativePng(): Uint8Array {
  const w = 320;
  const h = 200;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#003cff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("IU TEST CREATIVE", 36, h / 2);
  ctx.font = "14px sans-serif";
  ctx.fillText("320 × 200 px", 36, h / 2 + 28);
  return new Uint8Array(canvas.toBuffer("image/png"));
}
