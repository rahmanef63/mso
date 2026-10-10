"use client";
import { Fragment, memo, type ReactNode } from "react";
import { safeExternalLink } from "../lib/note-links";

type Props = { content: string; resolve?: (target: string, wiki: boolean) => string | undefined; onOpen?: (path: string) => void };
const INLINE = /(!?\[\[[^\]\n]+\]\]|!?\[[^\]\n]*\]\([^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*)/g;

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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], key = i;
    if (!line.trim()) continue;
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i]);
      blocks.push(<pre key={key} className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{code.join("\n")}</code></pre>); continue;
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
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(?:#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|\s*```|\s*~~~)/.test(lines[i + 1])) paragraph.push(lines[++i]);
    blocks.push(<p key={key} className="whitespace-pre-wrap">{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="space-y-4 text-sm leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>;
});
