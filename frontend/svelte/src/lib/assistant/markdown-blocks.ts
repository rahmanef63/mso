// Pure, zero-HTML structured markdown parser for Alfa Assistant messages.
// Never produces raw HTML strings; Svelte renders every node declaratively.

export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; label: string; href: string };

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; segments: InlineSegment[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "list"; ordered: boolean; items: InlineSegment[][] }
  | { kind: "blockquote"; segments: InlineSegment[] }
  | { kind: "paragraph"; segments: InlineSegment[] };

const SAFE_URL_RE = /^https?:\/\/[^\s<>()]+$/i;
const LANG_RE = /^[a-z0-9._+-]{1,24}$/i;
const INLINE_TOKEN_RE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const UL_RE = /^\s*[-*+]\s+(.+)$/;
const OL_RE = /^\s*\d+\.\s+(.+)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_OPEN_RE = /^```([a-z0-9._+-]*)\s*$/i;
const FENCE_CLOSE_RE = /^```\s*$/;

export function isSafeHttpUrl(raw: string): boolean {
  return SAFE_URL_RE.test(raw.trim());
}

export function parseInline(text: string): InlineSegment[] {
  if (!text) return [];
  const segments: InlineSegment[] = [];
  let cursor = 0;
  INLINE_TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: "code", text: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "strong", text: match[2] });
    } else if (match[3] !== undefined) {
      segments.push({ kind: "em", text: match[3] });
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const href = match[5].trim();
      if (isSafeHttpUrl(href)) {
        segments.push({ kind: "link", label: match[4], href });
      } else {
        segments.push({ kind: "text", text: match[0] });
      }
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    if (!line.trim()) {
      idx++;
      continue;
    }

    const fenceOpen = FENCE_OPEN_RE.exec(line.trim());
    if (fenceOpen) {
      const rawLang = (fenceOpen[1] ?? "").trim();
      const lang = LANG_RE.test(rawLang) ? rawLang.toLowerCase() : "";
      const codeLines: string[] = [];
      idx++;
      while (idx < lines.length && !FENCE_CLOSE_RE.test(lines[idx].trim())) {
        codeLines.push(lines[idx]);
        idx++;
      }
      if (idx < lines.length && FENCE_CLOSE_RE.test(lines[idx].trim())) idx++;
      blocks.push({ kind: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    const heading = HEADING_RE.exec(line.trim());
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, segments: parseInline(heading[2].trim()) });
      idx++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (idx < lines.length && QUOTE_RE.test(lines[idx])) {
        const match = QUOTE_RE.exec(lines[idx]);
        if (match) quoteLines.push(match[1]);
        idx++;
      }
      blocks.push({ kind: "blockquote", segments: parseInline(quoteLines.join(" ").trim()) });
      continue;
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const matcher = ordered ? OL_RE : UL_RE;
      const items: InlineSegment[][] = [];
      while (idx < lines.length && matcher.test(lines[idx])) {
        const match = matcher.exec(lines[idx]);
        if (match) items.push(parseInline(match[1].trim()));
        idx++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      idx < lines.length &&
      lines[idx].trim() &&
      !FENCE_OPEN_RE.test(lines[idx].trim()) &&
      !HEADING_RE.test(lines[idx].trim()) &&
      !QUOTE_RE.test(lines[idx]) &&
      !UL_RE.test(lines[idx]) &&
      !OL_RE.test(lines[idx])
    ) {
      paraLines.push(lines[idx]);
      idx++;
    }
    if (paraLines.length) {
      blocks.push({ kind: "paragraph", segments: parseInline(paraLines.join("\n")) });
    }
  }

  return blocks;
}
