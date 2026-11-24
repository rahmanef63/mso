// Safe ANSI SGR renderer: escape sequences become structured runs, never HTML.
// Only SGR (colour/intensity/style) is interpreted; every other control byte is
// removed upstream by sanitizeTerminalOutput, so runs contain printable text only.
import { findMatches } from "./term-search.ts";

export type AnsiRun = {
  text: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
};

export type RenderRun = AnsiRun & { hit: "none" | "match" | "active" };
type Style = Omit<AnsiRun, "text">;

/** Palette slots resolved by CSS vars in TerminalOutput.svelte for both themes. */
export const PALETTE16 = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "bright-black", "bright-red", "bright-green", "bright-yellow",
  "bright-blue", "bright-magenta", "bright-cyan", "bright-white",
] as const;

const RESET: Style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
const SGR_AT = /\x1b\[([0-9;]*)m/y;
const HEX_RE = /^#[0-9a-f]{6}$/;
const CUBE = [0, 95, 135, 175, 215, 255];

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** xterm 256-colour index to a palette key (0-15) or literal hex. */
export function color256(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > 255) return null;
  if (index < 16) return PALETTE16[index];
  if (index < 232) {
    const n = index - 16;
    return rgbHex(CUBE[Math.floor(n / 36) % 6], CUBE[Math.floor(n / 6) % 6], CUBE[n % 6]);
  }
  const level = 8 + (index - 232) * 10;
  return rgbHex(level, level, level);
}

/** CSS value for a resolved ANSI colour, or undefined for the inherited default. */
export function ansiColorCss(color: string | null): string | undefined {
  if (!color) return undefined;
  return HEX_RE.test(color) ? color : `var(--t-ansi-${color})`;
}

function applyCodes(style: Style, codes: number[]): Style {
  let next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) next = { ...RESET };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) { next.bold = false; next.dim = false; }
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code >= 30 && code <= 37) next.fg = PALETTE16[code - 30];
    else if (code === 39) next.fg = null;
    else if (code >= 40 && code <= 47) next.bg = PALETTE16[code - 40];
    else if (code === 49) next.bg = null;
    else if (code >= 90 && code <= 97) next.fg = PALETTE16[code - 90 + 8];
    else if (code >= 100 && code <= 107) next.bg = PALETTE16[code - 100 + 8];
    else if (code === 38 || code === 48) {
      const slot = code === 38 ? "fg" : "bg";
      const mode = codes[i + 1];
      if (mode === 5) {
        const color = color256(codes[i + 2]);
        if (color) next[slot] = color;
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
        if ([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) next[slot] = rgbHex(r, g, b);
        i += 4;
      } else {
        i += 1;
      }
    }
  }
  return next;
}

export function runsText(runs: AnsiRun[]): string {
  let text = "";
  for (const run of runs) text += run.text;
  return text;
}

export function stripSgr(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Keep the newest `maxChars` visible characters; never split a run mid-escape. */
export function capRuns(runs: AnsiRun[], maxChars = 65_536): AnsiRun[] {
  let total = 0;
  for (const run of runs) total += run.text.length;
  if (total <= maxChars) return runs;
  const drop = total - maxChars;
  const out: AnsiRun[] = [];
  let skipped = 0;
  for (const run of runs) {
    if (skipped >= drop) { out.push(run); continue; }
    const remaining = drop - skipped;
    if (run.text.length <= remaining) { skipped += run.text.length; continue; }
    skipped = drop;
    out.push({ ...run, text: run.text.slice(remaining) });
  }
  return out;
}

export function parseAnsiRuns(text: string, maxChars = 65_536): AnsiRun[] {
  const runs: AnsiRun[] = [];
  let style: Style = { ...RESET };
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    const last = runs[runs.length - 1];
    if (last && last.fg === style.fg && last.bg === style.bg && last.bold === style.bold
      && last.dim === style.dim && last.italic === style.italic && last.underline === style.underline) {
      last.text += buffer;
    } else {
      runs.push({ ...style, text: buffer });
    }
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b") {
      SGR_AT.lastIndex = i;
      const match = SGR_AT.exec(text);
      if (match) {
        flush();
        const body = match[1];
        const codes = body === "" ? [0] : body.split(";").map((part) => (part === "" ? 0 : Number(part)));
        style = applyCodes(style, codes.filter((n) => Number.isFinite(n) && n >= 0));
        i = SGR_AT.lastIndex;
        continue;
      }
      // Any non-SGR escape that survived sanitizing is dropped, never printed.
      i += 2;
      continue;
    }
    buffer += text[i];
    i++;
  }
  flush();
  return capRuns(runs, maxChars);
}

/** Split runs at search-match boundaries so matches can be marked without HTML. */
export function highlightRuns(runs: AnsiRun[], query: string, activeIndex = -1): RenderRun[] {
  const plain = query.trim() ? runsText(runs) : "";
  const matches = plain ? findMatches(plain, query) : [];
  if (!matches.length) return runs.map((run) => ({ ...run, hit: "none" as const }));
  const out: RenderRun[] = [];
  let offset = 0;
  let matchIndex = 0;
  for (const run of runs) {
    const start = offset;
    const end = offset + run.text.length;
    let cursor = start;
    while (matchIndex < matches.length && matches[matchIndex].start < end) {
      const match = matches[matchIndex];
      const from = Math.max(match.start, cursor);
      const to = Math.min(match.start + match.length, end);
      if (to <= from) { matchIndex++; continue; }
      if (from > cursor) out.push({ ...run, text: run.text.slice(cursor - start, from - start), hit: "none" });
      out.push({
        ...run,
        text: run.text.slice(from - start, to - start),
        hit: matchIndex === activeIndex ? "active" : "match",
      });
      cursor = to;
      if (match.start + match.length <= end) matchIndex++;
      if (cursor >= end) break;
    }
    if (cursor < end) out.push({ ...run, text: run.text.slice(cursor - start), hit: "none" });
    offset = end;
  }
  return out;
}
