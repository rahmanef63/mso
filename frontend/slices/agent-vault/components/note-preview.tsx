"use client";
import { Fragment, memo, type ReactNode } from "react";
import { safeExternalLink } from "../lib/note-links";

type Props = { content: string; resolve?: (target: string, wiki: boolean) => string | undefined; onOpen?: (path: string) => void };
const INLINE = /(!?\[\[[^\[\]\n]+\]\]|!?\[[^\[\]\n]*\]\([^\s()\[\]]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*)/g;

function tableCells(line: string): string[] {
  const text = line.trim(), cells = [""];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      cells[cells.length - 1] += text[i + 1] === "|" ? "|" : text[i] + text[i + 1]; i++;
    } else if (text[i] === "|") cells.push("");
    else cells[cells.length - 1] += text[i];
  }
  if (text.startsWith("|")) cells.shift();
  if (cells.length > 1 && cells[cells.length - 1] === "") cells.pop();
  return cells.map(cell => cell.trim());
}

/** Inert Markdown reader. HTML/embeds stay text; only reviewed note/web links activate. */
export const NotePreview = memo(function NotePreview({ content, resolve, onOpen }: Props) {
  function inline(text: string): ReactNode {
    return text.split(INLINE).map((part, i) => {
      if (part.startsWith("!")) return <Fragment key={i}>{part}</Fragment>;
      if (part.startsWith("`")) return <code key={i} className="rounded bg-muted px-1 break-words">{part.slice(1, -1)}</code>;
      if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      const wiki = part.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
      const md = part.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
      if (!wiki && !md) return <Fragment key={i}>{part}</Fragment>;
      const target = wiki ? wiki[1] : md![2], label = wiki ? wiki[2] || target : md![1];
      const path = resolve?.(target, !!wiki);
      if (path && onOpen) return <button key={i} type="button" className="inline text-left text-primary underline underline-offset-2 break-words" onClick={() => onOpen(path)}>{label}</button>;
      const href = !wiki && safeExternalLink(target);
      return href ? <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline break-words">{label}</a> : <span key={i}>{label}</span>;
    });
  }
  const lines = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").split(/\r?\n/);
  const blocks: ReactNode[] = [];
  const tableAt = (index: number) => {
    if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) return false;
    const header = tableCells(lines[index]), separator = tableCells(lines[index + 1]);
    return header.length === separator.length && separator.every(cell => /^:?-{3,}:?$/.test(cell));
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], key = i;
    if (!line.trim()) continue;
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i]);
      blocks.push(<pre key={key} className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{code.join("\n")}</code></pre>); continue;
    }
    if (tableAt(i)) {
      const header = tableCells(line), separator = tableCells(lines[++i]), rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].includes("|")) rows.push(tableCells(lines[++i]));
      const alignment = (column: number) => separator[column].endsWith(":") ? (separator[column].startsWith(":") ? "center" : "right") : "left";
      blocks.push(<div key={key} className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-sm">
        <thead><tr>{header.map((cell, column) => <th key={column} scope="col" className="border bg-muted px-3 py-2 font-semibold" style={{ textAlign: alignment(column) }}>{inline(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{header.map((_, column) => <td key={column} className="border px-3 py-2" style={{ textAlign: alignment(column) }}>{inline(row[column] || "")}</td>)}</tr>)}</tbody>
      </table></div>); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={key} className={heading[1].length === 1 ? "text-xl font-semibold" : "font-semibold"}>{inline(heading[2])}</Tag>); continue;
    }
    if (/^\s*(?:[-*+]\s|\d+\.\s)/.test(line)) {
      const ordered = /^\s*\d+\./.test(line), items: ReactNode[] = [];
      const pattern = ordered ? /^\s*\d+\.\s/ : /^\s*[-*+]\s/;
      do { items.push(<li key={i}>{inline(lines[i].replace(pattern, ""))}</li>); i++; } while (i < lines.length && pattern.test(lines[i]));
      i--; const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={key} className="space-y-1 pl-5" style={{ listStyleType: ordered ? "decimal" : "disc" }}>{items}</Tag>); continue;
    }
    if (line.startsWith(">")) { blocks.push(<blockquote key={key} className="border-l pl-3 text-muted-foreground">{inline(line.replace(/^>\s?/, ""))}</blockquote>); continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key} />); continue; }
    const paragraph = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() && !tableAt(i + 1) && !/^(?:#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|\s*```|\s*~~~)/.test(lines[i + 1])) paragraph.push(lines[++i]);
    blocks.push(<p key={key} className="whitespace-pre-wrap">{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="space-y-4 text-sm leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>;
});
