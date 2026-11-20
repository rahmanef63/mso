"use client";

import { Fragment, memo, type ReactNode } from "react";
import { CopyButton } from "./copy-button";
import { parseMarkdownBlocks } from "./chat-markdown-parse";

export { parseMarkdownBlocks };

const INLINE_RE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("`") && tok.endsWith("`")) {
      out.push(
        <code key={key++} className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[0.88em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**") && tok.endsWith("**")) {
      out.push(<strong key={key++} className="font-semibold">{renderInline(tok.slice(2, -2))}</strong>);
    } else if (tok.startsWith("~~") && tok.endsWith("~~")) {
      out.push(<del key={key++} className="opacity-75">{renderInline(tok.slice(2, -2))}</del>);
    } else if (tok.startsWith("*") && tok.endsWith("*")) {
      out.push(<em key={key++}>{renderInline(tok.slice(1, -1))}</em>);
    } else if (tok.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
      if (link) {
        out.push(
          <a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
            {link[1]}
          </a>,
        );
      } else {
        out.push(tok);
      }
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING_CLS: Record<1 | 2 | 3 | 4, string> = {
  1: "text-base font-bold tracking-tight",
  2: "text-[15px] font-semibold tracking-tight",
  3: "text-sm font-semibold",
  4: "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
};

export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className="min-w-0 space-y-2 whitespace-normal [overflow-wrap:anywhere]">
      {blocks.map((block, idx) => {
        if (block.kind === "code") {
          return (
            <div key={idx} className="my-1.5 overflow-hidden rounded-lg border border-border/80 bg-background/80">
              <div className="flex items-center justify-between border-b border-border/60 bg-muted/60 px-2.5 py-1">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {block.lang || "code"}{block.unclosed ? " ..." : ""}
                </span>
                <CopyButton value={block.content} label="code block" className="size-6 [@media(pointer:coarse)]:size-9" />
              </div>
              <pre className="overflow-x-auto p-2.5 font-mono text-xs leading-relaxed">
                <code>{block.content}</code>
              </pre>
            </div>
          );
        }
        if (block.kind === "heading") {
          return <div key={idx} className={HEADING_CLS[block.level]}>{renderInline(block.text)}</div>;
        }
        if (block.kind === "hr") return <hr key={idx} className="border-border" />;
        if (block.kind === "blockquote") {
          return (
            <blockquote key={idx} className="border-l-2 border-primary/50 pl-3 text-muted-foreground">
              {block.lines.map((l, j) => <p key={j}>{renderInline(l)}</p>)}
            </blockquote>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={idx} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={idx} start={block.start} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ol>
          );
        }
        if (block.kind === "table") {
          return (
            <div key={idx} className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    {block.headers.map((h, j) => (
                      <th key={j} className="border-b border-border px-2.5 py-1.5 font-semibold">{renderInline(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r} className="border-b border-border/60 last:border-b-0">
                      {block.headers.map((_, c) => (
                        <td key={c} className="px-2.5 py-1.5 align-top">{renderInline(row[c] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={idx} className="leading-relaxed">
            {block.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {renderInline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
});
