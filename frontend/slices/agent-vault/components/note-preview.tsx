"use client";
/** Text-only Markdown preview: no HTML, embedded resources or executable links. */
export function NotePreview({ content }: { content: string }) {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return <div className="space-y-3 text-sm leading-relaxed">{body.split(/\n\s*\n/).map((block, i) => {
    if (/^# /.test(block)) return <h1 key={i} className="text-xl font-semibold">{block.replace(/^# /, "")}</h1>;
    if (/^## /.test(block)) return <h2 key={i} className="text-base font-semibold">{block.replace(/^## /, "")}</h2>;
    if (/^### /.test(block)) return <h3 key={i} className="font-semibold">{block.replace(/^### /, "")}</h3>;
    return <p key={i} className="whitespace-pre-wrap break-words">{block}</p>;
  })}</div>;
}
