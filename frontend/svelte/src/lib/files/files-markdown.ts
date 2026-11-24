import type { MarkdownBlock, UploadItem } from "./files-types.ts";

export function parseMarkdownBlocks(src: string): MarkdownBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ kind: "code", lang, text: buf.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        buf.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const cur = (lines[i] ?? "").trim();
      if (!cur || cur.startsWith("```") || /^(#{1,6})\s+/.test(cur) || cur.startsWith(">") || /^[-*+]\s+/.test(cur)) {
        break;
      }
      para.push(cur);
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

export async function readDropEntries(dt: DataTransfer): Promise<UploadItem[]> {
  const entries = Array.from(dt.items ?? [])
    .map((item) => {
      const withEntry = item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null };
      return item.kind === "file" && typeof withEntry.webkitGetAsEntry === "function"
        ? withEntry.webkitGetAsEntry()
        : null;
    })
    .filter((entry): entry is FileSystemEntry => entry != null);

  if (!entries.length) {
    return Array.from(dt.files ?? []).map((file) => ({ relPath: file.name, file }));
  }

  const out: UploadItem[] = [];
  await Promise.all(entries.map((entry) => walkDropEntry(entry, "", out)));
  if (!out.length) {
    return Array.from(dt.files ?? []).map((file) => ({ relPath: file.name, file }));
  }
  return out;
}

function walkDropEntry(entry: FileSystemEntry, prefix: string, out: UploadItem[]): Promise<void> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => { out.push({ relPath: prefix + entry.name, file }); resolve(); },
        () => resolve(),
      );
    });
  }
  if (!entry.isDirectory) return Promise.resolve();
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const dirPrefix = `${prefix}${entry.name}/`;
  return new Promise((resolve) => {
    const children: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            void Promise.all(children.map((child) => walkDropEntry(child, dirPrefix, out))).then(() => resolve());
            return;
          }
          children.push(...batch);
          readBatch();
        },
        () => resolve(),
      );
    };
    readBatch();
  });
}
