import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown, parseMarkdownBlocks } from "./chat-markdown";

describe("parseMarkdownBlocks", () => {
  it("parses closed and streaming-unclosed fenced code blocks without mangling code", () => {
    const blocks = parseMarkdownBlocks("Run:\n```bash\necho **raw**\n```\nNext:\n```ts\nconst x = 1;");
    expect(blocks).toEqual([
      { kind: "paragraph", lines: ["Run:"] },
      { kind: "code", lang: "bash", content: "echo **raw**", unclosed: false },
      { kind: "paragraph", lines: ["Next:"] },
      { kind: "code", lang: "ts", content: "const x = 1;", unclosed: true },
    ]);
  });

  it("parses tables, lists, blockquotes, headings, and horizontal rules", () => {
    const md = [
      "## Summary",
      "",
      "> Important note",
      "",
      "| Service | Status |",
      "| --- | --- |",
      "| api | ok |",
      "",
      "- first",
      "- second",
      "",
      "1. step one",
      "2. step two",
      "",
      "---",
    ].join("\n");
    const blocks = parseMarkdownBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "blockquote", "table", "ul", "ol", "hr"]);
    const table = blocks[2];
    expect(table).toEqual({ kind: "table", headers: ["Service", "Status"], rows: [["api", "ok"]] });
  });
});

describe("ChatMarkdown rendering and XSS safety", () => {
  it("renders code block header, copy button, tables, and safe links", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={"Check [docs](https://example.com) and ~~old~~ **new**.\n\n```sh\nls -la\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |"} />,
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<del");
    expect(html).toContain("<strong");
    expect(html).toContain("Copy code block");
    expect(html).toContain("ls -la");
    expect(html).toContain("<table");
  });

  it("escapes raw HTML and refuses non-http(s) links", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={'<script>alert(1)</script> [bad](javascript:alert(1))'} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript:');
  });
});
