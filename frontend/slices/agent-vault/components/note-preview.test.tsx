import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotePreview } from "./note-preview";

describe("native Markdown reader", () => {
  it("renders structured notes and activates only resolved notes or safe web URLs", () => {
    const content = "---\nprivate: hidden\n---\n# Worker\n\n- [[Worker|Task]]\n- [Reference](https://example.org/)\n\n> recorded evidence\n\n```js\n[[Worker]]\n```\n\n**Result** and `code`";
    const html = renderToStaticMarkup(<NotePreview content={content} resolve={target => target === "Worker" ? "snapshot/worker.md" : undefined} onOpen={() => {}} />);
    expect(html).toContain("<h1"); expect(html).toContain("<ul"); expect(html).toContain("<blockquote");
    expect(html).toContain("<button"); expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("<code>[[Worker]]</code>"); expect(html).toContain("<strong>Result</strong>");
    expect(html).not.toContain("private: hidden");
  });
  it("never executes HTML, code or embedded resources from source notes", () => {
    const html = renderToStaticMarkup(<NotePreview content={'<script>alert(1)</script>\n\n![Tracking](https://example.org/pixel)\n\n![[Worker]]\n\n[Run](javascript:alert)\n\n<iframe src="https://example.org"></iframe>'} />);
    expect(html).toContain("&lt;script&gt;");
    for (const tag of ["<script", "<iframe", "<img", "<a "]) expect(html).not.toContain(tag);
  });
  it("preserves large unfinished links as inert text", () => {
    for (const content of ["[".repeat(48 * 1024), "[unfinished](".repeat(4096)]) {
      const html = renderToStaticMarkup(<NotePreview content={content} />);
      expect(html).toContain(content);
      expect(html).not.toContain("<button"); expect(html).not.toContain("<a ");
    }
  });
  it("renders GFM tables with alignment, inline formatting and inert source content", () => {
    const content = "Intro\nField | Value | State\n:--- | :---: | ---:\nFixture | `synthetic` | **isolated**\n<script> | [[Worker\\|Task]] | [Run](javascript:alert)\nshort | row\nextra | cells | stay | bounded\n\nAfter";
    const html = renderToStaticMarkup(<NotePreview content={content} resolve={target => target === "Worker" ? "worker.md" : undefined} onOpen={() => {}} />);
    expect(html).toContain("<table"); expect(html).toContain('<th scope="col"');
    expect(html).toContain('text-align:center'); expect(html).toContain('text-align:right');
    expect(html).toContain("<strong>isolated</strong>"); expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(">Task</button>"); expect(html).not.toContain("<script"); expect(html).not.toContain("<a ");
    expect((html.match(/<td /g) || []).length).toBe(12); expect(html).not.toContain("bounded");
    expect(html).toContain(">Intro</p>"); expect(html).toContain(">After</p>");
  });
  it("keeps invalid tables and fenced tables as literal text", () => {
    for (const content of ["| Field | Value |\n|---|\n|one|two|", "| Field | Value |\n|oops|---|", "```\n| Field | Value |\n|---|---|\n```", "|".repeat(48 * 1024) + "\n|no separator|"]) {
      const html = renderToStaticMarkup(<NotePreview content={content} />);
      expect(html).not.toContain("<table"); expect(html).toContain("|");
    }
  });
  it("keeps escaped pipes within table cells", () => {
    const html = renderToStaticMarkup(<NotePreview content={"| Field | Value |\n|---|---|\n| pipe | `a\\|b` |\n| slash | \\\\ |"} />);
    expect((html.match(/<td /g) || []).length).toBe(4); expect(html).toContain(">a|b</code>");
  });

});
