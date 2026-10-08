import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setPremiumPdfFontBytesForTests } from "../src/premium-pdf-font";

const fontPath = join(dirname(fileURLToPath(import.meta.url)), "../assets/fonts/noto-sans-latin-ext-400-normal.ttf");
const buf = readFileSync(fontPath);
setPremiumPdfFontBytesForTests(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
