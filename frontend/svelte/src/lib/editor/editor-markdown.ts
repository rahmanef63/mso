export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string };

export type MdBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: MdInline[] }
  | { kind: "paragraph"; inlines: MdInline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; items: MdInline[][] }
  | { kind: "quote"; lines: MdInline[][] }
  | { kind: "hr" };

export function sanitizeLinkHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseMdInlines(text: string): MdInline[] {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  const out: MdInline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1]) {
      out.push({ kind: "code", text: m[1].slice(1, -1) });
    } else if (m[2]) {
      out.push({ kind: "bold", text: m[2].slice(2, -2) });
    } else if (m[3]) {
      out.push({ kind: "italic", text: m[3].slice(1, -1) });
    } else if (m[4]) {
      const safeHref = sanitizeLinkHref(m[6] ?? "");
      if (safeHref) out.push({ kind: "link", text: m[5] ?? safeHref, href: safeHref });
      else out.push({ kind: "text", text: m[5] ?? m[4] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.length ? out : [{ kind: "text", text: "" }];
}

export function parseMarkdownBlocks(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(/^\s*```([A-Za-z0-9_+-]*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ kind: "code", lang, text: codeLines.join("\n") });
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, Math.max(1, heading[1].length)) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, inlines: parseMdInlines(heading[2].trim()) });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const qLines: MdInline[][] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        qLines.push(parseMdInlines(lines[i].replace(/^\s*>\s?/, "")));
        i++;
      }
      blocks.push({ kind: "quote", lines: qLines });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(parseMdInlines(lines[i].replace(/^\s*[-*+]\s+/, "")));
        i++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(parseMdInlines(lines[i].replace(/^\s*\d+\.\s+/, "")));
        i++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length
      && lines[i].trim()
      && !/^\s*(?:```|#{1,6}\s|>\s?|[-*+]\s|\d+\.\s|(?:---+|\*\*\*+|___+)\s*$)/.test(lines[i])
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", inlines: parseMdInlines(paraLines.join(" ")) });
  }

  return blocks;
}
