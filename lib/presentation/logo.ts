import { readFileSync } from "node:fs";
import path from "node:path";

// Embed the existing public mark so sandboxed Pages need no image request or extra CSP origin.
export const MSO_LOGO_SVG = readFileSync(path.join(process.cwd(), "public/icon.svg"), "utf8");
