export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; label: string; target: string; wiki: boolean }
  | { kind: "image"; alt: string };

export type Block =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "quote"; inline: Inline[] }
  | { kind: "rule" };

const INLINE = /(!?\[\[[^[\]\n]+\]\]|!?\[[^[\]\n]*\]\([^\s()[\]>]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith("!")) { out.push({ kind: "image", alt: part.replace(/^!\[/, "").replace(/^\[\[/, "").replace(/[\]()]+$/, "") }); continue; }
    if (part.startsWith("`")) { out.push({ kind: "code", text: part.slice(1, -1) }); continue; }
    if (part.startsWith("**") || part.startsWith("__")) { out.push({ kind: "strong", text: part.slice(2, -2) }); continue; }
    if (part.startsWith("*")) { out.push({ kind: "em", text: part.slice(1, -1) }); continue; }
    const wiki = part.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (wiki) { out.push({ kind: "link", label: (wiki[2] || wiki[1]!).trim(), target: wiki[1]!.trim(), wiki: true }); continue; }
    const md = part.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
    if (md) { out.push({ kind: "link", label: md[1]!.trim() || md[2]!, target: md[2]!.trim(), wiki: false }); continue; }
    out.push({ kind: "text", text: part });
  }
  return out;
}

/** Strips a leading YAML frontmatter block; the frontmatter panel shows it separately. */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

export function frontmatter(content: string): Array<{ key: string; value: string }> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const rows: Array<{ key: string; value: string }> = [];
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (pair) rows.push({ key: pair[1]!, value: pair[2]!.replace(/^["']|["']$/g, "").trim() });
    else if (rows.length > 0 && line.trim()) {
      const last = rows[rows.length - 1]!;
      last.value = `${last.value} ${line.trim()}`.trim();
    }
  }
  return rows;
}

/** Inert Markdown parser: HTML and embeds stay text, nothing is ever injected as markup. */
export function parseMarkdown(content: string): Block[] {
  const lines = stripFrontmatter(content).split(/\r?\n/);
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;

    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2]!.trim();
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.trim().startsWith(marker)) code.push(lines[i]!);
      blocks.push({ kind: "code", lang, code: code.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, inline: parseInline(heading[2]!) });
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push({ kind: "rule" }); continue; }

    if (/^\s*(?:[-*+]\s|\d+\.\s)/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const pattern = ordered ? /^\s*\d+\.\s/ : /^\s*[-*+]\s/;
      const items: Inline[][] = [];
      do { items.push(parseInline(lines[i]!.replace(pattern, ""))); i++; } while (i < lines.length && pattern.test(lines[i]!));
      i--;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (line.startsWith(">")) {
      const quoted: string[] = [];
      do { quoted.push(lines[i]!.replace(/^>\s?/, "")); i++; } while (i < lines.length && lines[i]!.startsWith(">"));
      i--;
      blocks.push({ kind: "quote", inline: parseInline(quoted.join("\n")) });
      continue;
    }

    const paragraph = [line];
    while (i + 1 < lines.length && lines[i + 1]!.trim() && !/^(?:#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|\s*```|\s*~~~)/.test(lines[i + 1]!)) {
      paragraph.push(lines[++i]!);
    }
    blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}
