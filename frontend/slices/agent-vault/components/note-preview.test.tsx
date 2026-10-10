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
});
