import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setPremiumPdfFontBoldBytesForTests, setPremiumPdfFontBytesForTests } from "../src/premium-pdf-font";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "../assets/fonts");
const regularPath = join(fontsDir, "noto-sans-latin-ext-400-normal.ttf");
const boldPath = join(fontsDir, "noto-sans-latin-ext-700-normal.ttf");
const regularBuf = readFileSync(regularPath);
const boldBuf = readFileSync(boldPath);
setPremiumPdfFontBytesForTests(regularBuf.buffer.slice(regularBuf.byteOffset, regularBuf.byteOffset + regularBuf.byteLength));
setPremiumPdfFontBoldBytesForTests(boldBuf.buffer.slice(boldBuf.byteOffset, boldBuf.byteOffset + boldBuf.byteLength));
